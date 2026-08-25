import { $, escapeHtml, state } from './state.js';
import { icon } from '../icons.js';

// Escaped text, made readable.
//
// Localization files keep every non-ASCII string as \uXXXX escapes, so a diff of
// one is a wall of hex that says nothing about what the translation now reads.
// Each run of escapes is therefore rendered twice — raw and decoded — and CSS
// shows one or the other, which means a toggle flips every open diff at once
// without re-rendering any of them.
const ESCAPE_RUN = /(?:\\u[0-9a-fA-F]{4})+/g;
const STORAGE_KEY = 'keep.decodeUnicode';
let decodeUnicode = localStorage.getItem(STORAGE_KEY) === '1';
const toggles = [];

// Decoded as a run rather than one escape at a time, so a surrogate pair
// (\uD83D\uDE00) comes back out as the single character it encodes.
const decodeEscapes = (s) =>
  s.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));

function diffContent(text) {
  ESCAPE_RUN.lastIndex = 0;
  let html = '', last = 0, m;
  while ((m = ESCAPE_RUN.exec(text)) !== null) {
    const raw = m[0], dec = decodeEscapes(raw);
    html += escapeHtml(text.slice(last, m.index))
      + '<span class="uni">'
      + `<span class="uni-raw">${escapeHtml(raw)}</span>`
      + `<span class="uni-dec">${escapeHtml(dec)}</span>`
      + '</span>';
    last = m.index + raw.length;
  }
  // The overwhelmingly common case: no escapes, no extra markup.
  if (last === 0) return escapeHtml(text);
  return html + escapeHtml(text.slice(last));
}

// A toggle button, for a panel that shows diffs. Scoped rather than global: the
// button belongs next to the diff it decodes, and there is one such place per
// view, so each button asks its own container whether it has anything to do.
export function createUnicodeToggle(scopeEl) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'unicode-toggle';
  btn.innerHTML = `${icon('translate', 13)}<span>Translate</span>`;
  btn.title = 'Show \\uXXXX escapes as readable text';
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    decodeUnicode = !decodeUnicode;
    localStorage.setItem(STORAGE_KEY, decodeUnicode ? '1' : '0');
    refreshUnicodeToggles();
  });
  toggles.push({ btn, scopeEl, mounted: false });
  btn.classList.toggle('active', decodeUnicode);
  btn.hidden = true;
  return btn;
}

// Offering the toggle in front of a diff that holds no escapes would be a
// button that visibly does nothing, so each one appears only once its own panel
// has something to decode.
function refreshUnicodeToggles() {
  document.body.classList.toggle('decode-unicode', decodeUnicode);
  for (let i = toggles.length - 1; i >= 0; i--) {
    const t = toggles[i];
    // Drop buttons a re-render has replaced, but leave freshly created ones
    // alone until whoever asked for one has appended it.
    if (t.btn.isConnected) t.mounted = true;
    else if (t.mounted) { toggles.splice(i, 1); continue; }
    t.btn.classList.toggle('active', decodeUnicode);
    t.btn.setAttribute('aria-pressed', String(decodeUnicode));
    t.btn.hidden = !t.scopeEl.querySelector('.uni');
  }
}

