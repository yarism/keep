import { $, escapeHtml, state } from './state.js';
import { renderDiff } from './diff.js';
import { showCommitContextMenu } from './context-menu.js';

export async function refreshHistory(refresh, branchOverride) {
  try {
    const branchName = branchOverride || (state.branchList.find(b => b.current) || {}).name || null;
    state.commits = await window.git.log(state.repoPath, branchName, 200);
    $('#history-branch-label').textContent = branchName || 'History';
  } catch { state.commits = []; }
  renderCommitList(refresh);
}

function renderCommitList(refresh) {
  const list = $('#history-list');
  list.innerHTML = '';
  state.commits.forEach(c => {
    const item = document.createElement('div');
    item.className = 'commit-item' + (state.selectedCommit === c.hash ? ' selected' : '');
    const date = new Date(c.date).toLocaleDateString('en-CA');
    item.innerHTML = `
      <div class="commit-item-header">
        <span class="commit-author">${escapeHtml(c.author)}</span>
        <span class="commit-hash">${c.hash.substring(0, 7)}</span>
        <span class="commit-date">${date}</span>
      </div>
      <div class="commit-subject-text">${escapeHtml(c.subject)}</div>
    `;
    item.addEventListener('click', () => selectCommit(c, refresh));
    item.addEventListener('contextmenu', (e) => { e.preventDefault(); showCommitContextMenu(e, c, refresh); });
    list.appendChild(item);
  });
}

async function selectCommit(c, refresh) {
  state.selectedCommit = c.hash;
  renderCommitList(refresh);
  try {
    const d = await window.git.commitDetail(state.repoPath, c.hash);
    const refsHtml = d.refs ? d.refs.split(',').map(r => {
      r = r.trim(); if (!r) return '';
      if (r.includes('HEAD')) return `<span class="commit-ref head">HEAD</span>`;
      if (r.includes('tag:')) return `<span class="commit-ref tag">${escapeHtml(r.replace('tag:','').trim())}</span>`;
      return `<span class="commit-ref branch">${escapeHtml(r)}</span>`;
    }).join(' ') : '';
    $('#commit-info').innerHTML = `
      <table>
        <tr><td>Author</td><td>${escapeHtml(d.author)} &lt;${escapeHtml(d.authorEmail)}&gt;</td></tr>
        <tr><td>Author Date</td><td>${d.authorDate}</td></tr>
        <tr><td>Committer</td><td>${escapeHtml(d.committer)} &lt;${escapeHtml(d.committerEmail)}&gt;</td></tr>
        <tr><td>Committer Date</td><td>${d.committerDate}</td></tr>
        <tr><td>Refs</td><td>${refsHtml || '—'}</td></tr>
        <tr><td>Commit Hash</td><td style="font-family:monospace">${d.hash}</td></tr>
        <tr><td>Parent Hash</td><td style="font-family:monospace">${d.parents || '—'}</td></tr>
        <tr><td>Tree Hash</td><td style="font-family:monospace">${d.tree || '—'}</td></tr>
      </table>
      <div style="margin-top:12px;font-size:14px;font-weight:600">${escapeHtml(d.subject)}</div>
    `;

    // Render changeset with expandable files
    const files = await window.git.commitFiles(state.repoPath, c.hash);
    renderChangeset(c.hash, files);
  } catch (e) {
    $('#commit-info').innerHTML = `<div style="padding:16px;color:var(--red)">${escapeHtml(e.message)}</div>`;
  }
}

function renderChangeset(hash, files) {
  const container = $('#commit-changeset');
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
  summary.textContent = `${files.length} changed file${files.length !== 1 ? 's' : ''} (${parts.join(', ')})`;
  container.appendChild(summary);

  files.forEach(f => {
    const fileEl = document.createElement('div');
    fileEl.className = 'changeset-file';

    const header = document.createElement('div');
    header.className = 'changeset-file-header';
    const statusLabel = f.statusCode;
    header.innerHTML = `
      <span class="expand-arrow">▶</span>
      <span class="file-status ${f.status}">${statusLabel}</span>
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
            const diff = await window.git.commitFileDiff(state.repoPath, hash, f.filePath);
            renderDiff(diff, diffContainer, null);
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
