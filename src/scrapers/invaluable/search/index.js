const { constants } = require('../utils');
const ApiMonitor = require('./api-monitor');
const PaginationHandler = require('./pagination-handler');
const fs = require('fs');
const path = require('path');

class SearchManager {
  constructor(browserManager) {
    this.browserManager = browserManager;
    this.auctionHouses = this.loadAuctionHouses();
    this.priceRanges = this.generatePriceRanges();
  }

  loadAuctionHouses() {
    try {
      const auctionData = fs.readFileSync(path.join(__dirname, '../../auction.txt'), 'utf8');
      const houses = JSON.parse(auctionData);
      console.log(`Loaded ${houses.length} auction houses`);
      return houses;
    } catch (error) {
      console.error('Error loading auction houses:', error);
      return [];
    }
  }

  generatePriceRanges() {
    const ranges = new Map();
    
    for (const house of this.auctionHouses) {
      let priceRanges;
      
      if (house.count > 10000) {
        // For very large auctions (100 ranges)
        priceRanges = [];
        let currentMin = 250;
        for (let i = 0; i < 99; i++) {
          const max = Math.round(currentMin * 1.15); // 15% increase each step
          priceRanges.push({ min: currentMin, max });
          currentMin = max;
        }
        priceRanges.push({ min: currentMin }); // Final range with no max
      } else if (house.count > 4000) {
        // For large auctions (20 ranges)
        priceRanges = [];
        let currentMin = 250;
        for (let i = 0; i < 19; i++) {
          const max = Math.round(currentMin * 1.35); // 35% increase each step
          priceRanges.push({ min: currentMin, max });
          currentMin = max;
        }
        priceRanges.push({ min: currentMin }); // Final range with no max
      } else if (house.count <= 1000) {
        // For smaller auctions (like DOYLE with 585 items), use 3 segments
        priceRanges = [
          { min: 250, max: 500 },
          { min: 500, max: 2000 },
          { min: 2000 } // No max for last range
        ];
      } else {
        // For medium-sized auctions, use 5 segments
        priceRanges = [
          { min: 250, max: 500 },
          { min: 500, max: 1000 },
          { min: 1000, max: 2500 },
          { min: 2500, max: 5000 },
          { min: 5000 }
        ];
      }
      
      ranges.set(house.name, priceRanges);
    }
    
    return ranges;
  }

  constructSearchUrl(auctionHouse, priceRange) {
    const baseParams = {
      supercategoryName: 'Furniture',
      upcoming: 'false',
      query: 'furniture',
      keyword: 'furniture'
    };

    // Add price range parameters
    if (priceRange) {
      baseParams['priceResult[min]'] = priceRange.min.toString();
      if (priceRange.max) {
        baseParams['priceResult[max]'] = priceRange.max.toString();
      }
    } else {
      baseParams['priceResult[min]'] = '250';
    }

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
    const randomDelay = Math.floor(Math.random() * (30000 - 20000 + 1)) + 20000; // Random between 20-30 seconds
    console.log(`Waiting ${(randomDelay / 1000).toFixed(1)} seconds...`);
    return page.evaluate(ms => new Promise(r => setTimeout(r, ms)), randomDelay);
  }

  async searchFurniture(cookies) {
    try {
      console.log('🔄 Starting furniture search process');

      // Get last processed index from storage
      const storage = require('../../../utils/storage');
      const lastIndex = await storage.getLastProcessedIndex();
      const nextIndex = lastIndex + 1;
      
      // Update index immediately before processing
      await storage.updateProcessedIndex(nextIndex);
      
      // Check if we've processed all houses
      if (nextIndex >= this.auctionHouses.length) {
        console.log('All auction houses have been processed');
        return { 
          apiData: { responses: [] },
          timestamp: new Date().toISOString(),
          status: 'completed',
          message: 'All auction houses processed'
        };
      }
      
      const house = this.auctionHouses[nextIndex];
      console.log(`Processing auction house ${nextIndex}:`, house.name);
      
      // Get price ranges for the auction house
      const priceRanges = this.priceRanges.get(house.name);
      
      // Generate URLs for each price range
      const searchUrls = priceRanges.map(range => ({
        url: this.constructSearchUrl(house, range),
        range
      }));
      
      console.log('Generated price ranges:');
      searchUrls.forEach(({ range }, index) => {
        console.log(`  Range ${index + 1}: $${range.min} - ${range.max ? '$' + range.max : 'No limit'}`);
      });

      const allResponses = [];

      for (const [index, { url, range }] of searchUrls.entries()) {
        console.log(`\n🔄 Processing URL ${index + 1}/${searchUrls.length}`);
        console.log(`  • Price Range: $${range.min} - ${range.max ? '$' + range.max : 'No limit'}`);
        
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

          // Random delay between requests
          await this.delay(page);

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
        urls: searchUrls.map(({ url }) => url),
        auctionHouse: house,
        priceRanges: priceRanges
      };
    } catch (error) {
      console.error('Furniture search error:', error);
      throw error;
    }
  }
}

module.exports = SearchManager;