const OFFSCREEN_DOCUMENT_PATH = '/src/offscreen.html';

async function hasOffscreenDocument() {
    const existingContexts = await chrome.runtime.getContexts({
        contextTypes: ['OFFSCREEN_DOCUMENT'],
        documentUrls: [chrome.runtime.getURL(OFFSCREEN_DOCUMENT_PATH)]
    });
    return existingContexts.length > 0;
}

async function setupOffscreenDocument() {
    if (await hasOffscreenDocument()) {
        return;
    }
    await chrome.offscreen.createDocument({
        url: OFFSCREEN_DOCUMENT_PATH,
        reasons: ['WORKERS'],
        justification: 'Maintain WebSocket connection for 2FA data'
    });
}

async function connectWebSocket() {
    await setupOffscreenDocument();
    
    console.log('Starting WebSocket connection...');
    
    // Get WebSocket URL from storage or use default
    const config = await chrome.storage.sync.get(['websocketUrl']);
    const websocketUrl = config.websocketUrl || 'wss://your-websocket-worker.workers.dev/websocket';
    
    if (websocketUrl === 'wss://your-websocket-worker.workers.dev/websocket') {
        console.warn('⚠️ Using default WebSocket URL. Please configure your actual Worker URL in the extension settings.');
    }
    
    // Send message to offscreen document to start WebSocket connection
    try {
        chrome.runtime.sendMessage({ 
            type: 'CONNECT_WEBSOCKET', 
            url: websocketUrl 
        });
    } catch (error) {
        console.log('Failed to send message to offscreen document:', error);
    }
}

// Connect on startup and when the extension is installed
chrome.runtime.onStartup.addListener(connectWebSocket);
chrome.runtime.onInstalled.addListener(connectWebSocket);

// Listen for storage changes to reconnect if the userId changes
chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'local' && changes.userId) {
        console.log('User ID changed. Reconnecting WebSocket...');
        // First, send a disconnect message to the offscreen document
        chrome.runtime.sendMessage({ type: 'DISCONNECT_WEBSOCKET' });
        // Then reconnect with the new ID
        setTimeout(connectWebSocket, 1000); // Give it a second to disconnect
    }
});

// Forward data from the offscreen document to the content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'WEBSOCKET_DATA') {
        handleWebSocketData(message.data);
    } else if (message.type === 'GET_CONFIG') {
        chrome.storage.sync.get(['websocketUrl'], (result) => {
            sendResponse({
                websocketUrl: result.websocketUrl || 'wss://your-websocket-worker.workers.dev/websocket'
            });
        });
        return true; // Keep the message channel open for async response
    }
});

async function handleWebSocketData(data) {
    console.log('Received 2FA data:', data);
    const tabs = await chrome.tabs.query({
        url: 'https://*.rakuten-sec.co.jp/*'
    });

    if (tabs.length === 0) {
        console.warn('No Rakuten Securities tabs found');
        return;
    }

    for (const tab of tabs) {
        chrome.tabs.sendMessage(tab.id, {
            type: '2FA_DATA',
            sequence: data.sequence
        });
    }
}

// Keep-alive for the service worker
chrome.alarms.create('keepAlive', { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'keepAlive') {
        // This message is mainly to keep the offscreen document alive if needed
        chrome.runtime.sendMessage({ type: 'KEEP_ALIVE' }).catch(() => {});
    }
});