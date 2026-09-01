// Content script for Xtract - extracts page to markdown with media

// Prevent multiple injections. chrome.scripting.executeScript re-injects this
// file into the same frame's isolated world on every extraction trigger, and
// that world persists across injections - so top-level `let`/`const` below
// would throw "already declared" SyntaxErrors on the second run if we didn't
// wrap everything in a function scope and bail out early here.
if (window.xtractLoaded) {
  console.log('Xtract content script already loaded');
} else {
  window.xtractLoaded = true;
  console.log('Xtract content script loading...');
  initXtract();
}

function initXtract() {

// Toast UI functions
let toastElement = null;

function showToast(message, isError = false) {
  if (!toastElement) {
    toastElement = document.createElement('div');
    toastElement.className = 'xtract-toast';
    document.body.appendChild(toastElement);
  }

  toastElement.textContent = message;
  toastElement.className = isError ? 'xtract-toast xtract-toast-error' : 'xtract-toast';
  toastElement.style.display = 'block';
}

function hideToast(delay = 2000) {
  setTimeout(() => {
    if (toastElement) {
      toastElement.style.display = 'none';
    }
  }, delay);
}

// Load configuration for current domain
async function loadConfig() {
  const hostname = window.location.hostname;

  try {
    const result = await chrome.storage.sync.get(['domains', 'defaults']);
    const domains = result.domains || {};
    const defaults = result.defaults || {
      rootSelector: '#chat-history',
      codeBlockSelector: '.code-block',
      excludeSelectors: []
    };

    // Check if there's a config for this domain
    if (domains[hostname]) {
      return { ...defaults, ...domains[hostname] };
    }

    return defaults;
  } catch (error) {
    console.error('Error loading config:', error);
    return {
      rootSelector: '#chat-history',
      codeBlockSelector: '.code-block',
      excludeSelectors: []
    };
  }
}

// Find root element with fallback strategy
function findRootElement(config) {
  const selectors = [
    config.rootSelector,
    '#chat-history',
    'main',
    'article',
    '[role="main"]',
    '.content'
  ];

  for (const selector of selectors) {
    try {
      const element = document.querySelector(selector);
      if (element) {
        console.log(`Found root element using selector: ${selector}`);
        return element;
      }
    } catch (e) {
      // Invalid selector, continue
    }
  }

  console.log('Using document.body as fallback');
  return document.body;
}

// Remove excluded elements
function removeExcludedElements(root, excludeSelectors) {
  if (!excludeSelectors || excludeSelectors.length === 0) {
    return;
  }

  excludeSelectors.forEach(selector => {
    try {
      const elements = root.querySelectorAll(selector);
      elements.forEach(el => el.remove());
    } catch (e) {
      console.warn(`Invalid exclude selector: ${selector}`);
    }
  });
}

// Store code blocks for later replacement
const codeBlockMap = new Map();
let codeBlockCounter = 0;

// Preprocess DOM for markdown conversion
function preprocessDOM(root, codeBlockSelector) {
  // Clone to avoid modifying original DOM
  const clone = root.cloneNode(true);

  // Clear code block map for this extraction
  codeBlockMap.clear();
  codeBlockCounter = 0;

  // Mark code blocks for proper conversion
  const codeBlocks = clone.querySelectorAll(codeBlockSelector);
  codeBlocks.forEach(block => {
    // Extract language from .code-block-decoration > span
    let language = '';
    const decorationDiv = block.querySelector('.code-block-decoration');
    if (decorationDiv) {
      const languageSpan = decorationDiv.querySelector('span');
      if (languageSpan) {
        language = languageSpan.textContent.trim().toLowerCase();
      }
      // Remove the decoration div from the block before extracting code
      decorationDiv.remove();
    }

    // Get the actual code content (after removing decoration)
    const codeContent = block.textContent.trim();

    // Create a unique placeholder
    const placeholder = `___XTRACT_CODE_BLOCK_${codeBlockCounter}___`;
    codeBlockCounter++;

    // Store the code block info
    codeBlockMap.set(placeholder, {
      language: language,
      code: codeContent
    });

    // Replace the block with a paragraph containing the placeholder
    const placeholderP = document.createElement('p');
    placeholderP.textContent = placeholder;
    block.replaceWith(placeholderP);
  });

  // Preprocess tables: Ensure headers exist
  // If a table's first row has no <th>, convert its <td>s to <th>s
  const tables = clone.querySelectorAll('table');
  tables.forEach(table => {
    const firstRow = table.querySelector('tr');
    if (firstRow) {
      if (!firstRow.querySelector('th')) {
        // Convert tds to ths in first row
        const cells = firstRow.querySelectorAll('td');
        cells.forEach(td => {
          const th = document.createElement('th');
          th.innerHTML = td.innerHTML;
          // Copy attributes
          Array.from(td.attributes).forEach(attr => {
            th.setAttribute(attr.name, attr.value);
          });
          td.replaceWith(th);
        });
        console.log('Converted first row of table to headers');
      }
    }
  });

  return clone;
}

// Post-process markdown to replace placeholders with properly formatted code blocks
function postprocessMarkdown(markdown) {
  let result = markdown;

  // Replace each placeholder with a properly formatted code block
  codeBlockMap.forEach((blockInfo, placeholder) => {
    const { language, code } = blockInfo;

    // Format: ```language\ncode\n```
    // No space between ``` and language
    const formattedBlock = language
      ? `\`\`\`${language}\n${code}\n\`\`\``
      : `\`\`\`\n${code}\n\`\`\``;

    // Replace the placeholder (it will be in markdown as plain text)
    result = result.replace(placeholder, formattedBlock);
  });

  return result;
}

// Convert DOM to markdown using dom-to-semantic-markdown
function convertToMarkdown(element, config = {}, titleOverride = null) {
  try {
    // Check if the library is loaded
    if (typeof htmlToSMD === 'undefined' || typeof htmlToSMD.convertElementToMarkdown === 'undefined') {
      throw new Error('dom-to-semantic-markdown library not loaded');
    }

    const options = {
      includeMetaData: 'extended'
    };

    // Blockquote selector support
    if (config.blockQuoteSelector) {
      options.overrideElementProcessing = (childElement, opts) => {
        try {
          // Check if element matches the selector
          // Note: Text nodes don't have matches()
          if (childElement.nodeType === 1 && childElement.matches && childElement.matches(config.blockQuoteSelector)) {
            console.log(`Matched blockquote selector: ${config.blockQuoteSelector}`);
            return [{
              type: 'blockquote',
              content: htmlToSMD.htmlToMarkdownAST(childElement, opts)
            }, {
              type: 'text',
              content: '\n'
            }];
          }
        } catch (e) {
           console.warn(`Invalid blockquote selector: ${config.blockQuoteSelector}`, e);
        }
        return undefined; // Continue default processing
      };
    }

    // To include metadata, the library needs to see the <head> element.
    // We create a temporary document structure that combines the page's head
    // with the extracted content element.
    const tempDoc = document.implementation.createHTMLDocument("");
    if (document.head) {
      // Import the head to the temporary document
      const headClone = tempDoc.importNode(document.head, true);
      tempDoc.head.replaceWith(headClone);
    }

    // Override title if provided
    if (titleOverride) {
      let titleTag = tempDoc.head.querySelector('title');
      if (!titleTag) {
        titleTag = tempDoc.createElement('title');
        tempDoc.head.appendChild(titleTag);
      }
      titleTag.textContent = titleOverride;
    }

    // element is already a clone (from preprocessDOM), so we can just append it
    // We put it in the body of our temp document
    tempDoc.body.appendChild(element);

    let markdown = htmlToSMD.convertElementToMarkdown(tempDoc.documentElement, options);

    // Manually inject location into frontmatter
    const locationUrl = window.location.href;
    const locationLine = `location: "${locationUrl}"`;
    
    if (markdown.startsWith('---\n')) {
      // Find the end of the frontmatter (look for \n---\n or \n---\n\n)
      const secondDashIndex = markdown.indexOf('\n---', 4);
      if (secondDashIndex !== -1) {
        // Insert before the closing dashes
        markdown = markdown.slice(0, secondDashIndex) + '\n' + locationLine + markdown.slice(secondDashIndex);
      } else {
        // Malformed frontmatter? Prepend new block
        markdown = `---\n${locationLine}\n---\n\n` + markdown;
      }
    } else {
      // No frontmatter, create one
      markdown = `---\n${locationLine}\n---\n\n` + markdown;
    }

    // Post-process to replace placeholders with proper code block formatting
    const processed = postprocessMarkdown(markdown);

    return processed;
  } catch (error) {
    console.error('Error converting to markdown:', error);
    // Fallback to simple text extraction
    return element.textContent || '';
  }
}

// Extract media URLs from element
function extractMediaUrls(element) {
  const mediaUrls = new Set();

  // Images
  const images = element.querySelectorAll('img');
  images.forEach(img => {
    if (img.src && !img.src.startsWith('data:')) {
      mediaUrls.add(img.src);
    }
    // Handle srcset
    if (img.srcset) {
      const srcsetUrls = img.srcset.split(',').map(s => s.trim().split(' ')[0]);
      srcsetUrls.forEach(url => {
        if (url && !url.startsWith('data:')) {
          mediaUrls.add(url);
        }
      });
    }
  });

  // Videos
  const videos = element.querySelectorAll('video, video source');
  videos.forEach(video => {
    if (video.src && !video.src.startsWith('data:')) {
      mediaUrls.add(video.src);
    }
  });

  // Audio
  const audios = element.querySelectorAll('audio, audio source');
  audios.forEach(audio => {
    if (audio.src && !audio.src.startsWith('data:')) {
      mediaUrls.add(audio.src);
    }
  });

  return Array.from(mediaUrls);
}

// Simplify filename according to pattern: <idx>_<lowercase_original_filename>.<fileext>
function simplifyFilename(url, index) {
  try {
    const urlObj = new URL(url);
    const pathname = urlObj.pathname;
    const filename = pathname.split('/').pop() || 'file';

    // Remove query params and get extension
    const parts = filename.split('.');
    const ext = parts.length > 1 ? parts.pop() : 'bin';
    const name = parts.join('.') || 'file';

    // Lowercase and sanitize
    const sanitized = name.toLowerCase().replace(/[^a-z0-9_-]/g, '_');

    return `${index}_${sanitized}.${ext.toLowerCase()}`;
  } catch (error) {
    return `${index}_file.bin`;
  }
}

// Download media file as blob
async function downloadMedia(url) {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      console.warn(`Can't download ${url}: HTTP ${response.status}`);
      return null;
    }
    return await response.blob();
  } catch (error) {
    const reason = error.message.includes('fetch') ? 'CORS or network error' : error.message;
    console.warn(`Can't download ${url}: ${reason}`);
    return null;
  }
}

