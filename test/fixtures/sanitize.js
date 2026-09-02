// Fixture sanitizer.
//
// The Google Docs fixtures are structural captures from a real document. The
// extractor is tested on how the export and the sidebar are SHAPED, never on
// what they say - but a raw capture also carries the document's prose, its
// authors' names and their email addresses, and this is a public repository.
//
// So this script replaces every word of prose in a capture with synthetic
// filler while preserving everything the extractor depends on:
//
//   - Element structure, classes, ids and the export's "[a]" comment anchors
//     are untouched; only text nodes are rewritten.
//   - Word and sentence counts are preserved, so paragraph shapes and the
//     quote-truncation paths stay realistic.
//   - Timestamps, numbers and date words pass through verbatim, because the
//     extractor parses them.
//   - Real names become fake names; emails, avatars, link targets and embedded
//     image payloads become placeholders.
//
// The one subtlety worth knowing: the extractor matches each sidebar reply to
// its export comment by text, so those 32 pairs must still read alike after
// sanitization. Rewriting each file independently does NOT achieve that - the
// export splits words across <span> elements where the sidebar does not, so
// per-text-node substitution diverges between the two. Instead we pair the
// comments up using the original text FIRST, then write one shared synthetic
// sentence into both sides of each pair.
//
// Usage, after re-capturing fixtures from a live document:
//
//   node test/fixtures/sanitize.js
//
// Re-run the tests afterwards; the counts they assert are properties of the
// captured document, so a new capture may legitimately change them.

const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const EXPORT = path.join(__dirname, 'googledoc-export.html');
const SIDEBAR = path.join(__dirname, 'googledoc-sidebar.html');

// Fake people, so that authors still read as authors rather than as filler.
// Deliberately NOT a real-name -> fake-name table: this script is committed, so
// hardcoding the real names here would both publish them and hand anyone the
// key to undo the anonymisation. The mapping is instead discovered from the
// capture at run time (see buildNameMap) and never written down.
const FAKE_NAMES = [
  'Alan Prewitt', 'Rosa Delgado', 'Kit Harlow', 'Ivo Bramwell',
  'Anouk Vasquez', 'Piotr Ferris', 'Wren Okafor', 'Sasha Lindqvist',
  'Mira Oyelaran', 'Teo Ravensworth', 'Nadia Ashcroft', 'Ellis Vantour',
];

// Every name the capture attributes a comment or avatar to, mapped onto the
// fake roster. Keyed per word as well as in full, because prose refers to
// people by first name and mentions them mid-sentence.
const NAMES = {};
function buildNameMap(docs) {
  const real = new Set();
  docs.forEach(doc => doc.querySelectorAll('[data-name], [alt]').forEach(el => {
    const value = (el.getAttribute('data-name') || el.getAttribute('alt') || '').trim();
    // A person, not a UI label: two or three capitalised words.
    if (/^[A-Z][a-z’']+( [A-Z][a-z’']+){1,2}$/.test(value)) real.add(value);
  }));

  [...real].sort().forEach((name, index) => {
    const fake = FAKE_NAMES[index % FAKE_NAMES.length].split(' ');
    NAMES[name] = fake.join(' ');
    name.split(' ').forEach((word, i) => { NAMES[word] = fake[i] || fake[fake.length - 1]; });
  });
}

// Date vocabulary the extractor parses out of sidebar timestamp labels. These
// must survive verbatim, as must anything containing a digit.
const KEEP = new Set([
  'AM', 'PM', 'Yesterday', 'Today',
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Sept', 'Oct', 'Nov', 'Dec',
  'January', 'February', 'March', 'April', 'June', 'July',
  'August', 'September', 'October', 'November', 'December',
  'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday',
]);

const LOREM = ('lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor '
  + 'incididunt ut labore et dolore magna aliqua enim ad minim veniam quis nostrud '
  + 'exercitation ullamco laboris nisi aliquip ex ea commodo consequat duis aute irure '
  + 'reprehenderit voluptate velit esse cillum dolore fugiat nulla pariatur excepteur sint '
  + 'occaecat cupidatat non proident sunt culpa qui officia deserunt mollit anim id laborum').split(' ');

