const { constants } = require('../utils');
const ApiMonitor = require('./api-monitor');
const PaginationHandler = require('./pagination-handler');
const fs = require('fs');
const path = require('path');

class SearchManager {
  constructor(browserManager) {
    this.browserManager = browserManager;
    this.auctionHouses = this.loadAuctionHouses();
  }

  loadAuctionHouses() {
    try {
      const auctionData = fs.readFileSync(path.join(process.cwd(), 'src/auction.txt'), 'utf8');
      const houses = JSON.parse(auctionData);
      // Only use first two houses for now
      return houses.slice(0, 2);
    } catch (error) {
      console.error('Error loading auction houses:', error);
      return [];
    }
  }

  constructSearchUrl(auctionHouse) {
    const baseParams = {
      supercategoryName: 'Furniture',
      'priceResult[min]': '250',
      upcoming: 'false',
      query: 'furniture',
      keyword: 'furniture'
    };

    if (auctionHouse) {
      baseParams.houseName = auctionHouse.name;
    }

    const searchParams = new URLSearchParams();
    for (const [key, value] of Object.entries(baseParams)) {
      searchParams.append(key, value);
    }

    return `https://www.invaluable.com/search?${searchParams.toString()}`;
  }

  async delay(page, ms) {
    return page.evaluate(ms => new Promise(r => setTimeout(r, ms)), ms);
  }

  async searchFurniture(cookies) {
    try {
      console.log('🔄 Starting furniture search process');
      
      // Generate URLs for each auction house
      const searchUrls = [
        // Base URL without auction house filter
        this.constructSearchUrl(),
        // URLs for each auction house
        ...this.auctionHouses.map(house => this.constructSearchUrl(house))
      ];

      const allResponses = [];

      for (const [index, url] of searchUrls.entries()) {
        console.log(`\n🔄 Processing URL ${index + 1}/${searchUrls.length}`);
        if (index > 0) {
          console.log(`  • Auction House: ${this.auctionHouses[index - 1].name}`);
          console.log(`  • Item Count: ${this.auctionHouses[index - 1].count}`);
        }
        
        // Create a new tab for each URL
        const tabName = `url-${index + 1}`;
        console.log(`🔄 Creating new tab: ${tabName}`);
        const page = await this.browserManager.createTab(tabName);
        
        // Configure page
        await page.setBypassCSP(true);
        await page.setExtraHTTPHeaders({
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
          'Connection': 'keep-alive',
          'Upgrade-Insecure-Requests': '1'
        });

        console.log('👀 Setting up API interception');
        await page.setRequestInterception(true);
        const apiMonitor = new ApiMonitor();

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
          
          await page.goto(url, {
            waitUntil: 'networkidle2',
            timeout: constants.navigationTimeout
          });

          await this.delay(page, 5000);

          const urlResponses = apiMonitor.getData();
          if (urlResponses.responses.length > 0) {
            console.log(`✅ Captured ${urlResponses.responses.length} API responses`);
            allResponses.push(...urlResponses.responses);
          } else {
            console.log('⚠️ No API responses captured for this URL');
          }
          
          // Clean up tab
          await this.browserManager.closeTab(tabName);
        } catch (error) {
          console.error('Error processing URL:', error.message);
          await this.browserManager.closeTab(tabName);
        }
      }

      console.log(`\n📊 Final Results:`);
      console.log(`  • Total API responses: ${allResponses.length}`);

      return {
        apiData: { responses: allResponses },
        timestamp: new Date().toISOString(),
        urls: searchUrls,
        auctionHouses: this.auctionHouses
      };
    } catch (error) {
      console.error('Furniture search error:', error);
      throw error;
    }
  }
}

module.exports = SearchManager;