// Collect all media files
async function collectMedia(element, markdown) {
  const mediaUrls = extractMediaUrls(element);
  const mediaFiles = [];
  const urlToFilename = new Map();

  showToast(`Processing media (0/${mediaUrls.length})...`);

  for (let i = 0; i < mediaUrls.length; i++) {
    const url = mediaUrls[i];
    const filename = simplifyFilename(url, i);

    showToast(`Processing media (${i + 1}/${mediaUrls.length})...`);

    const blob = await downloadMedia(url);
    if (blob) {
      mediaFiles.push({ filename, blob });
      urlToFilename.set(url, filename);
    }
  }

  // Update markdown to use new filenames
  let updatedMarkdown = markdown;
  urlToFilename.forEach((filename, url) => {
    updatedMarkdown = updatedMarkdown.replace(new RegExp(url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), filename);
  });

  return { mediaFiles, markdown: updatedMarkdown };
}

// Sanitize page title for filename
function sanitizeTitle(title) {
  return title
    .replace(/[/\\:*?"<>|]/g, '_')
    .replace(/\s+/g, '_')
    .substring(0, 100) || 'extracted';
}

// Generate and download zip file
async function generateZip(markdown, mediaFiles, pageTitle) {
  try {
    showToast('Creating zip file...');

    const zip = new JSZip();

    // Add markdown file
    const sanitizedTitle = sanitizeTitle(pageTitle);
    zip.file(`${sanitizedTitle}.md`, markdown);

    // Add media files
    mediaFiles.forEach(({ filename, blob }) => {
      zip.file(filename, blob);
    });

    // Generate zip blob
    const zipBlob = await zip.generateAsync({ type: 'blob' });
    const filename = `${sanitizedTitle}.zip`;

    // Try to upload to localhost:9809 via background script
    try {
      showToast(`Uploading ${sanitizedTitle} to localhost:9809...`);

      // Convert blob to base64 for message passing
      const base64Data = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result.split(',')[1]);
        reader.onerror = reject;
        reader.readAsDataURL(zipBlob);
      });

      const response = await chrome.runtime.sendMessage({
        action: 'upload_zip',
        filename: filename,
        data: base64Data
      });

      if (response && response.success) {
        showToast(`Uploaded ${filename} to localhost:9809 successfully!`);
        hideToast();
        return;
      } else {
        console.warn('Upload failed:', response ? response.error : 'Unknown error');
        showToast('Upload failed, falling back to download...');
      }
    } catch (uploadError) {
      console.warn('Upload to localhost:9809 failed:', uploadError);
      showToast('Upload failed, falling back to download...');
    }

    // Trigger download
    const downloadUrl = URL.createObjectURL(zipBlob);
    const a = document.createElement('a');
    a.href = downloadUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(downloadUrl);

    showToast('Extraction complete!');
    hideToast();
  } catch (error) {
    console.error('Error generating zip:', error);
    showToast('Error creating zip file', true);
    hideToast(4000);
  }
}