// A deterministic filler stream. Advancing a single cursor across the whole run
// keeps the output varied without any dependence on the input's meaning.
let cursor = 0;

// Replace the words in a string with filler, preserving punctuation, spacing,
// capitalisation, entities, numbers and date vocabulary.
function fillText(text) {
  return text.replace(/&(?:[a-zA-Z]+|#\d+);|[A-Za-z][A-Za-z'’]*/g, token => {
    if (token.startsWith('&')) return token;             // markup, not prose
    if (NAMES[token]) return NAMES[token];
    if (token.length < 2 || KEEP.has(token)) return token;

    const word = LOREM[cursor++ % LOREM.length];
    return /^[A-Z]/.test(token) ? word[0].toUpperCase() + word.slice(1) : word;
  });
}

// Build a synthetic sentence of roughly `words` words, for a comment body.
function fillerSentence(words) {
  const out = [];
  for (let i = 0; i < Math.max(3, words); i++) out.push(LOREM[cursor++ % LOREM.length]);
  out[0] = out[0][0].toUpperCase() + out[0].slice(1);
  return out.join(' ') + '.';
}

const norm = s => (s || '').replace(/\s+/g, ' ').trim();

// The comparison key the extractor itself uses, so that the pairs we compute
// here are exactly the pairs it will compute at runtime.
const matchKey = text => (text || '')
  .replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-')
  .replace(/[_*~]/g, '').replace(/[\s ]/g, '').toLowerCase();

// ---------------------------------------------------------------------------

function scrubUrls(html) {
  html = html.replace(/data:image\/(png|jpe?g|gif|webp);base64,[A-Za-z0-9+/=]+/g, (_, type) => {
    const kind = type.startsWith('jp') ? 'jpeg' : 'png';
    return `data:image/${kind};base64,${PLACEHOLDER[kind]}`;
  });

  // No external URL is kept. The document links out to internal API
  // references whose paths alone describe unreleased surface area; the
  // extractor never reads href values and no test asserts on them.
  return html.replace(/\b(href|data-rawhref|src)="((?!data:)[^"]*)"/g, (whole, attr, url) =>
    (/^(\/\/|https?:\/\/)/.test(url) ? `${attr}="https://example.com/link"` : whole));
}

// 1x1 placeholders, so embedded images stay decodable and non-empty without
// carrying any of the document's actual artwork.
const PLACEHOLDER = {
  png: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=',
  jpeg: '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwcJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPDQ0Nf/AABEIAAEAAQMBIgACEQEDEQH/xAAfAAABBQEBAQEBAQAAAAAAAAABAgMEBQYHCAkKC//EALUQAAIBAwMCBAMFBQQEAAABfQECAwAEEQUSITFBBhNRYQcicRQygZGhCCNCscEVUtHwJDNicoIJChYXGBkaJSYnKCkqNDU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6g4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2drh4uPk5ebn6Onq8fLz9PX29/j5+v/aAAwDAQACEQMRAD8A/v4oor//2Q==',
};

// Every text node under `root`, in document order.
function textNodes(doc, root) {
  const walker = doc.createTreeWalker(root, 4 /* NodeFilter.SHOW_TEXT */);
  const nodes = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) nodes.push(node);
  return nodes;
}

// Put `sentence` into an element's text, collapsing it into the first text node
// and blanking the rest. Child elements - notably the export's comment anchor -
// are left in place.
function setElementText(doc, element, sentence) {
  const nodes = textNodes(doc, element).filter(n => !n.parentElement.closest('a[id^="cmnt"]'));
  if (!nodes.length) return;
  nodes[0].nodeValue = sentence;
  nodes.slice(1).forEach(node => { node.nodeValue = ''; });
}

// ---------------------------------------------------------------------------

const exportDom = new JSDOM(scrubUrls(fs.readFileSync(EXPORT, 'utf8')));
const sidebarDom = new JSDOM(`<!doctype html><body>${scrubUrls(fs.readFileSync(SIDEBAR, 'utf8'))}</body>`);
const exportDoc = exportDom.window.document;
const sidebarDoc = sidebarDom.window.document;

