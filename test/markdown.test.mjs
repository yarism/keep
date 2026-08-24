// Tests for renderer/modules/markdown.js — the small Markdown subset used to
// render review prose.
//
// Two things matter here. The first is that it renders what people actually
// type at each other about code. The second is that it cannot be made to
// produce markup that was not in this file's own vocabulary: the text comes
// from anyone who can comment on a pull request.
import test from 'node:test';
import assert from 'node:assert';

import { loadEsm } from './helpers/esm.mjs';

const { renderMarkdown, escapeHtml } = await loadEsm('renderer/modules/markdown.js');

// ── the reason this exists ──

test('code spans stop a header name reading as punctuation', () => {
  assert.strictEqual(
    renderMarkdown('Set `X-Client-Id` on the request.'),
    '<p class="md-p">Set <code>X-Client-Id</code> on the request.</p>',
  );
});

test('a bullet list is a list, not a column of hyphens', () => {
  const html = renderMarkdown('- first\n- second');

  assert.strictEqual(html, '<ul class="md-list"><li>first</li><li>second</li></ul>');
});

test('a numbered list keeps its numbering', () => {
  assert.match(renderMarkdown('1. first\n2. second'), /^<ol class="md-list">/);
});

test('a fenced block is left exactly as typed', () => {
  const html = renderMarkdown('Try:\n```js\nif (a > b) return;\n```');

  assert.match(html, /<pre class="md-code"><code>if \(a &gt; b\) return;<\/code><\/pre>/);
});

test('emphasis, strikethrough and headings render', () => {
  assert.match(renderMarkdown('**very** _much_ ~~not~~'), /<strong>very<\/strong> <em>much<\/em> <del>not<\/del>/);
  assert.match(renderMarkdown('### Summary'), /<div class="md-heading">Summary<\/div>/);
});

test('a quote is a quote', () => {
  assert.match(renderMarkdown('> as you said\n> earlier'), /<blockquote class="md-quote">as you said<br>earlier<\/blockquote>/);
});

// People lay out review comments by hand — a hard-wrapped paragraph that gets
// reflowed reads differently from what its author saw when they wrote it.
test('single newlines inside a paragraph survive as breaks', () => {
  assert.strictEqual(renderMarkdown('one\ntwo'), '<p class="md-p">one<br>two</p>');
});

test('blank lines separate paragraphs', () => {
  assert.strictEqual(renderMarkdown('one\n\ntwo'), '<p class="md-p">one</p><p class="md-p">two</p>');
});

// ── the placeholder ──
//
// Code spans are lifted out before the other rules run and put back afterwards.
// An earlier draft parked them as a digit between two spaces, which is also how
// somebody writes "see line 3 for why".
test('restoring code spans cannot collide with ordinary prose', () => {
  const html = renderMarkdown('Use `a`, `b`, `c`, `d` and see line 3 for why.');

  assert.match(html, /and see line 3 for why\.$|and see line 3 for why\.<\/p>/);
  assert.strictEqual((html.match(/<code>/g) || []).length, 4);
});

test('a code span keeps its contents literal', () => {
  const html = renderMarkdown('`*not emphasis*` and `[not a link](x)`');

  assert.match(html, /<code>\*not emphasis\*<\/code>/);
  assert.match(html, /<code>\[not a link\]\(x\)<\/code>/);
});

// ── it cannot be made to emit markup of its own ──

test('markup in a comment is text, not markup', () => {
  const html = renderMarkdown('<img src=x onerror=alert(1)> and <b>bold?</b>');

  assert.doesNotMatch(html, /<img|<b>/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
});

test('a fenced block full of markup is still text', () => {
  const html = renderMarkdown('```\n<script>alert(1)</script>\n```');

  assert.doesNotMatch(html, /<script/);
  assert.match(html, /&lt;script&gt;/);
});

// The one place a value from the comment reaches an attribute.
test('a link carries its URL in a data attribute, never as a live href', () => {
  const html = renderMarkdown('see [the docs](https://example.com/a?x=1&y=2)');

  // The ampersand is entity-escaped in the attribute, which is what makes
  // `dataset.href` read back as the URL that was written.
  assert.match(html, /<a class="md-link" data-href="https:\/\/example\.com\/a\?x=1&amp;y=2">the docs<\/a>/);
  assert.doesNotMatch(html, / href="/, 'no navigable href in the renderer');
});

test('a javascript: URL is not a link at all', () => {
  const html = renderMarkdown('[click](javascript:alert(1))');

  assert.doesNotMatch(html, /<a /);
  assert.match(html, /click/);
});

test('a bare http URL is linked; a bare non-http one is not', () => {
  assert.match(renderMarkdown('see https://example.com now'), /<a class="md-link" data-href="https:\/\/example\.com">/);
  assert.doesNotMatch(renderMarkdown('see file:///etc/passwd now'), /<a /);
});

test('a quote mark in a URL cannot break out of the attribute', () => {
  const html = renderMarkdown('[x](https://example.com/"onmouseover="alert(1))');

  assert.doesNotMatch(html, /onmouseover=/);
});

// ── nothing in, nothing out ──

test('empty and absent text render nothing rather than failing', () => {
  assert.strictEqual(renderMarkdown(''), '');
  assert.strictEqual(renderMarkdown(null), '');
  assert.strictEqual(renderMarkdown(undefined), '');
});

test('escapeHtml covers the characters that can leave text', () => {
  assert.strictEqual(escapeHtml('<a href="x">&</a>'), '&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;');
});

// GitHub's comment box is narrow, so people hard-wrap their bullets. Without
// lazy continuation the tail of a wrapped item falls out of the list and hangs
// underneath it as a stray paragraph.
test('a hard-wrapped list item stays one item', () => {
  const html = renderMarkdown('- `sweep()` drops old buckets, so a long-running\n  process does not accumulate one per client.');

  assert.strictEqual((html.match(/<li>/g) || []).length, 1);
  assert.doesNotMatch(html, /<p class="md-p">/);
  assert.match(html, /so a long-running process does not accumulate/);
});

test('a blank line still ends the list', () => {
  const html = renderMarkdown('- one\n\nAfterwards.');

  assert.match(html, /<\/ul><p class="md-p">Afterwards\.<\/p>/);
});
