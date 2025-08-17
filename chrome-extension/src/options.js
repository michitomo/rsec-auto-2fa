// Load saved settings
document.addEventListener('DOMContentLoaded', () => {
    chrome.storage.sync.get(['websocketUrl', 'authToken'], (result) => {
        if (result.websocketUrl) {
            document.getElementById('websocketUrl').value = result.websocketUrl;
        }
        if (result.authToken) {
            document.getElementById('authToken').value = result.authToken;
        }
    });
});

// Save settings
document.getElementById('saveBtn').addEventListener('click', () => {
    const websocketUrl = document.getElementById('websocketUrl').value;
    const authToken = document.getElementById('authToken').value;
    
    if (!websocketUrl) {
        showStatus('WebSocket URLを入力してください', 'error');
        return;
    }
    
    // Validate WebSocket URL format
    if (!websocketUrl.match(/^wss?:\/\/.+/)) {
        showStatus('無効なWebSocket URLです (wss://... の形式で入力してください)', 'error');
        return;
    }
    
    chrome.storage.sync.set({
        websocketUrl: websocketUrl,
        authToken: authToken
    }, () => {
        showStatus('設定を保存しました', 'success');
        
        // Notify background script to reconnect
        chrome.runtime.sendMessage({ type: 'SETTINGS_UPDATED' });
    });
});

// Test connection
document.getElementById('testBtn').addEventListener('click', async () => {
    const websocketUrl = document.getElementById('websocketUrl').value;
    
    if (!websocketUrl) {
        showStatus('WebSocket URLを入力してください', 'error');
        return;
    }
    
    showStatus('接続テスト中...', 'success');
    
    try {
        const ws = new WebSocket(websocketUrl);
        
        ws.onopen = () => {
            showStatus('✅ 接続成功！', 'success');
            ws.close();
        };
        
        ws.onerror = (error) => {
            showStatus('❌ 接続失敗: WebSocket URLを確認してください', 'error');
        };
        
        ws.onclose = () => {
            console.log('Test connection closed');
        };
        
        // Timeout after 5 seconds
        setTimeout(() => {
            if (ws.readyState === WebSocket.CONNECTING) {
                ws.close();
                showStatus('❌ 接続タイムアウト', 'error');
            }
        }, 5000);
        
    } catch (error) {
        showStatus('❌ 接続エラー: ' + error.message, 'error');
    }
});

function showStatus(message, type) {
    const statusEl = document.getElementById('status');
    statusEl.textContent = message;
    statusEl.className = `status ${type}`;
    statusEl.style.display = 'block';
    
    // Auto-hide after 5 seconds
    setTimeout(() => {
        statusEl.style.display = 'none';
    }, 5000);
}