// Main extraction function
async function extractPage() {
  try {
    console.log('Xtract: Starting extraction...');
    showToast('Extracting DOM...');

    const config = await loadConfig();
    console.log('Xtract: Config loaded:', config);

    // Check for a site-specific extractor registered by an injected extractor script
    const hostname = window.location.hostname;
    const siteExtractor = window.xtractExtractors && (
      window.xtractExtractors[hostname] ||
      Object.keys(window.xtractExtractors).find(k => hostname === k || hostname.endsWith('.' + k))
        ? window.xtractExtractors[Object.keys(window.xtractExtractors).find(k => hostname === k || hostname.endsWith('.' + k))]
        : null
    );

    let rawTitle = document.title;
    if (config.titleSelector) {
      try {
        const titleEl = document.querySelector(config.titleSelector);
        if (titleEl) rawTitle = titleEl.textContent.trim();
      } catch (e) {
        console.warn('Invalid title selector:', e);
      }
    }

    let markdown;
    let mediaSourceRoot;

    if (siteExtractor) {
      showToast('Using site extractor...');
      const root = findRootElement(config);
      const extracted = siteExtractor(root);
      if (extracted) {
        const locationUrl = window.location.href;
        markdown = `---\nlocation: "${locationUrl}"\n---\n\n${extracted}`;
        mediaSourceRoot = root;
      }
    }

    if (!markdown) {
      // Generic path
      const root = findRootElement(config);
      const processed = preprocessDOM(root, config.codeBlockSelector || '');
      removeExcludedElements(processed, config.excludeSelectors);
      showToast('Converting to markdown...');
      markdown = convertToMarkdown(processed, config, rawTitle);
      mediaSourceRoot = root;
    }

    const { mediaFiles, markdown: updatedMarkdown } = await collectMedia(mediaSourceRoot, markdown);

    let pageTitle = rawTitle.replace(/[^\p{L}\p{N}\s]/gu, '').trim() || 'extracted';
    await generateZip(updatedMarkdown, mediaFiles, pageTitle);

  } catch (error) {
    console.error('Error during extraction:', error);
    showToast('Extraction failed: ' + error.message, true);
    hideToast(4000);
  }
}

