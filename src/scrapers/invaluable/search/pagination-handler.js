const { constants } = require('../utils');

class PaginationHandler {
  constructor(page) {
    this.page = page;
  }

  async getInitialCount() {
    return this.page.evaluate(() => {
      const items = document.querySelectorAll('.lot-search-result');
      return items.length;
    });
  }

  async getTotalCount() {
    return this.page.evaluate(() => {
      const countEl = document.querySelector('.total-count');
      if (!countEl) return 0;
      return parseInt(countEl.textContent.replace(/,/g, ''), 10) || 0;
    });
  }

  async waitForLoadMoreButton() {
    try {
      await this.page.waitForSelector('.load-more-btn', { 
        visible: true,
        timeout: constants.defaultTimeout
      });
      
      // Check if button is enabled
      const isEnabled = await this.page.evaluate(() => {
        const btn = document.querySelector('.load-more-btn');
        return btn && !btn.disabled;
      });
      
      return isEnabled;
    } catch (error) {
      console.log('No load more button found or button is disabled');
      return false;
    }
  }

  async clickLoadMore() {
    try {
      console.log('🖱️ Clicking load more button');
      
      // Wait for React to be ready
      await this.page.waitForFunction(() => {
        return window.__REACT_DEVTOOLS_GLOBAL_HOOK__ || 
               window._reactRootContainer ||
               document.querySelector('[data-reactroot]');
      }, { timeout: constants.defaultTimeout });
      
      // Scroll to button with human-like behavior
      await this.page.evaluate(() => {
        const btn = document.querySelector('.load-more-btn');
        if (btn) {
          const rect = btn.getBoundingClientRect();
          window.scrollTo({
            top: window.scrollY + rect.top - (window.innerHeight / 2),
            behavior: 'smooth'
          });
        }
      });
      
      // Wait for any scroll animations to complete
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Click the button and wait for response
      const [response] = await Promise.all([
        this.page.waitForResponse(
          response => response.url().includes('catResults') && response.status() === 200,
          { timeout: constants.defaultTimeout }
        ),
        this.page.evaluate(async () => {
          const btn = document.querySelector('.load-more-btn');
          if (btn && !btn.disabled) {
            // Get React fiber node
            let fiber = null;
            for (const key in btn) {
              if (key.startsWith('__reactFiber$')) {
                fiber = btn[key];
                break;
              }
            }
            
            if (fiber) {
              // Find React click handler
              const props = fiber.memoizedProps || {};
              if (props.onClick) {
                // Simulate React synthetic event
                const event = new MouseEvent('click', {
                  bubbles: true,
                  cancelable: true,
                  view: window
                });
                
                // Add React's synthetic event properties
                Object.defineProperty(event, '_reactName', {
                  get: () => 'onClick'
                });
                
                // Call React's click handler
                props.onClick(event);
                return true;
              }
            }
            
            // Fallback to native click if React handler not found
            btn.click();
            return true;
          }
          return false;
        }),
      ]);
      
      // Wait for new items to render
      await this.page.waitForFunction(() => {
        const loadingIndicator = document.querySelector('.loading-indicator');
        return !loadingIndicator || window.getComputedStyle(loadingIndicator).display === 'none';
      }, { timeout: constants.defaultTimeout });
      
      // Additional wait for DOM updates
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Get updated count
      const newCount = await this.getInitialCount();
      console.log(`  • New item count: ${newCount}`);
      
      return true;
    } catch (error) {
      console.error('Error clicking load more:', error);
      return false;
    }
  }
}

module.exports = PaginationHandler;