// opts.annotate, when given, is called for every rendered line with the row
// element and where that row sits in the file — which side of the diff, and
// which line number on that side. It is how the review layer hangs comments off
// a diff without this module knowing that reviews exist.
export function renderDiff(diffText, containerOrId, stageableFile, opts = {}) {
  const container = typeof containerOrId === 'string' ? $(`#${containerOrId}`) : containerOrId;
  container.innerHTML = '';
  if (!diffText || !diffText.trim()) {
    container.innerHTML = '<div style="padding:20px;color:var(--text-dim)">No diff available (new or binary file)</div>';
    refreshUnicodeToggles();
    return;
  }
  const lines = diffText.split('\n');
  let oldLine = 0, newLine = 0;
  // Which hunk of this file we are on. Sent along with the header so applying
  // one cannot land on a different hunk if the file moved on underneath.
  let hunkIndex = -1;

  lines.forEach(line => {
    if (line.startsWith('@@')) {
      hunkIndex++;
      const match = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)/);
      if (match) { oldLine = parseInt(match[1]); newLine = parseInt(match[2]); }
      const hunkDiv = document.createElement('div');
      hunkDiv.className = 'diff-hunk-header';
      hunkDiv.innerHTML = `<span>${escapeHtml(line)}</span>`;
      if (stageableFile) {
        const at = hunkIndex;
        const btnGroup = document.createElement('span');
        btnGroup.style.cssText = 'display:flex;gap:4px';

        const discardBtn = document.createElement('button');
        discardBtn.textContent = 'Discard Chunk';
        discardBtn.style.background = 'var(--red)';
        discardBtn.addEventListener('click', async () => {
          if (!confirm('Discard this chunk? This cannot be undone.')) return;
          try {
            const hh = line.split('@@').slice(0, 2).join('@@') + '@@';
            await window.git.discardHunk(state.repoPath, stageableFile, hh, at);
            document.dispatchEvent(new Event('refresh-status'));
          } catch (e) { alert(e.message); }
        });

        const stageBtn = document.createElement('button');
        stageBtn.textContent = 'Stage Chunk';
        stageBtn.addEventListener('click', async () => {
          try {
            const hh = line.split('@@').slice(0, 2).join('@@') + '@@';
            await window.git.stageHunk(state.repoPath, stageableFile, hh, at);
            document.dispatchEvent(new Event('refresh-status'));
          } catch (e) { alert(e.message); }
        });

        btnGroup.appendChild(discardBtn);
        btnGroup.appendChild(stageBtn);
        hunkDiv.appendChild(btnGroup);
      }
      container.appendChild(hunkDiv);
      return;
    }
    if (line.startsWith('diff --git') || line.startsWith('index ') ||
        line.startsWith('---') || line.startsWith('+++') ||
        line.startsWith('new file') || line.startsWith('deleted file')) return;

    const div = document.createElement('div');
    div.className = 'diff-line';
    let cls = '', oldNum = '', newNum = '';
    if (line.startsWith('+')) { cls = 'add'; newNum = newLine++; }
    else if (line.startsWith('-')) { cls = 'del'; oldNum = oldLine++; }
    else { oldNum = oldLine++; newNum = newLine++; }
    if (cls) div.classList.add(cls);
    div.innerHTML = `<span class="diff-line-num">${oldNum}</span><span class="diff-line-num">${newNum}</span><span class="diff-line-content">${diffContent(line.substring(1))}</span>`;
    // Where this row is, in the terms a review comment is anchored by: a
    // deleted line only exists on the left, everything else — added *and*
    // unchanged — is addressed on the right.
    const anchor = cls === 'del'
      ? { side: 'LEFT', line: oldNum }
      : { side: 'RIGHT', line: newNum };
    div.dataset.side = anchor.side;
    div.dataset.line = String(anchor.line);
    container.appendChild(div);
    if (opts.annotate) opts.annotate(div, anchor, container);
  });

  refreshUnicodeToggles();
}

// A conflicted file, shown as the file itself rather than as a diff.
//
// `git diff` on an unmerged path prints a combined diff against both parents,
// which is close to unreadable and — worse — hides the conflict markers that
// are the thing you actually have to edit. So this renders the working-tree
// text, tinting each side of every conflict and leaving the markers in place,
// because those markers are what the user will delete when resolving by hand.
export function renderConflict(text, containerOrId) {
  const container = typeof containerOrId === 'string' ? $(`#${containerOrId}`) : containerOrId;
  container.innerHTML = '';
  const lines = text.split('\n');
  let side = null;   // which half of a conflict we are inside
  let regions = 0;

  const frag = document.createDocumentFragment();
  lines.forEach((line, i) => {
    const div = document.createElement('div');
    let cls = 'conflict-line';
    if (line.startsWith('<<<<<<<')) { side = 'ours'; regions++; cls += ' marker ours'; }
    else if (line.startsWith('|||||||') && side) { side = 'base'; cls += ' marker base'; }
    else if (line.startsWith('=======') && side) { side = 'theirs'; cls += ' marker theirs'; }
    else if (line.startsWith('>>>>>>>') && side) { cls += ' marker theirs'; side = null; }
    else if (side) cls += ' ' + side;
    div.className = cls;
    div.innerHTML = `<span class="diff-line-num">${i + 1}</span>`
      + `<span class="diff-line-content">${diffContent(line)}</span>`;
    frag.appendChild(div);
  });

  const summary = document.createElement('div');
  summary.className = 'conflict-summary';
  summary.textContent = regions
    ? `${regions} conflicting region${regions !== 1 ? 's' : ''} — take one side above, or edit the file and mark it resolved`
    : 'No conflict markers in the file — resolve it by choosing a side, or mark it resolved';
  container.appendChild(summary);
  container.appendChild(frag);
  refreshUnicodeToggles();
}
