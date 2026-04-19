// Background service worker for Xtract extension

// Handle toolbar icon click
chrome.action.onClicked.addListener((tab) => {
  if (tab.id) {
    checkAndExtract(tab);
  }
});

// Handle keyboard shortcut
chrome.commands.onCommand.addListener(async (command) => {
  if (command === 'extract-page') {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.id) {
      checkAndExtract(tab);
    }
  }
});

// Check tab URL and trigger extraction
async function checkAndExtract(tab) {
  // Check if URL is restricted
  if (tab.url && (
    tab.url.startsWith('chrome://') ||
    tab.url.startsWith('chrome-extension://') ||
    tab.url.startsWith('edge://') ||
    tab.url.startsWith('about:')
  )) {
    console.warn('Cannot extract from browser internal pages');
    return;
  }
  
  await extractPage(tab.id);
}

// Function to inject content script and trigger extraction
async function extractPage(tabId) {
  try {
    console.log('Background: Injecting scripts into tab:', tabId);

    // Inject JSZip
    await chrome.scripting.executeScript({
      target: { tabId: tabId },
      files: ['lib/jszip.min.js']
    });

    // Inject dom-to-semantic-markdown
    await chrome.scripting.executeScript({
      target: { tabId: tabId },
      files: ['lib/dom-to-semantic-markdown.js']
    });

    // Inject content script
    await chrome.scripting.executeScript({
      target: { tabId: tabId },
      files: ['content.js']
    });

    // Inject toast CSS
    await chrome.scripting.insertCSS({
      target: { tabId: tabId },
      files: ['toast.css']
    });

    // Wait a moment for scripts to initialize
    await new Promise(resolve => setTimeout(resolve, 100));

    // Send message to start extraction
    console.log('Background: Sending extract message');
    await chrome.tabs.sendMessage(tabId, { action: 'extract' });
  } catch (error) {
    console.error('Background: Error injecting content script:', error);
  }
}

// Handle messages from content script and popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'upload_zip') {
    uploadToLocalhost(message.filename, message.data)
      .then(() => sendResponse({ success: true }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (message.action === 'trigger_extract') {
    chrome.tabs.get(message.tabId, (tab) => {
      if (tab) checkAndExtract(tab);
    });
    sendResponse({ status: 'triggered' });
  }
});

async function uploadToLocalhost(filename, base64Data) {
  try {
    // Get configured upload URL
    const config = await chrome.storage.sync.get(['uploadUrl']);
    const uploadUrl = config.uploadUrl || 'http://localhost:9809';

    // Convert base64 to Blob
    // In Service Workers, we might need to handle binary data carefully
    // fetch can accept a Blob or FormData
    
    // Decode base64 string
    const binaryString = atob(base64Data);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    const blob = new Blob([bytes], { type: 'application/zip' });

    const formData = new FormData();
    formData.append('file', blob, filename);

    console.log(`Background: Uploading to ${uploadUrl}...`);
    const response = await fetch(uploadUrl, {
      method: 'POST',
      body: formData
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Upload failed with status: ${response.status}. Response: ${errorText}`);
    }
  } catch (error) {
    console.error('Background: Upload error:', error);
    throw error;
  }
}
