// One comment, however it arrived.
//
// A pull request's description and a comment left on line 42 are the same kind
// of thing — somebody's prose, over their name, at a time — and drawing them
// differently is what made the description read as a caption on the page rather
// than as the opening of the conversation. Both use this.
import { escapeHtml } from './state.js';
import { mountMarkdown } from './markdown.js';
import { relativeTime } from './relative-time.js';

export function avatarEl(url, name) {
  if (!url) {
    const initial = document.createElement('span');
    initial.className = 'comment-avatar comment-avatar-fallback';
    initial.textContent = (name || '?').slice(0, 1).toUpperCase();
    return initial;
  }
  const img = document.createElement('img');
  img.className = 'comment-avatar';
  img.alt = '';
  // Asked for at the size it is drawn: GitHub serves whatever `s` says, and the
  // full-size original is a hundred times the bytes for the same 20 pixels.
  img.src = `${url}${url.includes('?') ? '&' : '?'}s=48`;
  return img;
}

// author, avatar, at (ISO), body (Markdown), verb ("commented"), chips
// (strings), className (extra classes), plain (render body as text, for a draft
// that has not been posted and so is not yet Markdown from anybody), footer
// (an element hung under the prose — reactions, or a draft's own buttons).
export function commentCard({
  author, avatar, at, body, verb = '', chips = [], className = '', plain = false, footer = null,
}) {
  const el = document.createElement('div');
  el.className = ['comment-card', className].filter(Boolean).join(' ');
  el.innerHTML = `
    <div class="comment-head">
      <span class="comment-author">${escapeHtml(author || 'unknown')}</span>
      ${verb ? `<span class="comment-verb">${escapeHtml(verb)}</span>` : ''}
      <span class="comment-when">${escapeHtml(relativeTime(at))}</span>
      ${chips.map(c => `<span class="comment-chip">${escapeHtml(c)}</span>`).join('')}
    </div>
    <div class="comment-body"></div>
  `;
  el.prepend(avatarEl(avatar, author));

  const bodyEl = el.querySelector('.comment-body');
  if (plain) bodyEl.textContent = body || '';
  // Prose from anyone who can comment on the pull request: rendered through the
  // escape-first renderer, never set as markup.
  else mountMarkdown(bodyEl, body, (url) => window.git.openExternal(url));

  if (footer) el.appendChild(footer);
  return el;
}
