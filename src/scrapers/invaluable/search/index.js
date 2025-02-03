const { constants } = require('../utils');
const ApiMonitor = require('./api-monitor');
const PaginationHandler = require('./pagination-handler');

class SearchManager {
  constructor(browserManager) {
    this.browserManager = browserManager;
    this.searchUrl = 'https://www.invaluable.com/search?supercategoryName=Furniture&priceResult[min]=250&upcoming=false&query=furniture&keyword=furniture';
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

      const apiMonitor = new ApiMonitor();
      console.log('👀 Step 3: Enabling API request interception');
      
      // Set authentication cookies
      console.log('🍪 Setting authentication cookies');
      await page.setRequestInterception(true);
      
      // Set up consolidated request handling
      page.on('request', request => {
        try {
          const url = request.url();
          const headers = request.headers();
          
          // Add cookies to all requests
          headers['Cookie'] = cookies.map(c => `${c.name}=${c.value}`).join('; ');
          
          // Handle API monitoring for catResults requests
          if (url.includes('catResults')) {
            headers['Accept'] = 'application/json';
            headers['Content-Type'] = 'application/json';
            console.log('  • Intercepted API request:', url);
          }
          
          request.continue({ headers });
        } catch (error) {
          if (!error.message.includes('Request is already handled')) {
            console.error('Request handling error:', error);
          }
          request.continue();
        }
      });
      
      // Set up response monitoring
      page.on('response', apiMonitor.handleResponse.bind(apiMonitor));
      
      // Also set cookies directly
      await page.setCookie(...cookies);
      
      let initialHtml = null;
      let protectionHtml = null;
      
      console.log('🌐 Step 4: Navigating to furniture search URL');

      try {
        // First attempt navigation
        const response = await page.goto(this.searchUrl, {
          waitUntil: 'networkidle0',
          timeout: constants.navigationTimeout
        });
        
        // Check if we hit Cloudflare protection
        const isCloudflare = response.headers()['server']?.includes('cloudflare') || 
                            (await page.content()).includes('Cloudflare');
        
        if (isCloudflare) {
          console.log('🛡️ Cloudflare protection detected');
          
          // Wait for and solve the challenge
          await page.waitForFunction(() => {
            return !document.querySelector('#challenge-running') &&
                   !document.querySelector('#challenge-stage');
          }, { timeout: 30000 });
          
          console.log('✅ Cloudflare challenge completed');
          
          // Re-attempt navigation after challenge
          await page.goto(this.searchUrl, {
            waitUntil: 'networkidle0',
            timeout: constants.navigationTimeout
          });
        }
        
        console.log('  • Navigation complete');

        await this.delay(page, 2000);

        console.log('📄 Step 5: Capturing initial HTML');
        initialHtml = await page.content();
        console.log(`  • Size: ${(initialHtml.length / 1024).toFixed(2)} KB`);

        if (initialHtml.includes('checking your browser') || 
            initialHtml.includes('Access to this page has been denied')) {
          console.log('🛡️ Step 6a: Protection page detected');
          protectionHtml = initialHtml;
          console.log('🤖 Step 6b: Processing protection challenge');
          await this.browserManager.handleProtection();
          await this.delay(page, 2000);
          console.log('✅ Step 6c: Protection cleared');
          await page.goto(this.searchUrl, { waitUntil: 'networkidle0', timeout: constants.navigationTimeout });
          initialHtml = await page.content();
        } else {
          console.log('✅ Step 6: No protection detected');
        }

        if (apiMonitor.hasFirstResponse()) {
          console.log('📥 Step 7: API response captured during navigation');
          console.log(`  • Response size: ${(apiMonitor.getFirstResponseSize() / 1024).toFixed(2)} KB`);
        } else {
          console.log('⚠️ Step 7: No API response captured during navigation');
        }

        await this.delay(page, 2000);

        console.log('📄 Step 8: Capturing final state');
        finalHtml = await page.content();
        console.log(`  • Size: ${(finalHtml.length / 1024).toFixed(2)} KB`);
        
        // Handle pagination
        console.log('🔄 Step 9: Checking for more results');
        const paginationHandler = new PaginationHandler(page);
        
        const initialCount = await paginationHandler.getInitialCount();
        const totalCount = await paginationHandler.getTotalCount();
        
        console.log(`  • Initial items: ${initialCount}`);
        console.log(`  • Total available: ${totalCount}`);
        
        if (await paginationHandler.waitForLoadMoreButton()) {
          console.log('  • Load more button found');
          
          // Click load more and capture response
          const loadMoreSuccess = await paginationHandler.clickLoadMore();
          
          if (loadMoreSuccess) {
            console.log('  • Successfully loaded more items');
            await this.delay(page, 2000);
            
            // Update final HTML to include new items
            finalHtml = await page.content();
            console.log(`  • Updated final HTML size: ${(finalHtml.length / 1024).toFixed(2)} KB`);
          }
        } else {
          console.log('  • No more results to load');
        }

      } catch (error) {
        console.log('❌ Error during process:', error.message);
      }

      const monitorData = apiMonitor.getData();
      console.log('📊 Step 10: Final status:');
      console.log(`  • API responses captured: ${monitorData.responses.length}`);
      console.log(`  • First response: ${apiMonitor.hasFirstResponse() ? '✅' : '❌'}`);

      try {
        await page.removeAllListeners('request');
        await page.removeAllListeners('response');
        await page.setRequestInterception(false);
      } catch (error) {
        console.log('⚠️ Cleanup warning:', error.message);
      }

      return {
        html: {
          initial: initialHtml,
          protection: protectionHtml,
          final: finalHtml
        },
        apiData: monitorData,
        timestamp: new Date().toISOString(),
        url: this.searchUrl
      };
    } catch (error) {
      console.error('Furniture search error:', error);
      throw error;
    }
  }
}

module.exports = SearchManager;