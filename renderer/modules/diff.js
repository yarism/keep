import { $, escapeHtml, state } from './state.js';

export function renderDiff(diffText, containerOrId, stageableFile) {
  const container = typeof containerOrId === 'string' ? $(`#${containerOrId}`) : containerOrId;
  container.innerHTML = '';
  if (!diffText || !diffText.trim()) {
    container.innerHTML = '<div style="padding:20px;color:var(--text-dim)">No diff available (new or binary file)</div>';
    return;
  }
  const lines = diffText.split('\n');
  let oldLine = 0, newLine = 0;

  lines.forEach(line => {
    if (line.startsWith('@@')) {
      const match = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)/);
      if (match) { oldLine = parseInt(match[1]); newLine = parseInt(match[2]); }
      const hunkDiv = document.createElement('div');
      hunkDiv.className = 'diff-hunk-header';
      hunkDiv.innerHTML = `<span>${escapeHtml(line)}</span>`;
      if (stageableFile) {
        const btnGroup = document.createElement('span');
        btnGroup.style.cssText = 'display:flex;gap:4px';

        const discardBtn = document.createElement('button');
        discardBtn.textContent = 'Discard Chunk';
        discardBtn.style.background = 'var(--red)';
        discardBtn.addEventListener('click', async () => {
          if (!confirm('Discard this chunk? This cannot be undone.')) return;
          try {
            const hh = line.split('@@').slice(0, 2).join('@@') + '@@';
            await window.git.discardHunk(state.repoPath, stageableFile, hh);
            document.dispatchEvent(new Event('refresh-status'));
          } catch (e) { alert(e.message); }
        });

        const stageBtn = document.createElement('button');
        stageBtn.textContent = 'Stage Chunk';
        stageBtn.addEventListener('click', async () => {
          try {
            const hh = line.split('@@').slice(0, 2).join('@@') + '@@';
            await window.git.stageHunk(state.repoPath, stageableFile, hh);
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
    div.innerHTML = `<span class="diff-line-num">${oldNum}</span><span class="diff-line-num">${newNum}</span><span class="diff-line-content">${escapeHtml(line.substring(1))}</span>`;
    container.appendChild(div);
  });
}
