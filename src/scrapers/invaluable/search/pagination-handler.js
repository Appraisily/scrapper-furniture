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
      
      // Scroll to button with human-like behavior
      await this.page.evaluate(() => {
        const btn = document.querySelector('.load-more-btn');
        if (btn) {
          btn.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      });
      
      await this.page.waitForTimeout(1000);
      
      // Click the button
      await this.page.click('.load-more-btn');
      
      // Wait for new items to load
      await this.page.waitForResponse(
        response => response.url().includes('catResults'),
        { timeout: constants.defaultTimeout }
      );
      
      // Wait for new items to render
      await this.page.waitForFunction(() => {
        const loadingIndicator = document.querySelector('.loading-indicator');
        return !loadingIndicator || loadingIndicator.style.display === 'none';
      }, { timeout: constants.defaultTimeout });
      
      return true;
    } catch (error) {
      console.error('Error clicking load more:', error);
      return false;
    }
  }
}