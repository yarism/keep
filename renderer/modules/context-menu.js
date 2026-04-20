import { $, state } from './state.js';
import { showModal } from './modal.js';

export function setupContextMenu() {
  document.addEventListener('click', () => hideContextMenu());
}

export function showContextMenu(e, items) {
  const menu = $('#context-menu');
  const menuItems = $('#context-menu-items');
  menuItems.innerHTML = '';
  items.forEach(item => {
    if (item.separator) {
      const s = document.createElement('div');
      s.className = 'context-menu-separator';
      menuItems.appendChild(s);
      return;
    }
    const el = document.createElement('div');
    el.className = 'context-menu-item' + (item.disabled ? ' disabled' : '');
    el.textContent = item.label;
    if (!item.disabled) el.addEventListener('click', () => { hideContextMenu(); item.action(); });
    menuItems.appendChild(el);
  });
  menu.style.left = e.clientX + 'px';
  menu.style.top = e.clientY + 'px';
  menu.hidden = false;
  requestAnimationFrame(() => {
    const rect = menu.getBoundingClientRect();
    if (rect.right > window.innerWidth) menu.style.left = (window.innerWidth - rect.width - 4) + 'px';
    if (rect.bottom > window.innerHeight) menu.style.top = (window.innerHeight - rect.height - 4) + 'px';
  });
}

function hideContextMenu() {
  $('#context-menu').hidden = true;
}

export function showBranchContextMenu(e, branch, refresh) {
  showContextMenu(e, [
    { label: `Check Out "${branch.name}"`, disabled: branch.current, action: async () => { try { await window.git.checkout(state.repoPath, branch.name); await refresh(); } catch (err) { alert(err.message); } }},
    { separator: true },
    { label: 'Pull...', action: async () => { try { await window.git.pull(state.repoPath); await refresh(); } catch (err) { alert(err.message); } }},
    { label: 'Push...', action: async () => { try { await window.git.push(state.repoPath); await refresh(); } catch (err) { alert(err.message); } }},
    { separator: true },
    { label: 'Merge With Revision...', disabled: branch.current, action: async () => { try { await window.git.merge(state.repoPath, branch.name); await refresh(); } catch (err) { alert(err.message); } }},
    { label: 'Rebase On Revision...', disabled: branch.current, action: async () => { try { await window.git.rebase(state.repoPath, branch.name); await refresh(); } catch (err) { alert(err.message); } }},
    { separator: true },
    { label: `Rename "${branch.name}"...`, action: async () => { const n = await showModal('Rename Branch', `New name for "${branch.name}"`, branch.name); if (n) { try { await window.git.renameBranch(state.repoPath, branch.name, n); await refresh(); } catch (err) { alert(err.message); } } }},
    { label: `Delete "${branch.name}"...`, disabled: branch.current, action: async () => { if (confirm(`Delete branch "${branch.name}"?`)) { try { await window.git.deleteBranch(state.repoPath, branch.name); await refresh(); } catch (err) { alert(err.message); } } }},
    { separator: true },
    { label: `Create New Branch from "${branch.name}"...`, action: async () => { const n = await showModal('Create Branch', `Branch name (from "${branch.name}")`); if (n) { try { await window.git.createBranch(state.repoPath, n, branch.name); await refresh(); } catch (err) { alert(err.message); } } }},
    { label: `Create New Tag from "${branch.name}"...`, action: async () => { const n = await showModal('Create Tag', `Tag name (from "${branch.name}")`); if (n) { try { await window.git.createTag(state.repoPath, n, branch.name); await refresh(); } catch (err) { alert(err.message); } } }},
  ]);
}

export function showCommitContextMenu(e, commit, refresh) {
  const h = commit.hash.substring(0, 7);
  showContextMenu(e, [
    { label: 'Copy Commit Hash to Clipboard', action: () => navigator.clipboard.writeText(commit.hash) },
    { label: 'Copy Commit Info to Clipboard', action: () => navigator.clipboard.writeText(`${commit.hash} ${commit.subject}\nAuthor: ${commit.author}\nDate: ${commit.date}`) },
    { separator: true },
    { label: `Check Out "${h}"`, action: async () => { try { await window.git.checkout(state.repoPath, commit.hash); await refresh(); } catch (err) { alert(err.message); } }},
    { separator: true },
    { label: `Revert "${h}"...`, action: async () => { try { await window.git.revert(state.repoPath, commit.hash); await refresh(); } catch (err) { alert(err.message); } }},
    { separator: true },
    { label: `Create New Branch from "${h}"...`, action: async () => { const n = await showModal('Create Branch', `Branch name (from ${h})`); if (n) { try { await window.git.createBranch(state.repoPath, n, commit.hash); await refresh(); } catch (err) { alert(err.message); } } }},
    { label: `Create New Tag from "${h}"...`, action: async () => { const n = await showModal('Create Tag', `Tag name (from ${h})`); if (n) { try { await window.git.createTag(state.repoPath, n, commit.hash); await refresh(); } catch (err) { alert(err.message); } } }},
  ]);
}
