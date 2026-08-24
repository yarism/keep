// What the update state should look like, kept apart from the DOM that shows it.
//
// The interesting rule is not the wording, it is which states are allowed to
// speak. A check runs at launch and every six hours after it, so "up to date"
// and "the network is down" must stay silent when nobody asked — they are only
// worth a word when the answer was requested from the menu.

// electron-updater puts the entire HTTP response into err.message — headers,
// body and stack. That is a log entry, not a sentence, and the toast is not a
// log. These are the three failures worth naming; anything else keeps its first
// line and drops the dump.
export function explainUpdateError(raw) {
  const text = String(raw || '');

  if (/ERR_INTERNET_DISCONNECTED|ERR_NAME_NOT_RESOLVED|ERR_NETWORK_CHANGED|ENOTFOUND|EAI_AGAIN|ETIMEDOUT/.test(text)) {
    return 'Could not reach github.com to check for updates.';
  }
  // The release exists but carries no latest*.yml — every release built before
  // Keep could update itself looks like this.
  if (/Cannot find latest[\w-]*\.yml|404/i.test(text)) {
    return 'The latest release has no update information, so Keep cannot update itself from it.';
  }
  if (/code signature|not signed/i.test(text)) {
    return 'This build is not signed, so macOS will not let it update itself.';
  }

  return text.split('\n')[0].trim() || 'The update check failed.';
}

export function describeUpdate(state) {
  const s = state || {};
  const name = s.version ? `Keep ${s.version}` : 'An update';

  switch (s.status) {
    case 'checking':
      return s.manual
        ? { banner: { text: 'Checking for updates…' }, toast: null }
        : { banner: null, toast: null };

    case 'available':
      return { banner: { text: `${name} is available — downloading…`, percent: 0 }, toast: null };

    case 'downloading':
      return {
        banner: { text: `Downloading ${name}…`, percent: Number.isFinite(s.percent) ? s.percent : 0 },
        toast: null,
      };

    case 'ready':
      return { banner: { text: `${name} is ready to install.`, restart: true }, toast: null };

    case 'current':
      return {
        banner: null,
        toast: s.manual ? { text: `Keep ${s.current} is the latest version.`, type: 'success' } : null,
      };

    case 'error':
      return {
        banner: null,
        toast: s.manual ? { text: explainUpdateError(s.message), type: 'error' } : null,
      };

    // A build run from source has no release to compare itself against. Worth
    // saying once, when asked, rather than treating as a failure.
    case 'unsupported':
      return {
        banner: null,
        toast: s.manual
          ? { text: 'Updates are for installed builds — this one is running from source.', type: 'error' }
          : null,
      };

    default:
      return { banner: null, toast: null };
  }
}
