import { $, state } from './state.js';

// Where a local branch stands against the remote it tracks. The sidebar, the
// toolbar badges and the History header all ask the same question, so they ask
// it here rather than each poking at branchList in its own way.
export function trackingFor(name) {
  const b = state.branchList.find(x => x.name === name);
  if (!b || b.isRemote || b.detached) return null;
  return {
    name: b.name,
    upstream: b.upstream || null,
    ahead: b.ahead || 0,
    behind: b.behind || 0,
    // The upstream branch was deleted on the remote — pulling can't work and
    // the ahead/behind numbers are meaningless, so this has to be said outright.
    gone: !!b.gone,
  };
}

export function headTracking() {
  const current = state.branchList.find(b => b.current);
  return current ? trackingFor(current.name) : null;
}

// Ahead on Push, behind on Pull: the two numbers that decide whether either
// button is worth pressing, on the buttons themselves.
export function updateSyncBadges() {
  const t = headTracking();
  setBadge('#badge-pull', t ? t.behind : 0, 'commit(s) to pull');
  setBadge('#badge-push', t ? t.ahead : 0, 'commit(s) to push');
}

function setBadge(selector, count, what) {
  const el = $(selector);
  if (!el) return;
  el.textContent = count > 99 ? '99+' : String(count);
  el.hidden = !count;
  el.title = count ? `${count} ${what}` : '';
}

// The same chips in the sidebar and in the History header, so "↑2" means the
// same thing wherever it turns up.
export function trackingChips(t, { showSynced = false } = {}) {
  if (!t) return '';
  if (t.gone) return `<span class="track-chip gone" title="Upstream ${t.upstream} is gone">gone</span>`;
  if (!t.upstream) return showSynced ? '<span class="track-chip none">no upstream</span>' : '';
  const chips = [];
  if (t.behind) chips.push(`<span class="track-chip behind" title="${t.behind} commit(s) to pull">↓${t.behind}</span>`);
  if (t.ahead) chips.push(`<span class="track-chip ahead" title="${t.ahead} commit(s) to push">↑${t.ahead}</span>`);
  if (!chips.length && showSynced) chips.push('<span class="track-chip synced">up to date</span>');
  return chips.join('');
}
