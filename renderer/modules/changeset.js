// The expandable list of files a change touches.
//
// Lifted out of history.js because a pull request shows exactly the same thing
// about a range of commits that the detail pane shows about one commit. The
// only difference between the two is where the diff for a file comes from, so
// that is the one thing the caller supplies.
import { escapeHtml } from './state.js';
import { renderDiff } from './diff.js';
import { icon } from '../icons.js';

// files: what git.js's name-status parse returns.
// loadDiff: (file) => Promise<string>, called once per file, on first expand.
export function renderChangeset(container, files, loadDiff) {
  container.innerHTML = '';

  const adds = files.filter(f => f.status === 'added').length;
  const dels = files.filter(f => f.status === 'deleted').length;
  const mods = files.length - adds - dels;
  const summary = document.createElement('div');
  summary.className = 'changeset-summary';
  const parts = [];
  if (mods) parts.push(`${mods} modified`);
  if (adds) parts.push(`${adds} added`);
  if (dels) parts.push(`${dels} deleted`);
  summary.textContent = files.length
    ? `${files.length} changed file${files.length !== 1 ? 's' : ''} (${parts.join(', ')})`
    : 'No changed files';
  container.appendChild(summary);

  files.forEach(f => {
    const fileEl = document.createElement('div');
    fileEl.className = 'changeset-file';

    const header = document.createElement('div');
    header.className = 'changeset-file-header';
    header.innerHTML = `
      <span class="expand-arrow">${icon('chevron', 12)}</span>
      <span class="file-status ${f.status}">${f.statusCode}</span>
      <span class="file-name">${escapeHtml(f.filePath.split('/').pop())}</span>
      <span class="file-path">${escapeHtml(f.filePath.includes('/') ? f.filePath.substring(0, f.filePath.lastIndexOf('/')) : '')}</span>
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
            renderDiff(await loadDiff(f), diffContainer, null);
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
