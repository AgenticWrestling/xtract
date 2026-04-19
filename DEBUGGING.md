# Debugging Guide

## Error: "Error extracting page"

If you see this error, follow these steps to diagnose:

### 1. Check Console Logs

Open the browser console to see detailed error messages:

1. **Open DevTools**: Press `F12` or `Ctrl+Shift+I` (Windows/Linux) or `Cmd+Option+I` (Mac)
2. **Go to Console tab**
3. Try extracting the page again
4. Look for messages starting with `Xtract:` or `Background:`

Expected console messages when working correctly:
```
Injecting scripts into tab: <number>
JSZip injected
dom-to-semantic-markdown injected
content.js injected
toast.css injected
Sending extract message
Xtract content script loading...
Xtract: Message listener registered
Content script received message: {action: 'extract'}
Xtract: Starting extraction...
Xtract: Loading config...
Xtract: Config loaded: {...}
```

### 2. Check Page Type

The extension **cannot** work on:
- `chrome://` pages (browser internal pages)
- `chrome-extension://` pages (extension pages)
- `edge://` pages (Edge browser internal pages)
- `about:` pages
- Chrome Web Store pages

If you're on one of these pages, you'll see: "Cannot extract from browser internal pages"

### 3. Check Permissions

Make sure the extension has permission to access the page:

1. Go to `chrome://extensions/`
2. Find "Xtract - Page to Markdown"
3. Check that it has these permissions:
   - Read and change all your data on all websites
   - Access downloads
   - Access storage

### 4. Reload the Extension

If scripts aren't loading:

1. Go to `chrome://extensions/`
2. Find "Xtract - Page to Markdown"
3. Click the refresh/reload icon
4. Refresh the page you want to extract
5. Try again

### 5. Check for Script Errors

Look for these specific errors in the console:

**"No runtime.sendMessage support"**
- This error is from the page itself, not the extension
- It's usually harmless
- The extension should still work

**"chrome.runtime.onMessage not available"**
- The content script couldn't register the message listener
- Try reloading the extension
- Make sure you're not on a restricted page

**"dom-to-semantic-markdown library not loaded"**
- The library file didn't inject properly
- Check that `lib/dom-to-semantic-markdown.js` exists
- Try reloading the extension

**"Error loading config"**
- chrome.storage.sync isn't available
- Check extension permissions
- This shouldn't prevent extraction (will use defaults)

### 6. Test with test.html

To verify the extension works at all:

1. Open the test page: `file:///path/to/xtract/test.html`
2. Try extracting
3. If this works, the issue is specific to the problem page
4. If this fails, there's an issue with the extension setup

### 7. Check Extension Service Worker

View the service worker console:

1. Go to `chrome://extensions/`
2. Find "Xtract - Page to Markdown"
3. Click "service worker" link
4. A new DevTools window opens showing background script logs
5. Try the keyboard shortcut (`Ctrl+Shift+E`) and watch for logs

### 8. Common Issues

**Multiple script injections**
- If you click the extension button multiple times quickly
- You'll see "Xtract content script already loaded" in console
- This is normal and prevents conflicts

**CORS errors for media**
- Some images/videos can't be downloaded due to CORS
- They'll be skipped with console warnings
- The extraction will still complete

**Large pages**
- Very large pages may take a while
- Watch the progress toast
- Check console for progress updates

### 9. File Checklist

Ensure all files exist:

```bash
ls -la
# Should show:
# - manifest.json
# - background.js
# - content.js
# - toast.css
# - popup.html/js
# - options.html/js
# - icons/icon*.png
# - lib/jszip.min.js
# - lib/dom-to-semantic-markdown.js
```

### 10. Still Not Working?

If none of the above helps:

1. **Uninstall and reinstall**: Remove the extension completely and reload it
2. **Try a different browser**: Test in a fresh Chrome profile
3. **Check file contents**: Make sure files weren't corrupted
4. **Review console logs**: Copy all console output for debugging

## Getting Help

When reporting issues, include:

1. What page you're trying to extract (URL)
2. Full console output from DevTools
3. Service worker console output
4. Chrome version
5. Extension version (check manifest.json)
6. Steps to reproduce

## Success Indicators

You'll know it's working when you see:

1. Progress toast appears in bottom-right corner
2. Toast updates: "Extracting DOM..." → "Converting..." → "Processing media..." → "Creating zip..."
3. Zip file downloads automatically
4. Console shows all injection and processing steps
5. No red errors in console

### 11. Upload to Localhost

The extension tries to upload the generated zip to `http://localhost:9809` before downloading.

- **Mechanism**: The content script sends the zip file to the background script, which performs the upload. This avoids CORS issues.
- **"Upload failed" toast**: This is normal if you don't have a server running on port 9809. It will fall back to standard download.
- **Check Network tab**:
    - **Content Script**: You won't see the upload request here (it's handled by background).
    - **Service Worker**: You can see the request in the Service Worker's Network tab (inspect the extension service worker).
