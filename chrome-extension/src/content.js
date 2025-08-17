class RakutenSecurities2FAAutomation {
  constructor() {
    this.isProcessing = false;
    this.retryCount = 0;
    this.maxRetries = 3;
    this.emojiMapping = {
      'オフロ': ['emoji_0', 'emoji_9'],
      'ドラゴン': ['emoji_1'],
      'クロイカオ': ['emoji_2'],
      'ケイコクマーク': ['emoji_8'],
      'ラクダ': ['emoji_3', 'emoji_4'],
      'チキュウ': ['emoji_5', 'emoji_6'],
      'ウシ': ['emoji_7'],
      'ライコマーク': ['emoji_8'],
      'ジョウバ': ['emoji_9'],
      'ニョウコシスミ': ['emoji_10'],
      // Add more mappings as needed based on actual emoji names
    };
    this.init();
  }

  init() {
    this.setupMessageListener();
    this.detectAuthPage();
    this.observePageChanges();
  }

  setupMessageListener() {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      console.log('Content script received message:', message);
      
      if (message.type === '2FA_DATA') {
        this.handle2FAData(message.sequence);
        sendResponse({ received: true });
      }
    });
  }

  detectAuthPage() {
    const indicators = [
      () => document.title.includes('認証'),
      () => document.title.includes('ログイン'),
      () => document.title.includes('Authentication'), 
      () => document.body.textContent.includes('2段階認証'),
      () => document.body.textContent.includes('画像認証'),
      () => document.body.textContent.includes('絵文字'),
      () => document.querySelector('form[name="SotpLoginForm"]') !== null,
      () => document.querySelector('.pcmm_emoji-img') !== null,
      () => document.querySelector('[onclick*="emojiClick"]') !== null
    ];

    const isAuthPage = indicators.some(indicator => {
      try {
        return indicator();
      } catch (e) {
        return false;
      }
    });

    if (isAuthPage) {
      console.log('Rakuten Securities emoji authentication page detected');
      this.markPageAsReady();
    }

    return isAuthPage;
  }

  observePageChanges() {
    const observer = new MutationObserver((mutations) => {
      if (this.isProcessing) return;

      for (const mutation of mutations) {
        if (mutation.type === 'childList') {
          const hasNewAuthElements = Array.from(mutation.addedNodes).some(node => {
            if (node.nodeType === Node.ELEMENT_NODE) {
              return this.isAuthElement(node);
            }
            return false;
          });

          if (hasNewAuthElements) {
            console.log('New authentication elements detected');
            this.detectAuthPage();
          }
        }
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  isAuthElement(element) {
    const authKeywords = ['auth', '認証', 'verification', '2fa', 'login', '絵文字', 'emoji'];
    
    const elementText = (element.textContent || '').toLowerCase();
    const elementHTML = (element.innerHTML || '').toLowerCase();
    const elementClasses = (element.className || '').toLowerCase();
    const elementId = (element.id || '').toLowerCase();
    
    return authKeywords.some(keyword => 
      elementText.includes(keyword) || 
      elementHTML.includes(keyword) ||
      elementClasses.includes(keyword) ||
      elementId.includes(keyword)
    );
  }

  markPageAsReady() {
    chrome.storage.local.set({
      authPageReady: true,
      url: window.location.href,
      timestamp: new Date().toISOString()
    });
  }

  async handle2FAData(sequence) {
    if (this.isProcessing) {
      console.log('Already processing 2FA data');
      return;
    }

    this.isProcessing = true;
    console.log('Processing 2FA sequence:', sequence);

    try {
      const success = await this.clickImages(sequence);
      
      if (success) {
        console.log('Successfully clicked all images');
        await this.delay(200); // Minimal delay for UI to update
        await this.autoSubmitForm();
      } else {
        console.error('Failed to click images');
        this.retry(sequence);
      }
    } catch (error) {
      console.error('Error processing 2FA data:', error);
      this.retry(sequence);
    } finally {
      this.isProcessing = false;
    }
  }

  async clickImages(sequence) {
    const emojiButtons = this.findEmojiButtons();
    
    if (emojiButtons.length === 0) {
      console.error('No emoji buttons found');
      return false;
    }

    console.log(`Found ${emojiButtons.length} emoji buttons`);
    console.log('Sequence to click:', sequence);

    for (let i = 0; i < sequence.length && i < 2; i++) {
      const emojiName = sequence[i];
      const button = this.findEmojiButton(emojiButtons, emojiName);
      
      if (!button) {
        console.error(`Emoji button not found for: ${emojiName}`);
        return false;
      }

      console.log(`Clicking emoji ${i + 1}: ${emojiName}`);
      await this.clickEmojiButton(button);
      await this.delay(200);
    }

    return true;
  }

  findEmojiButtons() {
    // Find all emoji buttons with onclick="emojiClick" pattern
    const emojiButtons = document.querySelectorAll('button[onclick*="emojiClick"], .pcmm_emoji-img[onclick*="emojiClick"]');
    
    console.log(`Found ${emojiButtons.length} emoji buttons`);
    
    return Array.from(emojiButtons);
  }

  findEmojiButton(buttons, emojiName) {
    console.log(`Looking for emoji button: ${emojiName}`);
    
    for (const button of buttons) {
      // Check the alt attribute of the image inside the button
      const img = button.querySelector('img');
      if (img && img.alt) {
        console.log(`Checking button with alt: ${img.alt}`);
        if (img.alt.includes(emojiName)) {
          console.log(`Found matching button for ${emojiName}`);
          return button;
        }
      }
      
      // Check onclick attribute for emoji ID that might correspond to our mapping
      const onclick = button.getAttribute('onclick') || '';
      if (this.emojiMapping[emojiName]) {
        for (const emojiId of this.emojiMapping[emojiName]) {
          if (onclick.includes(emojiId)) {
            console.log(`Found button by ID mapping: ${emojiId} for ${emojiName}`);
            return button;
          }
        }
      }
      
      // Check if the button's ID matches
      if (button.id && this.emojiMapping[emojiName] && 
          this.emojiMapping[emojiName].includes(button.id)) {
        console.log(`Found button by direct ID: ${button.id}`);
        return button;
      }
    }
    
    console.log(`No button found for emoji: ${emojiName}`);
    return null;
  }

  async clickEmojiButton(button) {
    console.log('Clicking emoji button:', button);

    button.scrollIntoView({ behavior: 'smooth', block: 'center' });
    await this.delay(100);

    // Extract the onclick function call
    const onclick = button.getAttribute('onclick');
    if (onclick) {
      try {
        // Execute the onclick function directly
        eval(onclick);
        console.log(`Executed onclick: ${onclick}`);
        
        // Add visual feedback
        this.highlightElement(button);
      } catch (error) {
        console.error('Error executing onclick:', error);
        // Fallback to regular click
        this.simulateClick(button);
      }
    } else {
      // Fallback click
      this.simulateClick(button);
    }
  }

  simulateClick(element) {
    const events = ['mousedown', 'mouseup', 'click'];
    
    events.forEach(eventType => {
      const event = new MouseEvent(eventType, {
        view: window,
        bubbles: true,
        cancelable: true,
        buttons: 1
      });
      element.dispatchEvent(event);
    });

    if (element.click) {
      element.click();
    }

    element.focus();

    const changeEvent = new Event('change', { bubbles: true });
    element.dispatchEvent(changeEvent);
  }

  highlightElement(element) {
    const originalBorder = element.style.border;
    const originalBoxShadow = element.style.boxShadow;
    
    element.style.border = '3px solid #4CAF50';
    element.style.boxShadow = '0 0 10px rgba(76, 175, 80, 0.5)';
    
    setTimeout(() => {
      element.style.border = originalBorder;
      element.style.boxShadow = originalBoxShadow;
    }, 1000);
  }

  async autoSubmitForm() {
    console.log('Auto-submitting form after 2FA completion');

    // Verify both emojis are selected
    if (!this.verifyEmojisSelected()) {
      console.error('Both emojis must be selected before auto-submit');
      return false;
    }

    console.log('✅ Both emojis verified, proceeding with immediate submit');

    // Submit the form immediately
    return this.submitForm();
  }

  verifyEmojisSelected() {
    const selectImageNo1 = document.getElementById('selectImageNo1');
    const selectImageNo2 = document.getElementById('selectImageNo2');
    
    const hasSelection1 = selectImageNo1 && selectImageNo1.value;
    const hasSelection2 = selectImageNo2 && selectImageNo2.value;
    
    if (hasSelection1 && hasSelection2) {
      console.log(`✅ Verified selections: ${selectImageNo1.value}, ${selectImageNo2.value}`);
      return true;
    }
    
    console.warn(`❌ Missing selections: 1=${hasSelection1 ? selectImageNo1.value : 'none'}, 2=${hasSelection2 ? selectImageNo2.value : 'none'}`);
    return false;
  }


  submitForm() {
    console.log('Attempting to submit form');

    // Final verification
    if (!this.verifyEmojisSelected()) {
      console.warn('❌ Cannot submit: Both emoji selections are required');
      return false;
    }

    // Look for the specific submit button
    const submitButton = document.querySelector('input[value="認証する"][onclick="check()"]');
    
    if (submitButton) {
      console.log('🎯 Found authentication submit button, clicking...');
      this.simulateClick(submitButton);
      this.showSuccessNotification();
      return true;
    }

    // Fallback: look for other submit buttons
    const altSubmitButtons = [
      'input[type="submit"][value*="認証"]',
      'button[onclick*="check"]',
      'input[value*="ログイン"]',
      'button[type="submit"]'
    ];

    for (const selector of altSubmitButtons) {
      const button = document.querySelector(selector);
      if (button) {
        console.log(`🎯 Found alternative submit button: ${selector}`);
        this.simulateClick(button);
        this.showSuccessNotification();
        return true;
      }
    }

    // Fallback: call the check() function directly
    const form = document.querySelector('form[name="SotpLoginForm"]');
    if (form && typeof window.check === 'function') {
      console.log('🎯 Calling check() function directly');
      window.check();
      this.showSuccessNotification();
      return true;
    }

    console.warn('❌ Could not find submit mechanism');
    this.showError('ログインボタンが見つかりません。手動でログインしてください。');
    return false;
  }

  showSuccessNotification() {
    const notification = document.createElement('div');
    notification.textContent = '✅ 自動ログイン実行完了！';
    notification.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      background: #4CAF50;
      color: white;
      padding: 15px 20px;
      border-radius: 4px;
      box-shadow: 0 2px 10px rgba(0,0,0,0.3);
      z-index: 10000;
      font-size: 16px;
      font-family: sans-serif;
      font-weight: bold;
    `;
    
    document.body.appendChild(notification);
    
    setTimeout(() => {
      notification.remove();
    }, 3000);
  }

  retry(sequence) {
    if (this.retryCount < this.maxRetries) {
      this.retryCount++;
      console.log(`Retrying... (${this.retryCount}/${this.maxRetries})`);
      
      setTimeout(() => {
        this.handle2FAData(sequence);
      }, 2000);
    } else {
      console.error('Max retries reached');
      this.showError('絵文字の選択に失敗しました。手動で操作してください。');
      this.retryCount = 0;
    }
  }

  showError(message) {
    const notification = document.createElement('div');
    notification.textContent = message;
    notification.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      background: #f44336;
      color: white;
      padding: 15px 20px;
      border-radius: 4px;
      box-shadow: 0 2px 5px rgba(0,0,0,0.2);
      z-index: 10000;
      font-size: 14px;
      font-family: sans-serif;
    `;
    
    document.body.appendChild(notification);
    
    setTimeout(() => {
      notification.remove();
    }, 5000);
  }

  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

const automation = new RakutenSecurities2FAAutomation();

console.log('Rakuten Securities 2FA Automation content script loaded');