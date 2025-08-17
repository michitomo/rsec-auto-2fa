// Copy this file to config.js and update with your actual values
const CONFIG = {
  // WebSocket endpoint for your Cloudflare Worker
  WEBSOCKET_URL: 'wss://your-websocket-worker.workers.dev/websocket',
  
  // Authentication token (should match your Cloudflare Worker configuration)
  AUTH_TOKEN: 'your-auth-token-here',
  
  // Enable debug logging
  DEBUG: false,
  
  // Auto-submit delay in milliseconds (after emoji selection)
  AUTO_SUBMIT_DELAY: 200,
  
  // Emoji click interval in milliseconds
  EMOJI_CLICK_INTERVAL: 200
};

// Export for use in extension
if (typeof module !== 'undefined' && module.exports) {
  module.exports = CONFIG;
}