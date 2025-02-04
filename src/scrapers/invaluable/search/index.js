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
      const auctionData = fs.readFileSync(path.join(process.cwd(), 'src/auction.txt'), 'utf8');
      // Only take the first auction house for testing
      const houses = [JSON.parse(auctionData)[0]];
      console.log(`Loaded ${houses.length} auction houses. First house: ${houses[0].name}`);
      if (houses.length === 0) {
        throw new Error('No auction houses loaded from file');
      }
      return houses;
    } catch (error) {
      console.error('Error loading auction houses:', error.message);
      console.error('Current directory:', process.cwd());
      console.error('Looking for file:', path.join(process.cwd(), 'src/auction.txt'));
      return [];
    }
  }

  generatePriceRanges() {
    const ranges = new Map();
    const MAX_PRICE = 25000;
    
    for (const house of this.auctionHouses) {
      console.log(`Generating initial ranges for ${house.name} (${house.count} items)`);
      
      // Initial base ranges based on auction house size
      let baseRanges;
      if (house.count <= 1000) {
        baseRanges = this.generateBaseRanges(250, MAX_PRICE, 3);
      } else if (house.count <= 5000) {
        baseRanges = this.generateBaseRanges(250, MAX_PRICE, 5);
      } else {
        baseRanges = this.generateBaseRanges(250, MAX_PRICE, 8);
      }
      
      ranges.set(house.name, baseRanges);
    }
    
    return ranges;
  }

  generateBaseRanges(min, max, segments) {
    const ranges = [];
    const step = Math.floor((max - min) / segments);
    
    for (let i = 0; i < segments - 1; i++) {
      ranges.push({
        min: min + (step * i),
        max: min + (step * (i + 1))
      });
    }
    
    // Add final range to max
    ranges.push({
      min: min + (step * (segments - 1)),
      max: max
    });
    
    return ranges;
  }

  async splitRangeIfNeeded(url, range, house) {
    try {
      // Create a new tab and check response size
      const tabName = `range-check-${range.min}-${range.max}`;
      const page = await this.browserManager.createTab(tabName);
      const apiMonitor = new ApiMonitor();
      
      try {
        await page.setRequestInterception(true);
        page.on('response', apiMonitor.handleResponse.bind(apiMonitor));
        
        // Set up request handler
        page.on('request', request => {
          try {
            if (request.resourceType() === 'image' || 
                request.resourceType() === 'stylesheet' || 
                request.resourceType() === 'font') {
              request.abort();
              return;
            }
            request.continue();
          } catch (error) {
            if (!error.message.includes('Request is already handled')) {
              console.error('Request handling error:', error);
            }
            request.continue();
          }
        });

        await page.goto(url, {
          waitUntil: 'networkidle2',
          timeout: constants.navigationTimeout
        });

        const responseSize = apiMonitor.getFirstResponseSize();
        console.log(`  • Response size for range $${range.min}-$${range.max}: ${responseSize.toFixed(2)} KB`);
      
        // If range difference is $1 or response size is under 600KB, keep range
        if (range.max - range.min <= 1 || responseSize < 600) {
          console.log(`  • Range $${range.min}-$${range.max}: ${responseSize.toFixed(2)}KB (keeping)`);
          return [range];
        }

        console.log(`  • Range $${range.min}-$${range.max}: ${responseSize.toFixed(2)}KB (splitting)`);
        
        // Split range in half
        const mid = Math.floor((range.max + range.min) / 2);
        const lowerRange = { min: range.min, max: mid };
        const upperRange = { min: mid, max: range.max };
        
        // Recursively split both halves
        const lowerRanges = await this.splitRangeIfNeeded(
          this.constructSearchUrl(house, lowerRange),
          lowerRange,
          house
        );
        
        const upperRanges = await this.splitRangeIfNeeded(
          this.constructSearchUrl(house, upperRange),
          upperRange,
          house
        );
        
        return [...lowerRanges, ...upperRanges];
      } finally {
        await this.browserManager.closeTab(tabName);
      }
    } catch (error) {
      console.error('Error splitting range:', error);
      // If we encounter an error, return the original range
      console.log(`  • Keeping original range due to error: $${range.min}-$${range.max}`);
      return [range];
    }
  }

  constructSearchUrl(auctionHouse, priceRange) {
    const baseParams = {
      supercategoryName: 'Furniture',
      upcoming: false,
      query: 'furniture',
      keyword: 'furniture',
      houseName: auctionHouse.name
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

    const searchParams = new URLSearchParams();
    for (const [key, value] of Object.entries(baseParams)) {
      if (value !== undefined && value !== null) {
        searchParams.append(key, value);
      }
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
      const nextIndex = 0; // Always use first auction house for testing
      
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
      
      // Get initial price ranges
      let initialRanges = this.priceRanges.get(house.name);
      console.log(`Initial ranges for ${house.name}:`, initialRanges.length);
      
      // Optimize ranges based on item counts
      const optimizedRanges = [];
      for (const range of initialRanges) {
        const url = this.constructSearchUrl(house, range);
        const splitRanges = await this.splitRangeIfNeeded(url, range, house);
        optimizedRanges.push(...splitRanges);
      }
      
      console.log(`Optimized into ${optimizedRanges.length} ranges`);
      
      // Generate URLs for each price range
      const searchUrls = optimizedRanges.map(range => ({
        url: this.constructSearchUrl(house, range),
        range
      }));
      
      console.log('Generated price ranges:');
      searchUrls.forEach(({ range }, index) => {
        console.log(`  Range ${index + 1}: $${range.min} - $${range.max}`);
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
        auctionHouse: house,
        priceRanges: searchUrls.map(({ range }) => range),
        urls: searchUrls.map(({ url }) => url)
      };
    } catch (error) {
      console.error('Furniture search error:', error);
      throw error;
    }
  }
}

module.exports = SearchManager;