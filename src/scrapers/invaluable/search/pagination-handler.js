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
      
      // Try InstantSearch method first
      const instantSearchSuccess = await this.tryInstantSearchPagination();
      
      if (instantSearchSuccess) {
        console.log('✅ InstantSearch pagination successful');
        return true;
      }
      
      console.log('⚠️ InstantSearch pagination failed, trying direct Algolia request');
      
      // Fallback to direct Algolia request
      const algoliaSuccess = await this.tryAlgoliaPagination();
      
      if (algoliaSuccess) {
        console.log('✅ Direct Algolia request successful');
        return true;
      }
      
      console.log('❌ Both pagination methods failed');
      return false;
    } catch (error) {
      console.error('Error in pagination:', error);
      return false;
    }
  }

  async tryInstantSearchPagination() {
    try {
      
      // Get InstantSearch instance and trigger next page
      const success = await this.page.evaluate(() => {
        try {
          // Find InstantSearch instance
          const searchClient = window.searchClient;
          if (!searchClient) {
            console.log('InstantSearch client not found');
            return false;
          }

          // Get current state
          const state = searchClient.helper.state;
          const currentPage = state.page || 0;
          
          // Trigger next page
          searchClient.helper
            .setPage(currentPage + 1)
            .search();
            
          return true;
        } catch (error) {
          console.error('Error triggering InstantSearch pagination:', error);
          return false;
        }
      });

      if (!success) {
        console.log('Failed to trigger InstantSearch pagination');
        return false;
      }
      
      // Wait for new items to render
      await this.page.waitForFunction(() => {
        const loadingIndicator = document.querySelector('.loading-indicator');
        return !loadingIndicator || window.getComputedStyle(loadingIndicator).display === 'none';
      }, { timeout: constants.defaultTimeout });

      // Get updated count
      const newCount = await this.getInitialCount();
      console.log(`  • New item count: ${newCount}`);
      
      return true;
    } catch (error) {
      console.error('Error in Algolia pagination:', error);
      return false;
    }
  }
}

module.exports = PaginationHandler;