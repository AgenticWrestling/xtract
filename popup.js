// Popup JavaScript for Xtract extension

document.getElementById('extract-btn').addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (!tab || !tab.id) {
    alert('No active tab found');
    return;
  }

  try {
    await chrome.runtime.sendMessage({ action: 'trigger_extract', tabId: tab.id });
    window.close();
  } catch (error) {
    console.error('Trigger error:', error);
    alert(`Error: ${error.message}\n\nCheck console for details.`);
  }
});

document.getElementById('options-btn').addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
  window.close();
});
