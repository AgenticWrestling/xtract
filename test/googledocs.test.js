// Tests for the Google Docs extractor, run against fixtures captured from a
// real document: its HTML export and its live comments sidebar.
//
// The fixtures keep that document's structure but none of its words - see
// fixtures/sanitize.js. So these tests assert on shape and counts, and the
// counts below (16 threads, 32 replies, 3 embedded images) are properties of
// the captured document; re-capturing may legitimately change them.
//
//   node --test test/
//
// The extractor is browser code, so it runs here inside a jsdom window with
// fetch stubbed to serve the export fixture and htmlToSMD stubbed to a plain
// text dump - markdown conversion is the library's job, not this extractor's.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');

const FIXTURES = path.join(__dirname, 'fixtures');
const EXPORT_HTML = fs.readFileSync(path.join(FIXTURES, 'googledoc-export.html'), 'utf8');
const SIDEBAR_HTML = fs.readFileSync(path.join(FIXTURES, 'googledoc-sidebar.html'), 'utf8');
const EXTRACTOR_SOURCE = fs.readFileSync(path.join(__dirname, '..', 'extractors', 'googledocs.js'), 'utf8');

function runExtractor() {
  const dom = new JSDOM(`<!doctype html><body>${SIDEBAR_HTML}</body>`, {
    url: 'https://docs.google.com/document/d/EXAMPLEDOCUMENTID0000000000000000000000000000/edit?tab=t.0',
    runScripts: 'outside-only'
  });

  const { window } = dom;
  window.fetch = async () => ({ ok: true, status: 200, text: async () => EXPORT_HTML });
  // Stand-in for dom-to-semantic-markdown: plain text plus image references,
  // which is all these tests need to see.
  window.htmlToSMD = {
    convertElementToMarkdown: element =>
      element.textContent +
      [...element.querySelectorAll('img')].map(img => `\n![](${img.getAttribute('src')})`).join('')
  };

  vm.runInContext(EXTRACTOR_SOURCE, dom.getInternalVMContext());
  return window.xtractExtractors['docs.google.com']();
}

let result;
test.before(async () => {
  result = await runExtractor();
});

test('extracts the document body, not just the comments', () => {
  // The live page renders body text to canvas; the export is the only source.
  // A phrase that exists only in the export's body prose, not in any comment.
  // The words are filler (see fixtures/sanitize.js) but the punctuation and
  // structure are the real document's.
  assert.ok(result.markdown.includes('aliquip ex ea. Commodo "Consequat" duis aute irure'),
    'expected body prose from the document export');
  assert.ok(result.markdown.length > 15000,
    `expected a full document, got ${result.markdown.length} chars`);
});

test('emits one footnote per comment thread', () => {
  const footnotes = result.markdown.match(/^\^\d+\b/gm) || [];
  assert.strictEqual(footnotes.length, 16);
});

test('emits one bullet per turn, each with a timestamp and an author', () => {
  const comments = result.markdown.slice(result.markdown.indexOf('# Comments'));
  const bullets = comments.match(/^- .*$/gm) || [];
  assert.strictEqual(bullets.length, 32);

  for (const bullet of bullets) {
    assert.match(bullet, /^- (\d{4}-\d{2}-\d{2}( \d{2}:\d{2})?|\S.*?) \(.+?\) /,
      `bullet is missing a timestamp or author: ${bullet}`);
  }
});

test('resolves relative timestamps to absolute ones', () => {
  const comments = result.markdown.slice(result.markdown.indexOf('# Comments'));
  const bullets = comments.match(/^- .*$/gm) || [];
  const absolute = bullets.filter(b => /^- \d{4}-\d{2}-\d{2} \d{2}:\d{2} /.test(b));

  assert.strictEqual(absolute.length, bullets.length,
    'every sidebar label in this fixture is a clock time, so all should resolve');
});

test('footnote markers are placed inline in the body', () => {
  const body = result.markdown.slice(0, result.markdown.indexOf('# Comments'));
  for (let marker = 1; marker <= 16; marker++) {
    assert.ok(body.includes(`[${marker}]`), `missing inline marker [${marker}]`);
  }
});

test('each footnote quotes the text it is anchored to', () => {
  const quotes = result.markdown.match(/^\^\d+ ".*"$/gm) || [];
  // Two threads in this fixture hang off an image, where there is no
  // surrounding prose to quote; the rest all quote their anchor.
  assert.strictEqual(quotes.length, 14);
  for (const quote of quotes) {
    const marker = quote.match(/^\^(\d+)/)[1];
    assert.ok(quote.includes(`[${marker}]`), `quote should show its own marker: ${quote}`);
  }
});

test('threads are numbered in document order', () => {
  const body = result.markdown.slice(0, result.markdown.indexOf('# Comments'));
  const order = [...body.matchAll(/\[(\d+)\]/g)].map(m => Number(m[1]));
  assert.deepStrictEqual(order, [...order].sort((a, b) => a - b),
    'inline markers should ascend through the document');
});

test('collects only images genuinely embedded in the document', () => {
  assert.strictEqual(result.mediaFiles.length, 3,
    'this document embeds exactly 3 images; avatars and emoji must not be collected');

  for (const file of result.mediaFiles) {
    assert.match(file.filename, /^\d+_image\.(png|jpeg|jpg|gif|webp)$/);
    assert.ok(file.blob.size > 0, `${file.filename} is empty`);
  }
});

test('rewrites image references to the collected filenames', () => {
  for (const file of result.mediaFiles) {
    assert.ok(result.markdown.includes(`(${file.filename})`),
      `${file.filename} should be referenced from the markdown`);
  }
  assert.ok(!result.markdown.includes('data:image/'),
    'base64 payloads must not be inlined into the markdown');
});

test('drops the export trailing comment list from the body', () => {
  // The export collects every comment body at the end of the document. Those
  // belong in the Comments section only, so none of the text the extractor
  // reported as a comment may also appear in the body.
  const cut = result.markdown.indexOf('# Comments');
  const body = result.markdown.slice(0, cut);
  const commentTexts = (result.markdown.slice(cut).match(/^- .*$/gm) || [])
    .map(bullet => bullet.replace(/^- \S+( \d{2}:\d{2})? \(.+?\) /, ''));

  assert.strictEqual(commentTexts.length, 32);
  for (const text of commentTexts) {
    assert.ok(!body.includes(text), `comment text leaked into the body: ${text.slice(0, 60)}...`);
  }
});

test('returns null when the page is not a document', () => {
  const dom = new JSDOM('<!doctype html><body></body>', { url: 'https://docs.google.com/document/u/0/', runScripts: 'outside-only' });
  vm.runInContext(EXTRACTOR_SOURCE, dom.getInternalVMContext());
  return dom.window.xtractExtractors['docs.google.com']()
    .then(value => assert.strictEqual(value, null));
});
