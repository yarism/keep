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
    div.innerHTML = `<span class="diff-line-num">${oldNum}</span><span class="diff-line-num">${newNum}</span><span class="diff-line-content">${escapeHtml(line.substring(1))}</span>`;
    container.appendChild(div);
  });
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
      + `<span class="diff-line-content">${escapeHtml(line)}</span>`;
    frag.appendChild(div);
  });

  const summary = document.createElement('div');
  summary.className = 'conflict-summary';
  summary.textContent = regions
    ? `${regions} conflicting region${regions !== 1 ? 's' : ''} — take one side above, or edit the file and mark it resolved`
    : 'No conflict markers in the file — resolve it by choosing a side, or mark it resolved';
  container.appendChild(summary);
  container.appendChild(frag);
}