// Return all currently rendered message items, sorted by their top position
function renderedMessageItems() {
  return Array.from(
    document.querySelectorAll('[data-feat="message"].c-virtual_list__item[data-item-key]')
  ).sort((a, b) => parseFloat(a.style.top) - parseFloat(b.style.top));
}

// Scroll to the very top by repeatedly scrollIntoView-ing the topmost rendered item
// until no new items appear above it.
async function scrollToTop() {
  showToast('Scrolling to top...');
  let stableRounds = 0;
  let lastTopKey = null;

  while (stableRounds < 3) {
    const items = renderedMessageItems();
    if (!items.length) break;

    const topItem = items[0];
    topItem.scrollIntoView({ block: 'start', behavior: 'instant' });
    await new Promise(r => setTimeout(r, 800));

    const newTopKey = topItem.dataset.itemKey;
    const newItems = renderedMessageItems();
    const newTopItemKey = newItems[0]?.dataset.itemKey || null;

    if (newTopItemKey === lastTopKey) {
      stableRounds++;
    } else {
      stableRounds = 0;
      lastTopKey = newTopItemKey;
    }
  }
}

// Extract all rows of a paginated table via a registered site paginator,
// producing a single JSON file instead of markdown/media.
async function extractAllViaPaginator(paginator) {
  try {
    showToast('Starting paginated extraction...');

    const result = await paginator((count, page) => {
      showToast(`Extracting... page ${page}, ${count} rows`);
    });

    if (!result) {
      showToast('No table found to extract', true);
      hideToast(4000);
      return;
    }

    const jsonString = JSON.stringify(result, null, 2);
    const rawTitle = document.title || 'extracted';
    const pageTitle = rawTitle.replace(/[^\p{L}\p{N}\s]/gu, '').trim() || 'extracted';
    await generateJsonDownload(jsonString, pageTitle);
  } catch (error) {
    console.error('Error during paginated extraction:', error);
    showToast('Paginated extraction failed: ' + error.message, true);
    hideToast(4000);
  }
}

