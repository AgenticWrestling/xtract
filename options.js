// Options page JavaScript for Xtract extension

let currentDomains = {};

// Load and display settings and domain rules
async function loadSettings() {
  const result = await chrome.storage.sync.get(['domains', 'uploadUrl']);
  currentDomains = result.domains || {};
  
  // Set upload URL
  const uploadUrlInput = document.getElementById('upload-url');
  if (uploadUrlInput) {
    uploadUrlInput.value = result.uploadUrl || 'http://localhost:9809';
  }

  renderDomainList();
}

// Render the list of domain rules
function renderDomainList() {
  const listContainer = document.getElementById('domain-list');

  if (Object.keys(currentDomains).length === 0) {
    listContainer.innerHTML = '<div class="empty-state">No domain rules configured yet. Click "Add Domain Rule" to get started.</div>';
    return;
  }

  listContainer.innerHTML = '';

  Object.keys(currentDomains).forEach((domain) => {
    const config = currentDomains[domain];
    const item = document.createElement('div');
    item.className = 'domain-item';

    const info = document.createElement('div');
    info.className = 'domain-info';

    const name = document.createElement('div');
    name.className = 'domain-name';
    name.textContent = domain;

    const details = document.createElement('div');
    details.className = 'domain-details';
    const detailsParts = [];
    if (config.rootSelector) detailsParts.push(`Root: ${config.rootSelector}`);
    if (config.codeBlockSelector) detailsParts.push(`Code: ${config.codeBlockSelector}`);
    if (config.blockQuoteSelector) detailsParts.push(`Quote: ${config.blockQuoteSelector}`);
    if (config.titleSelector) detailsParts.push(`Title: ${config.titleSelector}`);
    if (config.excludeSelectors && config.excludeSelectors.length > 0) {
      detailsParts.push(`Excludes: ${config.excludeSelectors.length} selector(s)`);
    }
    details.textContent = detailsParts.join(' • ');

    info.appendChild(name);
    info.appendChild(details);

    const actions = document.createElement('div');
    actions.className = 'domain-actions';

    const editBtn = document.createElement('button');
    editBtn.textContent = 'Edit';
    editBtn.onclick = () => editDomain(domain);

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'delete';
    deleteBtn.textContent = 'Delete';
    deleteBtn.onclick = () => deleteDomain(domain);

    actions.appendChild(editBtn);
    actions.appendChild(deleteBtn);

    item.appendChild(info);
    item.appendChild(actions);

    listContainer.appendChild(item);
  });
}

// Show the add/edit form
function showForm(isEdit = false, domain = null) {
  const form = document.getElementById('domain-form');
  const title = document.getElementById('form-title');
  const editIndex = document.getElementById('edit-index');

  if (isEdit && domain) {
    title.textContent = 'Edit Domain Rule';
    editIndex.value = domain;

    const config = currentDomains[domain];
    document.getElementById('domain').value = domain;
    document.getElementById('root-selector').value = config.rootSelector || '';
    document.getElementById('code-block-selector').value = config.codeBlockSelector || '';
    document.getElementById('blockquote-selector').value = config.blockQuoteSelector || '';
    document.getElementById('title-selector').value = config.titleSelector || '';
    document.getElementById('exclude-selectors').value =
      (config.excludeSelectors || []).join(', ');
  } else {
    title.textContent = 'Add Domain Rule';
    editIndex.value = '';
    document.getElementById('rule-form').reset();
  }

  form.classList.remove('hidden');
  document.getElementById('domain').focus();
}

// Hide the form
function hideForm() {
  document.getElementById('domain-form').classList.add('hidden');
  document.getElementById('rule-form').reset();
}

// Edit a domain rule
function editDomain(domain) {
  showForm(true, domain);
}

// Delete a domain rule
async function deleteDomain(domain) {
  if (!confirm(`Delete rule for ${domain}?`)) {
    return;
  }

  delete currentDomains[domain];
  await chrome.storage.sync.set({ domains: currentDomains });
  showMessage('Domain rule deleted successfully');
  loadSettings();
}

// Save a domain rule
async function saveDomain(event) {
  event.preventDefault();

  const domain = document.getElementById('domain').value.trim();
  const rootSelector = document.getElementById('root-selector').value.trim();
  const codeBlockSelector = document.getElementById('code-block-selector').value.trim();
  const blockQuoteSelector = document.getElementById('blockquote-selector').value.trim();
  const titleSelector = document.getElementById('title-selector').value.trim();
  const excludeSelectorsText = document.getElementById('exclude-selectors').value.trim();
  const editIndex = document.getElementById('edit-index').value;

  // Parse exclude selectors
  const excludeSelectors = excludeSelectorsText
    ? excludeSelectorsText.split(',').map(s => s.trim()).filter(s => s)
    : [];

  // Build config object
  const config = {};
  if (rootSelector) config.rootSelector = rootSelector;
  if (codeBlockSelector) config.codeBlockSelector = codeBlockSelector;
  if (blockQuoteSelector) config.blockQuoteSelector = blockQuoteSelector;
  if (titleSelector) config.titleSelector = titleSelector;
  if (excludeSelectors.length > 0) config.excludeSelectors = excludeSelectors;

  // If editing and domain changed, remove old entry
  if (editIndex && editIndex !== domain) {
    delete currentDomains[editIndex];
  }

  // Add new/updated config
  currentDomains[domain] = config;

  // Save to storage
  await chrome.storage.sync.set({ domains: currentDomains });

  showMessage('Domain rule saved successfully');
  hideForm();
  loadSettings();
}

// Save general settings
async function saveGeneralSettings(event) {
  event.preventDefault();
  
  const uploadUrl = document.getElementById('upload-url').value.trim();
  
  await chrome.storage.sync.set({ uploadUrl });
  
  showMessage('Settings saved successfully');
}

// Show a temporary message
function showMessage(text) {
  const messageEl = document.getElementById('message');
  messageEl.textContent = text;
  messageEl.className = 'message success';
  messageEl.classList.remove('hidden');

  setTimeout(() => {
    messageEl.classList.add('hidden');
  }, 3000);
}

// Initialize event listeners
document.addEventListener('DOMContentLoaded', () => {
  loadSettings();

  const generalForm = document.getElementById('general-settings-form');
  if (generalForm) {
    generalForm.addEventListener('submit', saveGeneralSettings);
  }

  document.getElementById('add-domain-btn').addEventListener('click', () => {
    showForm(false);
  });

  document.getElementById('rule-form').addEventListener('submit', saveDomain);

  document.getElementById('cancel-btn').addEventListener('click', () => {
    hideForm();
  });
});
