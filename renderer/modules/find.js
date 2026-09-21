// Cmd+F, kept to where the user is standing.
//
// Standing in an open file, it searches that file: a small bar over the diff,
// every match tinted and the current one brought into view. Anywhere else it
// means the other search in the window, the one over the commit list, and puts
// the caret in it. Which of the two is worked out the way Select All works it
// out: focus first, then the last press, then the selection.
//
// Matches are painted with the CSS Custom Highlight API rather than by wrapping
// them in spans, so the diff's own markup is never touched: nothing to undo on
// close, and nothing for a re-render to trip over.
import { $ } from './state.js';
import { icon } from '../icons.js';

// Each pair is the part of the window a press has to be inside of, and the
// rendered file within it that gets searched.
const REGIONS = [
  ['#wc-diff-panel', '#diff-content'],
  ['.changeset-file', '.changeset-file-diff'],
];
const LINE_TEXT = '.diff-line-content';

const isShown = (el) => el.isConnected && el.checkVisibility({ visibilityProperty: true });
// Open and actually showing a file, not a placeholder saying there is none.
const hasLines = (el) => !!el.querySelector(LINE_TEXT);

function filesAround(node) {
  const el = node instanceof Element ? node : node && node.parentElement;
  if (!el) return [];
  const found = [];
  for (const [region, file] of REGIONS) {
    const within = el.closest(region);
    if (!within) continue;
    found.push(within.matches(file) ? within : within.querySelector(file));
  }
  return found.filter(Boolean);
}

function scrollParent(el) {
  for (let p = el; p && p !== document.body; p = p.parentElement) {
    const { overflowY } = getComputedStyle(p);
    if (overflowY === 'auto' || overflowY === 'scroll') return p;
  }
  return document.body;
}

// ── The bar ──

let bar = null;
let input = null;
let countEl = null;
let target = null;       // the file being searched
let viewport = null;     // what scrolls it, which the bar sits in the corner of
let matches = [];
let current = -1;
let observer = null;
let resizer = null;
let pending = 0;

function buildBar() {
  bar = document.createElement('div');
  bar.id = 'find-bar';
  bar.hidden = true;
  bar.innerHTML = `
    <span class="find-bar-icon">${icon('search', 13)}</span>
    <input type="text" id="find-input" placeholder="Find in file" spellcheck="false">
    <span class="find-count"></span>
    <button type="button" class="find-prev" title="Previous (Shift+Enter)">${icon('chevron', 12)}</button>
    <button type="button" class="find-next" title="Next (Enter)">${icon('chevron', 12)}</button>
    <button type="button" class="find-close" title="Close (Esc)">${icon('close', 12)}</button>
  `;
  document.body.appendChild(bar);
  input = bar.querySelector('#find-input');
  countEl = bar.querySelector('.find-count');

  input.addEventListener('input', () => search({ keepPlace: false }));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); step(e.shiftKey ? -1 : 1); }
    else if (e.key === 'Escape') { e.preventDefault(); close(); }
  });
  bar.querySelector('.find-prev').addEventListener('click', () => step(-1));
  bar.querySelector('.find-next').addEventListener('click', () => step(1));
  bar.querySelector('.find-close').addEventListener('click', close);
}

function place() {
  if (!bar || bar.hidden || !viewport) return;
  const r = viewport.getBoundingClientRect();
  bar.style.top = `${Math.max(r.top, 0) + 8}px`;
  bar.style.right = `${Math.max(window.innerWidth - r.right, 0) + 16}px`;
}

function open(file) {
  if (!bar) buildBar();
  if (target !== file) {
    stopWatching();
    target = file;
    viewport = scrollParent(file);
    watch();
  }
  bar.hidden = false;
  place();
  input.focus();
  input.select();
  search({ keepPlace: true });
}

function close() {
  if (!bar || bar.hidden) return;
  bar.hidden = true;
  stopWatching();
  target = viewport = null;
  matches = [];
  current = -1;
  CSS.highlights.delete('find-match');
  CSS.highlights.delete('find-current');
}

// The file can change under the bar: the working copy redraws a diff on every
// poll, a file gets collapsed, another commit gets picked, the view changes.
// Anything that takes the file away closes the bar; anything that only redraws
// it searches again, keeping the place.
function watch() {
  const scope = target.closest('.view') || document.body;
  observer = new MutationObserver(() => {
    if (pending) return;
    pending = requestAnimationFrame(() => {
      pending = 0;
      if (!target || !isShown(target) || !hasLines(target)) { close(); return; }
      search({ keepPlace: true, quiet: true });
    });
  });
  observer.observe(scope, {
    subtree: true, childList: true, characterData: true,
    attributes: true, attributeFilter: ['class', 'style', 'hidden'],
  });
  resizer = new ResizeObserver(place);
  resizer.observe(viewport);
  window.addEventListener('resize', place);
}

function stopWatching() {
  if (observer) observer.disconnect();
  if (resizer) resizer.disconnect();
  window.removeEventListener('resize', place);
  if (pending) cancelAnimationFrame(pending);
  observer = resizer = null;
  pending = 0;
}

