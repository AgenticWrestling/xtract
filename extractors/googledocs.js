// Google Docs extractor for xtract
//
// Google Docs renders body text to a canvas, so the document text is not in
// the DOM at all. Instead we fetch the document's own HTML export (same-origin,
// uses the signed-in session), which gives us:
//   - the real body text
//   - one <a id="cmnt_refN"> anchor per comment reply, in document order
//   - the matching comment bodies collected at the end of the document
//   - embedded images inlined as data: URIs
//
// What the export does NOT give us is thread structure, authors or timestamps -
// it flattens every reply into its own [a], [b], [c] anchor. Those come from the
// live comments sidebar, which we stitch onto the export by matching comment
// text. The result is markdown with [N] footnote markers inline and a
// "# Comments" section listing one bullet per turn in each thread.

window.xtractExtractors = window.xtractExtractors || {};

window.xtractExtractors['docs.google.com'] = async function extractGoogleDoc() {
  const docId = googleDocId();
  if (!docId) return null;

  const exportDoc = await fetchExportDocument(docId);
  if (!exportDoc) return null;

  const refs = [...exportDoc.querySelectorAll('a[id^="cmnt_ref"]')];
  const exportComments = collectExportComments(exportDoc);
  const threads = collectSidebarThreads();

  const numbered = assignFootnotes(threads, refs, exportComments);

  // Comment bodies live at the end of the export; they become the "# Comments"
  // section instead, so drop them from the body.
  exportComments.forEach(c => c.container.remove());

  // Replace each anchor with its footnote marker (or drop it if we couldn't
  // place it in a thread).
  refs.forEach((ref, i) => {
    const marker = numbered.markerForRef.get(i);
    const target = ref.closest('sup') || ref;
    target.replaceWith(exportDoc.createTextNode(marker ? `[${marker}]` : ''));
  });

  // Quotes are read only now that every anchor carries its final marker -
  // otherwise a paragraph holding several comments would quote the export's
  // raw "[a]" "[b]" labels alongside the real ones.
  numbered.threads.forEach(thread => {
    thread.quote = thread.paragraph ? quoteAround(thread.paragraph, thread.marker) : '';
  });

  const mediaFiles = extractEmbeddedImages(exportDoc);

  const title = (exportDoc.querySelector('title')?.textContent || document.title || 'Document').trim();
  const body = htmlToSMD.convertElementToMarkdown(exportDoc.body, {});

  const parts = [`# ${title}`, '', body.trim()];
  const commentsSection = renderComments(numbered.threads);
  if (commentsSection) parts.push('', commentsSection);

  return { markdown: parts.join('\n'), mediaFiles };
};

// ---------------------------------------------------------------------------
// Export document
// ---------------------------------------------------------------------------

function googleDocId() {
  const match = window.location.pathname.match(/\/document\/(?:u\/\d+\/)?d\/([^/]+)/);
  return match ? match[1] : null;
}

async function fetchExportDocument(docId) {
  const url = `https://docs.google.com/document/d/${docId}/export?format=html`;
  const response = await fetch(url, { credentials: 'include' });
  if (!response.ok) {
    console.warn(`Xtract: Google Docs export failed with HTTP ${response.status}`);
    return null;
  }
  return new DOMParser().parseFromString(await response.text(), 'text/html');
}

// Each comment body in the export looks like:
//   <div><p><a href="#cmnt_ref1" id="cmnt1">[a]</a><span>comment text</span></p>...</div>
// Multi-paragraph comments add further <p> siblings inside the same div.
function collectExportComments(exportDoc) {
  return [...exportDoc.querySelectorAll('a[id^="cmnt"]')]
    .filter(a => !a.id.startsWith('cmnt_ref'))
    .map(anchor => {
      const container = anchor.closest('div') || anchor.parentElement;
      const clone = container.cloneNode(true);
      // Strip the "[a]" back-link so only the comment text remains.
      clone.querySelector('a[id^="cmnt"]')?.remove();
      return { container, text: normalize(clone.textContent) };
    });
}

// ---------------------------------------------------------------------------
// Sidebar threads
// ---------------------------------------------------------------------------

