// Just enough Markdown to read a review comment.
//
// Review prose is written in a GitHub textarea, so it arrives full of backticks,
// bullets and fenced blocks. Rendering it verbatim turns `X-Client-Id` into
// three tokens of punctuation and a list into a column of hyphens, which is how
// a comment ends up harder to read in a Git client than in a browser.
//
// This is not a Markdown implementation and does not try to be. It covers what
// people actually type at each other about code — code spans and fences,
// emphasis, lists, quotes, headings, links — and leaves everything else as the
// text it was.
//
// Safety comes from the order of operations: the input is escaped **first**, so
// by the time any rule runs there is no live markup left in it, and every tag
// in the output is one this file wrote. Nothing here interpolates raw input
// into HTML. Links are the one place a value from the text reaches an
// attribute, so their URLs are checked against http(s) and carried in a data-
// attribute that the UI opens through the main process, never as a live href.

export function escapeHtml(text) {
  return String(text == null ? '' : text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Entities have to come back off a URL before it is handed to the browser: an
// escaped ampersand in a query string is not the same URL.
function unescapeUrl(url) {
  return url.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}

const SAFE_URL = /^https?:\/\/[^\s<>"]+$/i;

function linkTag(url, label) {
  const href = unescapeUrl(url);
  if (!SAFE_URL.test(href)) return label;
  // No href: the renderer must not navigate. The click is handled by whoever
  // mounts this, which passes the URL to the main process instead.
  return `<a class="md-link" data-href="${escapeHtml(href)}">${label}</a>`;
}

// Inline rules, applied to already-escaped text. Code spans go first and their
// contents are parked, so emphasis and links inside `like *this*` stay literal.
function inline(text) {
  // Parked in private-use code points, which cannot occur in the text itself,
  // so restoring them cannot collide with anything the author actually wrote.
  const spans = [];
  let out = text.replace(/`([^`]+)`/g, (_, code) => {
    spans.push(code);
    return `\uE000${spans.length - 1}\uE001`;
  });

  out = out.replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, (whole, label, url) => linkTag(url, label));
  // Bare URLs, but not ones already inside a link tag above.
  out = out.replace(/(^|[\s(])((?:https?:\/\/)[^\s<>"')]+)/g, (whole, before, url) =>
    `${before}${linkTag(url, url)}`);

  out = out.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/(^|[\s(])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  out = out.replace(/(^|[\s(])_([^_\n]+)_/g, '$1<em>$2</em>');
  out = out.replace(/~~([^~\n]+)~~/g, '<del>$1</del>');

  return out.replace(/\uE000(\d+)\uE001/g, (_, i) => `<code>${spans[Number(i)]}</code>`);
}

const LIST_ITEM = /^\s*([-*+]|\d+[.)])\s+(.*)$/;
const HEADING = /^(#{1,6})\s+(.*)$/;
// Matched against escaped text, where a quote marker is already `&gt;` — the
// one block marker that escaping touches, and the reason quotes silently
// rendered as literal text until they were tested.
const QUOTE = /^&gt;\s?(.*)$/;

// Whether a line opens a block of its own, and so cannot be the continuation
// of the one before it.
function isBlockStart(line) {
  return LIST_ITEM.test(line) || HEADING.test(line) || QUOTE.test(line) || /^\s*```/.test(line);
}

export function renderMarkdown(text) {
  const source = escapeHtml(text).replace(/\r\n?/g, '\n');
  const lines = source.split('\n');
  const html = [];

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    // Fenced code: everything up to the closing fence is left exactly as typed.
    const fence = /^\s*```(.*)$/.exec(line);
    if (fence) {
      const body = [];
      i += 1;
      while (i < lines.length && !/^\s*```/.test(lines[i])) body.push(lines[i++]);
      i += 1;   // the closing fence, or the end of the text
      html.push(`<pre class="md-code"><code>${body.join('\n')}</code></pre>`);
      continue;
    }

    if (!line.trim()) { i += 1; continue; }

    const heading = HEADING.exec(line);
    if (heading) {
      // One visual weight for all of them: a comment is not a document, and a
      // reviewer typing ### means "this bit matters", not "level three".
      html.push(`<div class="md-heading">${inline(heading[2])}</div>`);
      i += 1;
      continue;
    }

    if (LIST_ITEM.test(line)) {
      const ordered = /^\s*\d/.test(line);
      const items = [];
      while (i < lines.length && LIST_ITEM.test(lines[i])) {
        const parts = [LIST_ITEM.exec(lines[i])[2]];
        i += 1;
        // A hard-wrapped item continues on the next line without any marker.
        // Without this, the tail of a wrapped bullet falls out of the list and
        // becomes a paragraph of its own, hanging under it.
        while (i < lines.length && lines[i].trim() && !isBlockStart(lines[i])) {
          parts.push(lines[i].trim());
          i += 1;
        }
        items.push(`<li>${inline(parts.join(' '))}</li>`);
      }
      const tag = ordered ? 'ol' : 'ul';
      html.push(`<${tag} class="md-list">${items.join('')}</${tag}>`);
      continue;
    }

    if (QUOTE.test(line)) {
      const quoted = [];
      while (i < lines.length && QUOTE.test(lines[i])) {
        quoted.push(inline(QUOTE.exec(lines[i])[1]));
        i += 1;
      }
      html.push(`<blockquote class="md-quote">${quoted.join('<br>')}</blockquote>`);
      continue;
    }

    // A paragraph runs to the next blank line or block. Single newlines inside
    // it are kept as breaks: people lay out review comments by hand and a
    // reflowed one reads differently from what they wrote.
    const para = [];
    while (i < lines.length && lines[i].trim() && !isBlockStart(lines[i])) {
      para.push(inline(lines[i]));
      i += 1;
    }
    html.push(`<p class="md-p">${para.join('<br>')}</p>`);
  }

  return html.join('');
}

// Renders into an element and wires the links, which is what every caller
// wants: the markup alone cannot open anything on its own by design.
export function mountMarkdown(el, text, openExternal) {
  el.innerHTML = renderMarkdown(text);
  el.querySelectorAll('a.md-link').forEach(a => {
    a.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (openExternal) openExternal(a.dataset.href);
    });
  });
  return el;
}