// The text of a line exactly as it reads on screen. A \uXXXX run is rendered
// twice, raw and decoded, with only one of the two showing, so only that one is
// searched.
function visibleTextNodes(lineEl) {
  const hide = document.body.classList.contains('decode-unicode') ? '.uni-raw' : '.uni-dec';
  const walker = document.createTreeWalker(lineEl, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.parentElement.closest(hide) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  const nodes = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n);
  return nodes;
}

// Case-insensitive, like every find bar people are used to. A match can span
// text nodes (an escape run in the middle of a word), so each line is read as
// one string and the offsets mapped back.
function findRanges(query) {
  const needle = query.toLowerCase();
  const ranges = [];
  for (const lineEl of target.querySelectorAll(LINE_TEXT)) {
    const nodes = visibleTextNodes(lineEl);
    const text = nodes.map(n => n.data).join('');
    const hay = text.toLowerCase();
    let at = hay.indexOf(needle);
    if (at < 0) continue;
    const starts = [];
    let sum = 0;
    for (const n of nodes) { starts.push(sum); sum += n.data.length; }
    const locate = (offset, end) => {
      // For an end offset, the node the match finishes in, not the next one.
      let i = nodes.length - 1;
      while (i > 0 && (end ? starts[i] >= offset : starts[i] > offset)) i--;
      return [nodes[i], offset - starts[i]];
    };
    while (at >= 0) {
      const range = document.createRange();
      range.setStart(...locate(at, false));
      range.setEnd(...locate(at + needle.length, true));
      ranges.push(range);
      at = hay.indexOf(needle, at + needle.length);
    }
  }
  return ranges;
}

function search({ keepPlace, quiet = false }) {
  if (!target) return;
  const query = input.value;
  const was = current;
  matches = query ? findRanges(query) : [];
  if (!matches.length) current = -1;
  else if (keepPlace && was >= 0) current = Math.min(was, matches.length - 1);
  else current = firstInView();
  paint({ reveal: !quiet });
}

// Starting from what is already on screen, so typing does not throw the view
// back to the top of a long file.
function firstInView() {
  const top = viewport.getBoundingClientRect().top;
  const i = matches.findIndex(r => r.getBoundingClientRect().bottom > top);
  return i < 0 ? 0 : i;
}

function step(delta) {
  if (!matches.length) return;
  current = (current + delta + matches.length) % matches.length;
  paint({ reveal: true });
}

function paint({ reveal }) {
  CSS.highlights.set('find-match', new Highlight(...matches));
  const now = matches[current];
  if (now) CSS.highlights.set('find-current', new Highlight(now));
  else CSS.highlights.delete('find-current');
  countEl.textContent = !input.value ? '' : matches.length ? `${current + 1}/${matches.length}` : 'No results';
  bar.classList.toggle('no-results', !!input.value && !matches.length);
  if (reveal && now) revealRange(now);
}

function revealRange(range) {
  const vp = viewport.getBoundingClientRect();
  const r = range.getBoundingClientRect();
  // Room for the sticky chunk header and the bar itself.
  const margin = 48;
  if (r.top < vp.top + margin || r.bottom > vp.bottom - margin) {
    viewport.scrollTop += r.top - vp.top - (vp.height / 2);
  }
}

// ── The shortcut ──

function focusHistorySearch() {
  const box = $('#history-search-bar');
  const field = $('#search-input');
  if (!box || box.hidden || !field) return false;
  field.focus();
  field.select();
  return true;
}

export function setupFind() {
  // Where the mouse last went down, worked out at the press for the same reason
  // Select All does: by the shortcut, a redraw may have replaced what was
  // pressed. The bar itself does not count as moving anywhere.
  let pressed = [];
  document.addEventListener('mousedown', (e) => {
    if (bar && bar.contains(e.target)) return;
    pressed = filesAround(e.target);
  }, true);

  document.addEventListener('keydown', (e) => {
    if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
    const key = e.key.toLowerCase();

    // Cmd+G and Cmd+Shift+G step through the matches while the bar is up.
    if (key === 'g' && bar && !bar.hidden) {
      e.preventDefault();
      step(e.shiftKey ? -1 : 1);
      return;
    }
    if (key !== 'f' || e.shiftKey) return;
    e.preventDefault();
    if (document.querySelector('.modal-overlay:not([hidden])')) return;

    // Again from inside the bar: stay on the same file, select the query.
    if (bar && !bar.hidden && bar.contains(e.target)) { input.select(); return; }

    const file = [
      ...filesAround(e.target),
      ...pressed,
      ...filesAround(window.getSelection().anchorNode),
    ].find(f => isShown(f) && hasLines(f));
    if (file) { open(file); return; }

    if (focusHistorySearch()) { close(); return; }

    // No search box in this view (the working copy): the file on screen is the
    // only thing there is to search.
    const shown = $('#diff-content');
    if (shown && isShown(shown) && hasLines(shown)) open(shown);
  });
}
