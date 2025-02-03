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

      // Wait for JavaScript to be ready
      await this.page.waitForFunction(() => {
        return typeof jQuery !== 'undefined' && jQuery.active === 0;
      }, { timeout: constants.defaultTimeout });
      
      // Scroll to button with human-like behavior
      await this.page.evaluate(() => {
        const btn = document.querySelector('.load-more-btn');
        if (btn) {
          btn.scrollIntoView({ behavior: 'smooth', block: 'center' });
          // Trigger any scroll events
          window.dispatchEvent(new Event('scroll'));
        }
      });
      
      // Wait longer for any animations or lazy loading
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Click the button and wait for response
      const [response] = await Promise.all([
        this.page.waitForResponse(
          response => response.url().includes('catResults') && response.status() === 200,
          { timeout: constants.defaultTimeout }
        ),
        this.page.evaluate(() => {
          const btn = document.querySelector('.load-more-btn');
          if (btn && !btn.disabled) {
            // Trigger events in the correct order
            btn.dispatchEvent(new MouseEvent('mousedown'));
            btn.dispatchEvent(new MouseEvent('mouseup'));
            btn.dispatchEvent(new MouseEvent('click'));
            return true;
          }
          return false;
        })
      ]);
      
      // Wait for new items to render
      await this.page.waitForFunction(() => {
        const loadingIndicator = document.querySelector('.loading-indicator');
        const isLoading = loadingIndicator && 
                         window.getComputedStyle(loadingIndicator).display !== 'none';
        return !isLoading;
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