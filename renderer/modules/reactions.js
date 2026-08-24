// The row of reactions under a comment.
//
// Counts arrive with the comment — GitHub puts a summary on every one — so the
// row costs nothing to draw. What the summary does not say is who left them,
// and without that there is no way to know which one is yours to take back. So
// that question is asked once per comment, the first time somebody actually
// goes to react, rather than for every comment on the page up front.
import { state } from './state.js';
import { toast } from './toast.js';

const ALL = [
  { key: '+1', emoji: '\u{1F44D}' },
  { key: '-1', emoji: '\u{1F44E}' },
  { key: 'laugh', emoji: '\u{1F604}' },
  { key: 'hooray', emoji: '\u{1F389}' },
  { key: 'confused', emoji: '\u{1F615}' },
  { key: 'heart', emoji: '\u{2764}\u{FE0F}' },
  { key: 'rocket', emoji: '\u{1F680}' },
  { key: 'eyes', emoji: '\u{1F440}' },
];
const emojiFor = (key) => (ALL.find(r => r.key === key) || {}).emoji || key;

// Who left what, per target, once asked.
const detail = new Map();
const targetKey = (t) => (t.type === 'issue' ? `issue:${t.number}` : `comment:${t.id}`);
let _viewer;

async function viewer(forge) {
  if (_viewer === undefined) {
    try { _viewer = await window.git.viewerLogin(state.repoPath, forge); } catch { _viewer = null; }
  }
  return _viewer;
}

async function loadDetail(forge, target) {
  const key = targetKey(target);
  if (detail.has(key)) return detail.get(key);
  try {
    const result = await window.git.reactions(state.repoPath, forge, target);
    detail.set(key, result.ok ? result : { reactions: [], counts: [] });
  } catch { detail.set(key, { reactions: [], counts: [] }); }
  return detail.get(key);
}

// Yours, if you left this one — the id is what a DELETE needs.
async function mine(forge, target, key) {
  const [who, loaded] = await Promise.all([viewer(forge), loadDetail(forge, target)]);
  if (!who) return null;
  return (loaded.reactions || []).find(r => r.content === key && r.user === who) || null;
}

// target: { type: 'comment', id } or { type: 'issue', number }.
// counts: the summary that came with the comment, when there was one. The pull
// request's description arrives without one — the pulls endpoint carries no
// reactions at all — so for that the row asks, once, and draws itself when the
// answer comes back.
export function reactionsEl(target, forge, onChanged, counts) {
  const row = document.createElement('div');
  row.className = 'reaction-row';

  const chip = (key, count) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'reaction-chip';
    b.dataset.key = key;
    b.innerHTML = `<span class="reaction-emoji">${emojiFor(key)}</span>`;
    if (count) b.insertAdjacentHTML('beforeend', `<span class="reaction-count">${count}</span>`);
    b.addEventListener('click', () => toggle(key, b));
    return b;
  };

  const add = document.createElement('button');
  add.type = 'button';
  add.className = 'reaction-add';
  add.title = 'React';
  add.textContent = '\u{1F642}+';
  add.addEventListener('click', () => openPicker(add));

  function draw(list) {
    row.innerHTML = '';
    (list || []).forEach(r => row.appendChild(chip(r.key, r.count)));
    row.appendChild(add);
  }

  if (counts) draw(counts);
  else {
    draw([]);
    loadDetail(forge, target).then(loaded => draw(loaded.counts));
  }

  async function toggle(key, button) {
    if (button.dataset.busy) return;
    button.dataset.busy = '1';
    try {
      const existing = await mine(forge, target, key);
      const result = existing
        ? await window.git.react(state.repoPath, forge, { target, reactionId: existing.id, remove: true })
        : await window.git.react(state.repoPath, forge, { target, content: key });
      if (!result.ok) { toast(result.message, { type: 'error', prose: true }); return; }
      // What is on screen came from an answer that is now out of date.
      detail.delete(targetKey(target));
      if (onChanged) onChanged();
      else loadDetail(forge, target).then(loaded => draw(loaded.counts));
    } finally {
      delete button.dataset.busy;
    }
  }

  function openPicker(anchor) {
    const open = row.querySelector('.reaction-picker');
    if (open) { open.remove(); return; }
    const picker = document.createElement('div');
    picker.className = 'reaction-picker';
    ALL.forEach(r => {
      const b = document.createElement('button');
      b.type = 'button';
      b.title = r.key;
      b.textContent = r.emoji;
      b.addEventListener('click', () => { picker.remove(); toggle(r.key, anchor); });
      picker.appendChild(b);
    });
    row.appendChild(picker);
  }

  return row;
}
