// The expandable list of files a change touches.
//
// Lifted out of history.js because a pull request shows exactly the same thing
// about a range of commits that the detail pane shows about one commit. The
// only difference between the two is where the diff for a file comes from, so
// that is the one thing the caller supplies.
import { escapeHtml } from './state.js';
import { renderDiff, createUnicodeToggle } from './diff.js';
import { icon } from '../icons.js';

// A changeset in one line: how many files, and what happened to them.
export function summarize(files) {
  const adds = files.filter(f => f.status === 'added').length;
  const dels = files.filter(f => f.status === 'deleted').length;
  const mods = files.length - adds - dels;
  const parts = [];
  if (mods) parts.push(`${mods} modified`);
  if (adds) parts.push(`${adds} added`);
  if (dels) parts.push(`${dels} deleted`);
  return files.length
    ? `${files.length} changed file${files.length !== 1 ? 's' : ''} (${parts.join(', ')})`
    : 'No changed files';
}

// files: what git.js's name-status parse returns.
// loadDiff: (file) => Promise<string>, called once per file, on first expand.
// opts.annotate: (file) => annotate, handed to renderDiff so a caller can
//   decorate individual rows — how review comments reach the diff.
// opts.fileNote: (file) => Node | null, put above a file's diff for anything
//   that belongs to the file rather than to one line.
// opts.summary: false to leave out the count line, for callers that show it
//   somewhere of their own.
export function renderChangeset(container, files, loadDiff, opts = {}) {
  container.innerHTML = '';

  if (opts.summary !== false) {
    const summary = document.createElement('div');
    summary.className = 'changeset-summary';
    summary.innerHTML = `<span>${escapeHtml(summarize(files))}</span>`;
    summary.appendChild(createUnicodeToggle(container));
    container.appendChild(summary);
  }

  files.forEach(f => {
    const fileEl = document.createElement('div');
    fileEl.className = 'changeset-file';

    const header = document.createElement('div');
    header.className = 'changeset-file-header';
    const badge = opts.fileBadge && opts.fileBadge(f);
    header.innerHTML = `
      <span class="expand-arrow">${icon('chevron', 12)}</span>
      <span class="file-status ${f.status}">${f.statusCode}</span>
      <span class="file-name">${escapeHtml(f.filePath.split('/').pop())}</span>
      <span class="file-path">${escapeHtml(f.filePath.includes('/') ? f.filePath.substring(0, f.filePath.lastIndexOf('/')) : '')}</span>
      ${badge ? `<span class="changeset-file-badge">${escapeHtml(badge)}</span>` : ''}
    `;

    const diffContainer = document.createElement('div');
    diffContainer.className = 'changeset-file-diff';
    let loaded = false;

    header.addEventListener('click', async () => {
      const arrow = header.querySelector('.expand-arrow');
      const isOpen = diffContainer.style.display === 'block';
      if (isOpen) {
        diffContainer.style.display = 'none';
        arrow.classList.remove('open');
      } else {
        if (!loaded) {
          try {
            const note = opts.fileNote && opts.fileNote(f);
            renderDiff(await loadDiff(f), diffContainer, null,
              { annotate: opts.annotate && opts.annotate(f) });
            if (note) diffContainer.prepend(note);
            loaded = true;
          } catch (e) {
            diffContainer.innerHTML = `<div style="padding:8px 16px;color:var(--red)">${escapeHtml(e.message)}</div>`;
          }
        }
        diffContainer.style.display = 'block';
        arrow.classList.add('open');
      }
    });

    fileEl.appendChild(header);
    fileEl.appendChild(diffContainer);
    container.appendChild(fileEl);
  });
}