// textContent runs a multi-paragraph comment together ("...at the top?Like,
// is a Behavior..."), so honour the line breaks the sidebar renders.
function blockText(element) {
  const clone = element.cloneNode(true);
  clone.querySelectorAll('br').forEach(br => br.replaceWith('\n'));
  clone.querySelectorAll('p, div').forEach(block => block.append('\n'));
  return clone.textContent.replace(/\n{2,}/g, '\n').trim();
}

// The comments sidebar renders one child per thread, each holding its replies
// in chronological order.
function collectSidebarThreads() {
  const stream = document.querySelector('.docos-stream-view');
  if (!stream) return [];

  return [...stream.children]
    .map(threadEl => ({
      replies: [...threadEl.querySelectorAll('.docos-replyview')]
        .map(replyEl => {
          const bodyEl = replyEl.querySelector('.docos-replyview-body');
          if (!bodyEl) return null;
          const authorEl = replyEl.querySelector('.docos-author');
          const stampEl = replyEl.querySelector('.docos-replyview-timestamp span');
          return {
            author: authorEl?.getAttribute('data-name') || authorEl?.textContent.trim() || 'Unknown',
            timestamp: absoluteTimestamp(stampEl ? stampEl.textContent : ''),
            text: blockText(bodyEl)
          };
        })
        .filter(Boolean)
    }))
    .filter(thread => thread.replies.length > 0);
}

// The sidebar only ever renders relative labels ("3:48 PM Yesterday", "Aug 12"),
// so resolve them against the extraction time. Labels we can't parse are kept
// verbatim rather than guessed at.
function absoluteTimestamp(label, now = new Date()) {
  const raw = label.replace(/\s+/g, ' ').trim();

  const clock = raw.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?\s*(Today|Yesterday)?$/i);
  if (clock) {
    let hours = parseInt(clock[1], 10);
    const minutes = clock[2];
    const meridiem = clock[3];
    if (meridiem) {
      const isPM = meridiem.toUpperCase() === 'PM';
      if (isPM && hours !== 12) hours += 12;
      if (!isPM && hours === 12) hours = 0;
    }

    const date = new Date(now);
    if (/yesterday/i.test(clock[4] || '')) date.setDate(date.getDate() - 1);

    return `${isoDate(date)} ${String(hours).padStart(2, '0')}:${minutes}`;
  }

  // "Aug 12" / "Aug 12, 2025" - a date with no time of day.
  const calendar = raw.match(/^([A-Za-z]{3,})\s+(\d{1,2})(?:,\s*(\d{4}))?$/);
  if (calendar) {
    const month = MONTHS.indexOf(calendar[1].slice(0, 3).toLowerCase());
    if (month !== -1) {
      const year = calendar[3] ? parseInt(calendar[3], 10) : now.getFullYear();
      return isoDate(new Date(year, month, parseInt(calendar[2], 10)));
    }
  }

  return raw;
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

function isoDate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// Stitching sidebar threads onto export anchors
// ---------------------------------------------------------------------------

// Match every sidebar reply to the export comment carrying the same text, which
// tells us where in the document that thread is anchored.
//
// Exact text matching handles most replies. The rest differ in ways that are
// presentational only: the export appends emoji-reaction summaries to a comment
// body, and it keeps literal _underscores_ where the sidebar renders italics.
// So an exact pass runs first, then a prefix pass over whatever is left, and
// anything still unmatched falls back to document order.
function assignFootnotes(threads, refs, exportComments) {
  const keys = exportComments.map(comment => matchKey(comment.text));
  const used = new Set();

  const takeMatch = text => {
    const key = matchKey(text);

    let index = keys.findIndex((candidate, i) => !used.has(i) && candidate === key);
    if (index === -1 && key.length > 20) {
      index = keys.findIndex((candidate, i) =>
        !used.has(i) && (candidate.startsWith(key.slice(0, 60)) || key.startsWith(candidate.slice(0, 60))));
    }
    if (index === -1) return null;

    used.add(index);
    return index;
  };

  const placed = threads.map((thread, order) => {
    const indices = thread.replies.map(reply => takeMatch(reply.text)).filter(i => i !== null);
    // Anchor the thread at its earliest matched reply; unmatched threads keep
    // their sidebar order, which is document order too.
    const anchorIndex = indices.length ? Math.min(...indices) : Number.MAX_SAFE_INTEGER;
    return { ...thread, anchorIndex, order };
  });

  placed.sort((a, b) => a.anchorIndex - b.anchorIndex || a.order - b.order);

  const markerForRef = new Map();
  placed.forEach((thread, i) => {
    thread.marker = i + 1;
    const ref = refs[thread.anchorIndex];
    if (!ref) return;
    // Hold on to the paragraph now; the anchor itself is about to be replaced.
    thread.paragraph = ref.closest('p, li, td, h1, h2, h3, h4, h5, h6') || ref.parentElement;
    markerForRef.set(thread.anchorIndex, thread.marker);
  });

  return { threads: placed, markerForRef };
}