buildNameMap([exportDoc, sidebarDoc]);

// The export's comment bodies: the block holding each cmnt<N> anchor, with the
// anchor's own "[a]" label excluded.
const exportComments = [...exportDoc.querySelectorAll('a[id^="cmnt"]')]
  .filter(a => /^cmnt\d+$/.test(a.id))
  .map(anchor => {
    const block = anchor.closest('div, p') || anchor.parentElement;
    const clone = block.cloneNode(true);
    clone.querySelector('a[id^="cmnt"]')?.remove();
    return { block, key: matchKey(norm(clone.textContent)) };
  });

const sidebarReplies = [...sidebarDoc.querySelectorAll('.docos-replyview')]
  .map(reply => reply.querySelector('.docos-replyview-body'))
  .filter(Boolean)
  .map(body => ({ body, key: matchKey(norm(body.textContent)) }));

// Pair each reply with its export comment the same way the extractor does:
// exact key, then a prefix match for the replies whose export copy carries an
// appended emoji-reaction summary.
const usedExport = new Set();
let paired = 0;
const pairs = sidebarReplies.map(reply => {
  let index = exportComments.findIndex((c, i) => !usedExport.has(i) && c.key === reply.key);
  if (index === -1 && reply.key.length > 20) {
    index = exportComments.findIndex((c, i) => !usedExport.has(i)
      && (c.key.startsWith(reply.key.slice(0, 60)) || reply.key.startsWith(c.key.slice(0, 60))));
  }
  if (index !== -1) { usedExport.add(index); paired++; }
  return { reply, exportComment: index === -1 ? null : exportComments[index] };
});

console.log(`paired ${paired}/${sidebarReplies.length} sidebar replies to export comments`);
if (paired < sidebarReplies.length) {
  console.error('refusing to sanitize: unpaired replies would lose their anchors.');
  console.error('the capture may be incomplete, or already sanitized.');
  process.exit(1);
}

// One shared synthetic sentence per pair, written into both sides. Do this
// before the general sweep, so the general sweep leaves these alone.
const sanitizedComments = new Set();
pairs.forEach(({ reply, exportComment }) => {
  const sentence = fillerSentence(norm(reply.body.textContent).split(/\s+/).length);
  setElementText(sidebarDoc, reply.body, sentence);
  setElementText(exportDoc, exportComment.block, sentence);
  textNodes(sidebarDoc, reply.body).forEach(n => sanitizedComments.add(n));
  textNodes(exportDoc, exportComment.block).forEach(n => sanitizedComments.add(n));
});

// Everything else: body prose, UI chrome, author names, tooltips.
const ATTRS = ['data-name', 'alt', 'aria-label', 'data-tooltip', 'title', 'data-hovercard-id'];
[[exportDoc, EXPORT], [sidebarDoc, SIDEBAR]].forEach(([doc]) => {
  textNodes(doc, doc.body).forEach(node => {
    if (sanitizedComments.has(node)) return;
    if (node.parentElement?.closest('style, script')) return;
    node.nodeValue = fillText(node.nodeValue);
  });

  doc.querySelectorAll('*').forEach(element => {
    ATTRS.forEach(attr => {
      const value = element.getAttribute(attr);
      if (value) element.setAttribute(attr, fillText(value));
    });
  });
});

// A belt-and-braces pass over the serialised output. Emails can survive inside
// attributes we did not rewrite, and a document id identifies the source doc
// even with every word of it gone - so both are matched by shape rather than by
// value, and no real identifier is recorded in this script.
const finish = html => html
  .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, 'person@example.com')
  .replace(/\/d\/[A-Za-z0-9_-]{25,}/g, '/d/EXAMPLEDOCUMENTID0000000000000000000000000000');

fs.writeFileSync(EXPORT, finish(exportDom.serialize()));
fs.writeFileSync(SIDEBAR, finish(sidebarDoc.body.innerHTML));
console.log('sanitized both fixtures');