// Upload (or download) a raw JSON payload, mirroring generateZip's delivery logic.
async function generateJsonDownload(jsonString, pageTitle) {
  try {
    showToast('Preparing JSON file...');

    const sanitizedTitle = sanitizeTitle(pageTitle);
    const filename = `${sanitizedTitle}.json`;
    const blob = new Blob([jsonString], { type: 'application/json' });

    try {
      showToast(`Uploading ${sanitizedTitle} to localhost:9809...`);

      const base64Data = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result.split(',')[1]);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });

      const response = await chrome.runtime.sendMessage({
        action: 'upload_zip',
        filename,
        data: base64Data
      });

      if (response && response.success) {
        showToast(`Uploaded ${filename} to localhost:9809 successfully!`);
        hideToast();
        return;
      } else {
        console.warn('Upload failed:', response ? response.error : 'Unknown error');
        showToast('Upload failed, falling back to download...');
      }
    } catch (uploadError) {
      console.warn('Upload to localhost:9809 failed:', uploadError);
      showToast('Upload failed, falling back to download...');
    }

    const downloadUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = downloadUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(downloadUrl);

    showToast('Extraction complete!');
    hideToast();
  } catch (error) {
    console.error('Error generating JSON file:', error);
    showToast('Error creating JSON file', true);
    hideToast(4000);
  }
}

