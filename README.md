# xtract - Page to Markdown Extractor Extension

A Chrome extension that extracts web pages to markdown format with all media assets bundled in a convenient zipfile. Domain specific rules allow some customization of which DOM node(s) are extracted.

## Features

- Extract web pages to semantic markdown using [dom-to-semantic-markdown](https://github.com/romansky/dom-to-semantic-markdown)
- Download all media assets (images, videos, audio) with simplified filenames
- Per-domain extraction rules (customize root selector, code block classes, exclude elements)
- Progress toast showing extraction status
- Two ways to trigger: toolbar icon or keyboard shortcut (Ctrl+Shift+E / Cmd+Shift+E on Mac)
- Automatic upload to localhost:9809 (with fallback to download)

## Installation

1. Open Chrome and navigate to `chrome://extensions/`
2. Enable "Developer mode" (toggle in top-right corner)
3. Click "Load unpacked"
4. Select the `xtract` directory
5. The extension icon should appear in your toolbar

## Usage

### Basic Extraction

1. Navigate to any web page
2. Click the xtract icon in the toolbar OR press `Ctrl+Shift+E` (Windows/Linux) or `Cmd+Shift+E` (Mac)
3. Click "Extract Current Page" in the popup
4. Watch the progress toast in the bottom-right corner
5. A zip file will be uploaded to localhost:9809 (if available) or downloaded automatically

### Default Behavior

By default, the extension:

- Looks for a DOM element with `id="chat-history"` as the root
- Falls back to common selectors: `main`, `article`, `[role="main"]`, `.content`
- Converts `.code-block` divs to triple-backtick code blocks
- Converts `<code>` elements to inline code (single backticks)
- Names media files as: `<idx>_<lowercase_original_filename>.<ext>`

### Configuring Per-Domain Rules

1. Click the Xtract icon in the toolbar
2. Click "Settings" button
3. Click "Add Domain Rule"
4. Fill in the form:
   - **Domain**: The hostname to match (e.g., `example.com`, `*.github.com`)
   - **Root Selector**: CSS selector for the extraction root (default: `#chat-history`)
   - **Code Block Class**: CSS class for code blocks (default: `code-block`)
   - **Blockquote Selector**: CSS selector for elements to be rendered as blockquotes (optional)
   - **Exclude Selectors**: Comma-separated CSS selectors to exclude (e.g., `.ad, .sidebar`)
5. Click "Save Rule"

### Example Domain Configurations

**For GitHub:**

```text
Domain: github.com
Root Selector: .repository-content
Code Block Class: highlight
Exclude Selectors: .header, .footer, .sidebar
```

**For documentation sites:**

```text
Domain: docs.example.com
Root Selector: article
Code Block Class: code-block
Exclude Selectors: .navigation, .table-of-contents
```

## File Structure

```text
xtract/
├── manifest.json           # Extension configuration
├── background.js           # Service worker (keyboard shortcut handler)
├── content.js             # Main extraction logic
├── toast.css              # Progress toast styles
├── popup.html             # Toolbar popup UI
├── popup.js               # Popup logic
├── options.html           # Settings page UI
├── options.js             # Settings page logic
├── icons/                 # Extension icons
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
└── lib/                   # Third-party libraries
    ├── jszip.min.js
    └── dom-to-semantic-markdown.js
```

## How It Works

1. **Injection**: Background script injects libraries and content script into the current tab
2. **Configuration**: Content script loads domain-specific rules from chrome.storage
3. **Root Selection**: Finds the root element using configured selector with fallback strategy
4. **Preprocessing**: Clones and preprocesses DOM (removes excluded elements, marks code blocks)
5. **Markdown Conversion**: Uses dom-to-semantic-markdown to convert HTML to markdown
6. **Media Collection**: Extracts all media URLs, fetches as blobs, renames with pattern
7. **Zip Generation**: Uses JSZip to create archive with markdown file and media assets
8. **Download**: Triggers browser download with sanitized page title as filename

## Media Filename Pattern

Media files are renamed to: `<idx>_<lowercase_original_filename>.<fileext>`

Examples:

- `https://example.com/IMG_2024.PNG` → `0_img_2024.png`
- `https://cdn.com/user-avatar.jpg?v=2` → `1_user-avatar.jpg`

## Localhost Integration

To support automated workflows, the extension attempts to upload the generated ZIP file to `http://localhost:9809` immediately after extraction.

- **Success**: If a server is listening on port 9809 and accepts the POST request, the ZIP is uploaded, and no file download prompt appears.
- **Fallback**: If the upload fails (e.g., no server running), the extension automatically falls back to the standard browser download behavior.

This is useful for piping extracted content directly into other local tools or scripts.

## Limitations

- Media files behind CORS protections may not download (will show error in console)
- Very large pages may take time to process
- Chrome's download API may prompt for save location depending on settings
- Data URIs are not currently supported for media extraction

## Development

### Dependencies

- [dom-to-semantic-markdown](https://github.com/romansky/dom-to-semantic-markdown) - HTML to markdown conversion
- [JSZip](https://stuk.github.io/jszip/) - Zip file generation

### Building

The extension uses pre-built libraries from npm and CDN:

```bash
# Install dom-to-semantic-markdown
npm install dom-to-semantic-markdown

# Copy browser bundle
cp node_modules/dom-to-semantic-markdown/dist/browser/bundle.js lib/dom-to-semantic-markdown.js

# JSZip is fetched from CDN
curl -o lib/jszip.min.js https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js
```

### Testing

1. Test basic extraction on a simple HTML page
2. Test with images, videos, and other media
3. Test with pages that have `#chat-history` element
4. Test with pages that don't (verify fallback works)
5. Test code block conversion (`.code-block` divs and `<code>` elements)
6. Test domain-specific rules (add a rule for a test domain)
7. Test keyboard shortcut (Ctrl+Shift+E)
8. Test options page (add/edit/delete domain rules)

## Library Attribution

This extension uses the [dom-to-semantic-markdown](https://github.com/romansky/dom-to-semantic-markdown) library for converting HTML to Markdown. This library allows for robust and semantic markdown generation, including support for custom node rendering which powers the "Blockquote Selector" feature.

## Troubleshooting

**Extension doesn't inject:**

- Check that you have permissions for the page (some Chrome internal pages are blocked)
- Check the browser console for errors

**Zip doesn't download:**

- Check Chrome's download settings
- Look for errors in the toast notification

**Media files missing:**

- Check browser console for CORS errors
- Some sites block external requests for media

**Wrong content extracted:**

- Configure a domain-specific rule with the correct root selector
- Use browser DevTools to find the right CSS selector for your content

## License

This is a custom extension created for personal use. Dependencies are licensed under their respective licenses.
