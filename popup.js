// Popup JavaScript for Xtract extension

async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id) return;

  // If this domain already has a rule configured, skip the popup and extract immediately
  const hostname = tab.url ? new URL(tab.url).hostname : '';
  const result = await chrome.storage.sync.get(['domains']);
  const domains = result.domains || {};

  if (domains[hostname]) {
    await chrome.runtime.sendMessage({ action: 'trigger_extract', tabId: tab.id });
    window.close();
    return;
  }

  // Not configured — show the popup UI
  document.getElementById('popup-ui').style.display = 'block';
}

document.getElementById('extract-btn').addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id) return;
  await chrome.runtime.sendMessage({ action: 'trigger_extract', tabId: tab.id });
  window.close();
});

document.getElementById('extract-all-btn').addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id) return;
  await chrome.runtime.sendMessage({ action: 'trigger_extract_all', tabId: tab.id });
  window.close();
});

document.getElementById('options-btn').addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
  window.close();
});

init();