// Extract all messages by scrolling through the full history
async function extractAllPages() {
  try {
    const hostname = window.location.hostname;

    // Prefer a registered paginator (e.g. ServiceNow list tables) over the
    // Slack-style virtual-scroll walk below.
    const paginatorKey = window.xtractPaginators && Object.keys(window.xtractPaginators).find(
      k => hostname === k || hostname.endsWith('.' + k)
    );
    if (paginatorKey) {
      await extractAllViaPaginator(window.xtractPaginators[paginatorKey]);
      return;
    }

    showToast('Starting full extraction...');

    const config = await loadConfig();
    const siteExtractor = window.xtractExtractors && (
      window.xtractExtractors[hostname] ||
      (() => {
        const key = Object.keys(window.xtractExtractors).find(k => hostname === k || hostname.endsWith('.' + k));
        return key ? window.xtractExtractors[key] : null;
      })()
    );

    await scrollToTop();

    // Walk forward through every message item, scrollIntoView to trigger lazy loading,
    // extract each unseen item as it becomes fully rendered.
    const seenKeys = new Set();
    const allMessageBlocks = [];
    const extractorState = { lastSenderName: '' };

    let stableRounds = 0;
    let lastBottomKey = null;

    while (stableRounds < 3) {
      const items = renderedMessageItems();
      const newItems = items.filter(el => !seenKeys.has(el.dataset.itemKey));

      for (const item of newItems) {
        item.scrollIntoView({ block: 'nearest', behavior: 'instant' });
        await new Promise(r => setTimeout(r, 80));

        // Skip placeholder/unprocessed items
        const container = item.querySelector('[data-qa="message_container"]');
        if (!container || container.dataset.qaUnprocessed === 'true' || container.dataset.qaPlaceholder === 'true') continue;

        seenKeys.add(item.dataset.itemKey);

        if (siteExtractor) {
          const tempRoot = document.createElement('div');
          tempRoot.appendChild(item.cloneNode(true));
          const block = siteExtractor(tempRoot, extractorState);
          if (block) allMessageBlocks.push(block);
        } else {
          const processed = preprocessDOM(item, config.codeBlockSelector || '');
          removeExcludedElements(processed, config.excludeSelectors);
          const block = convertToMarkdown(processed, config);
          if (block) allMessageBlocks.push(block);
        }
      }

      showToast(`Extracting... (${seenKeys.size} messages)`);

      // Scroll the last item into view to trigger loading of the next batch
      const allItems = renderedMessageItems();
      const bottomItem = allItems[allItems.length - 1];
      if (bottomItem) bottomItem.scrollIntoView({ block: 'end', behavior: 'instant' });
      await new Promise(r => setTimeout(r, 600));

      const newBottomKey = bottomItem?.dataset.itemKey || null;
      if (newBottomKey === lastBottomKey) {
        stableRounds++;
      } else {
        stableRounds = 0;
        lastBottomKey = newBottomKey;
      }
    }

    // Build final markdown
    let rawTitle = document.title;
    if (config.titleSelector) {
      try {
        const el = document.querySelector(config.titleSelector);
        if (el) rawTitle = el.textContent.trim();
      } catch (_) {}
    }

    const locationUrl = window.location.href;
    const combined = allMessageBlocks.join('\n');
    const markdown = `---\nlocation: "${locationUrl}"\n---\n\n${combined}`;

    showToast('Collecting media...');
    const root = findRootElement(config);
    const { mediaFiles, markdown: updatedMarkdown } = await collectMedia(root, markdown);

    let pageTitle = rawTitle.replace(/[^\p{L}\p{N}\s]/gu, '').trim() || 'extracted';
    await generateZip(updatedMarkdown, mediaFiles, pageTitle);

  } catch (error) {
    console.error('Error during full extraction:', error);
    showToast('Full extraction failed: ' + error.message, true);
    hideToast(4000);
  }
}

// Direct trigger used by background.js (via chrome.scripting.executeScript func),
// since chrome.tabs.sendMessage only reaches the top frame by default and some
// sites (e.g. ServiceNow classic UI) render content in a sub-frame.
window.xtractTriggerExtraction = function (action) {
  console.log('Content script triggered directly:', action);
  if (action === 'extract') extractPage();
  if (action === 'extract_all') extractAllPages();
};

// Listen for messages from background script (guard prevents duplicate listeners on re-injection)
if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
  if (!window.xtractListenerRegistered) {
    window.xtractListenerRegistered = true;
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      console.log('Content script received message:', message);
      if (message.action === 'extract') {
        extractPage();
        sendResponse({ status: 'started' });
      }
      if (message.action === 'extract_all') {
        extractAllPages();
        sendResponse({ status: 'started' });
      }
      return true;
    });
    console.log('Xtract: Message listener registered');
  }
} else {
  console.error('Xtract: chrome.runtime.onMessage not available');
}

} // end initXtract