// A comparison key that ignores the presentational differences between how the
// export and the sidebar render the same comment.
function matchKey(text) {
  return (text || '')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/[_*~]/g, '')
    .replace(/[\s ]/g, '')
    .toLowerCase();
}

// The bit of document text the footnote hangs off, with the marker shown in
// place: "... is some[1] text ...".
function quoteAround(paragraph, marker, context = 40) {
  const full = normalize(paragraph.textContent);
  const needle = `[${marker}]`;
  const at = full.indexOf(needle);
  if (at === -1) return truncate(full, context * 2);

  const end = at + needle.length;
  const before = full.slice(Math.max(0, at - context), at);
  const after = full.slice(end, end + context);

  return `${at > context ? '...' : ''}${before}${needle}${after}${end + context < full.length ? '...' : ''}`;
}

function renderComments(threads) {
  const withMarkers = threads.filter(t => t.marker);
  if (!withMarkers.length) return '';

  const lines = ['# Comments', ''];
  withMarkers.forEach(thread => {
    // A comment anchored to an image or an empty paragraph has nothing to
    // quote but the markers themselves - drop the quote rather than print it.
    const quote = /[\p{L}\p{N}]/u.test(thread.quote.replace(/\[\d+\]/g, '')) ? thread.quote : '';
    lines.push(quote ? `^${thread.marker} "${quote}"` : `^${thread.marker}`);
    thread.replies.forEach(reply => {
      lines.push(`- ${reply.timestamp} (${reply.author}) ${collapseTurn(reply.text)}`);
    });
    lines.push('');
  });

  return lines.join('\n').trim();
}

// Keep one turn on one bullet: indent any wrapped paragraphs under it.
function collapseTurn(text) {
  return text.trim().split(/\n+/).map(line => line.trim()).filter(Boolean).join('\n  ');
}

// ---------------------------------------------------------------------------
// Embedded images
// ---------------------------------------------------------------------------

// The export inlines genuinely embedded images as data: URIs - which is exactly
// the set we want, and excludes avatars, emoji-picker sprites and other UI
// chrome that scraping the live page would drag in.
function extractEmbeddedImages(exportDoc) {
  const mediaFiles = [];

  [...exportDoc.querySelectorAll('img[src^="data:"]')].forEach((img, index) => {
    const blob = dataUriToBlob(img.getAttribute('src'));
    if (!blob) return;

    const extension = (blob.type.split('/')[1] || 'bin').replace(/[^a-z0-9]/gi, '');
    const filename = `${index}_image.${extension}`;
    mediaFiles.push({ filename, blob });
    img.setAttribute('src', filename);
  });

  return mediaFiles;
}

function dataUriToBlob(uri) {
  const match = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(uri || '');
  if (!match) return null;

  const [, mimeType = 'application/octet-stream', base64, payload] = match;
  try {
    if (!base64) return new Blob([decodeURIComponent(payload)], { type: mimeType });

    const binary = atob(payload);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: mimeType });
  } catch (error) {
    console.warn('Xtract: could not decode embedded image', error);
    return null;
  }
}

// ---------------------------------------------------------------------------

// Non-breaking spaces are everywhere in Docs exports; fold them into ordinary
// whitespace so export text and sidebar text compare equal.
function normalize(text) {
  return (text || '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
}

function truncate(text, limit) {
  return text.length > limit ? `${text.slice(0, limit)}...` : text;
}
