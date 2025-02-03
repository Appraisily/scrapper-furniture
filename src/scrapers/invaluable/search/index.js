const { constants } = require('../utils');
const ApiMonitor = require('./api-monitor');
const PaginationHandler = require('./pagination-handler');

class SearchManager {
  constructor(browserManager) {
    this.browserManager = browserManager;
    this.searchUrls = [
      'https://www.invaluable.com/search?supercategoryName=Furniture&priceResult[min]=250&upcoming=false&query=furniture&keyword=furniture',
      'https://www.invaluable.com/search?houseName=DOYLE%20Auctioneers%20%26%20Appraisers&supercategoryName=Furniture&Furniture=Tables%2C%20Stands%20%26%20Consoles&priceResult[min]=250&upcoming=false&query=furniture&keyword=furniture'
    ];
  }

  async delay(page, ms) {
    return page.evaluate(ms => new Promise(r => setTimeout(r, ms)), ms);
  }

  async searchFurniture(cookies) {
    try {
      const page = this.browserManager.getPage();
      console.log('🔄 Starting furniture search process');
      
      // Configure page for cookie handling
      await page.setBypassCSP(true);
      await page.setExtraHTTPHeaders({
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1'
      });
      
      // Reset page
      await page.setRequestInterception(false);
      await page.removeAllListeners('request');
      await page.removeAllListeners('response');

      const allResponses = [];
      const apiMonitor = new ApiMonitor();

      for (const [index, url] of this.searchUrls.entries()) {
        console.log(`\n🔄 Processing URL ${index + 1}/${this.searchUrls.length}`);
        console.log('👀 Setting up API interception');

        // Reset request interception
        await page.setRequestInterception(true);

        // Set up request handling
        const requestHandler = request => {
          try {
            const reqUrl = request.url();
            const headers = request.headers();
            
            // Add cookies to all requests
            headers['Cookie'] = cookies.map(c => `${c.name}=${c.value}`).join('; ');
            
            if (reqUrl.includes('catResults')) {
              headers['Accept'] = 'application/json';
              headers['Content-Type'] = 'application/json';
              console.log('  • Intercepted API request:', reqUrl);
            }
            
            // Block images and other unnecessary resources
            if (request.resourceType() === 'image' || 
                request.resourceType() === 'stylesheet' || 
                request.resourceType() === 'font') {
              request.abort();
              return;
            }
            
            request.continue({ headers });
          } catch (error) {
            if (!error.message.includes('Request is already handled')) {
              console.error('Request handling error:', error);
            }
            request.continue();
          }
        };

        page.on('request', requestHandler);
        page.on('response', apiMonitor.handleResponse.bind(apiMonitor));

        // Set cookies
        await page.setCookie(...cookies);

        try {
          console.log('🌐 Navigating to URL:', url);
          
          // Navigate with minimal wait conditions
          await page.goto(url, {
            waitUntil: 'networkidle2',
            timeout: constants.navigationTimeout
          });

          // Short delay to ensure API requests complete
          await this.delay(page, 5000);

          // Store responses for this URL
          const urlResponses = apiMonitor.getData();
          if (urlResponses.responses.length > 0) {
            console.log(`✅ Captured ${urlResponses.responses.length} API responses`);
            allResponses.push(...urlResponses.responses);
          } else {
            console.log('⚠️ No API responses captured for this URL');
          }
        } catch (error) {
          console.error('Error processing URL:', error.message);
        }

        // Clean up listeners
        page.removeListener('request', requestHandler);
        page.removeAllListeners('response');
        apiMonitor.reset();
      }

      console.log(`\n📊 Final Results:`);
      console.log(`  • Total API responses: ${allResponses.length}`);

      return {
        apiData: { responses: allResponses },
        timestamp: new Date().toISOString(),
        urls: this.searchUrls
      };
    } catch (error) {
      console.error('Furniture search error:', error);
      throw error;
    }

module.exports = SearchManager;