// Why a repository is empty, when the reason is macOS rather than git.
//
// The banner lives above #app, so the same element serves the workspace and the
// repository list — a folder Keep cannot read is worth explaining from either.

import { $ } from './state.js';

export function showAccess(problem) {
  const el = $('#access-banner');
  if (!problem) {
    el.hidden = true;
    return;
  }
  $('#access-banner-text').textContent = problem;
  el.hidden = false;
}

// Resolves to the problem so callers can branch on it; the banner is updated
// either way, which is what clears a stale message once access is granted.
export async function checkAccess(repoPath) {
  let problem = null;
  try { problem = await window.git.accessProblem(repoPath); } catch {}
  showAccess(problem);
  return problem;
}
