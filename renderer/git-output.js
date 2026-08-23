// Turns raw git output into the one or two lines worth putting in front of
// someone.
//
// git talks to a terminal: progress counters overwrite themselves with carriage
// returns, and half of what it prints ("Enumerating objects: 12, done.") is
// noise once the command has finished. Pure functions, so they can be tested
// without a repo.

// Lines that only describe work in progress, not its result.
const NOISE = /^(remote: )?(Enumerating|Counting|Compressing|Receiving|Resolving|Unpacking|Writing|Total|Delta|Checking|Filtering|remote: Total)\b/;

export function summarizeGitOutput(raw, { max = 3 } = {}) {
  if (!raw) return '';
  const lines = String(raw)
    // A progress line is rewritten in place; only the final state matters.
    .split('\n')
    .map(line => line.split('\r').pop().trim())
    .filter(line => line && !NOISE.test(line));

  if (lines.length === 0) return '';
  const kept = lines.slice(0, max);
  if (lines.length > max) kept.push(`…and ${lines.length - max} more lines`);
  return kept.join('\n');
}

// What to say when git succeeded but printed nothing useful — silence from
// `git fetch` means there was nothing to fetch, and reporting "done" without
// saying what happened is the gap that made these buttons feel dead.
export function describeResult(action, raw) {
  const summary = summarizeGitOutput(raw);
  if (summary) return summary;
  return {
    Fetch: 'Already up to date',
    Pull: 'Already up to date',
    Push: 'Everything up-to-date',
  }[action] || `${action} finished`;
}
