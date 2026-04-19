# Installation Guide

## Quick Start

1. **Open Chrome Extensions Page**
   - Navigate to `chrome://extensions/`
   - Or click Menu → Extensions → Manage Extensions

2. **Enable Developer Mode**
   - Toggle "Developer mode" switch in the top-right corner

3. **Load the Extension**
   - Click "Load unpacked" button
   - Navigate to and select this directory: `/home/njr/code/org/xtract`
   - Click "Select Folder"

4. **Verify Installation**
   - You should see "Xtract - Page to Markdown" in your extensions list
   - The extension icon should appear in your toolbar (you may need to pin it)

## First Test

1. **Open the test page:**
   - Open `test.html` in Chrome (File → Open File → select test.html)
   - Or navigate to: `file:///home/njr/code/org/xtract/test.html`

2. **Extract the page:**
   - Method 1: Click the Xtract icon in toolbar → Click "Extract Current Page"
   - Method 2: Press `Ctrl+Shift+E` (Windows/Linux) or `Cmd+Shift+E` (Mac)

3. **Watch the progress:**
   - A toast notification appears in the bottom-right
   - Shows: "Extracting DOM..." → "Converting to markdown..." → "Processing media..." → "Creating zip..."

4. **Check the result:**
   - A file named `Xtract_Test_Page.zip` should download
   - Extract the zip file
   - Open `Xtract_Test_Page.md` to verify the markdown
   - Check that `0_test+image.png` is included

## Configuring Domain Rules

1. **Open Settings:**
   - Click the Xtract icon → Click "Settings" button
   - Or go to: `chrome://extensions/` → Xtract → Details → Extension options

2. **Add a Domain Rule:**
   - Click "Add Domain Rule"
   - Fill in the form:
     - **Domain**: e.g., `github.com` or `localhost`
     - **Root Selector**: e.g., `#chat-history` or `.main-content`
     - **Code Block Class**: e.g., `code-block` (default)
     - **Exclude Selectors**: e.g., `.sidebar, .ad, .navigation`
   - Click "Save Rule"

3. **Test the Rule:**
   - Navigate to a page on that domain
   - Extract the page
   - Verify the custom settings are applied

## Troubleshooting

### Extension won't load
- Make sure you selected the correct directory (the one containing `manifest.json`)
- Check for errors in the extensions page

### Extraction doesn't start
- Check that you have permission to access the page (some Chrome internal pages are blocked)
- Try refreshing the page and extracting again

### Media files missing
- Some sites block cross-origin requests (CORS)
- Check the browser console (F12) for errors
- This is a limitation of the browser's security model

### Wrong content extracted
- Configure a domain-specific rule with the correct root selector
- Use Chrome DevTools (F12) to inspect the page and find the right CSS selector
- Test different selectors in the options page

## Updating the Extension

If you make changes to the code:

1. Go to `chrome://extensions/`
2. Click the refresh icon on the Xtract extension card
3. Test your changes

## Uninstalling

1. Go to `chrome://extensions/`
2. Click "Remove" on the Xtract extension card
3. Confirm removal
