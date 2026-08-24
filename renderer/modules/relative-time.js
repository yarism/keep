// "2 hours ago", for comment headers.
//
// A review is a conversation, and the useful thing about a comment's timestamp
// is its distance from now — whether it landed before or after the commit you
// are looking at, whether the question has been sitting unanswered for a week.
// An absolute date makes the reader do that subtraction themselves.
//
// Past the point where the distance stops being useful it becomes a date again:
// "417 days ago" is not a fact anybody wants to convert back.
//
// `now` is a parameter so this can be tested without freezing the clock.
const MINUTE = 60000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function relativeTime(iso, now = Date.now()) {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';

  const ms = now - then;
  // A clock that disagrees with the server by a few seconds should not produce
  // a comment written "in 3 seconds".
  if (ms < 0) return 'just now';
  if (ms < MINUTE) return 'just now';
  if (ms < HOUR) {
    const mins = Math.floor(ms / MINUTE);
    return mins === 1 ? 'a minute ago' : `${mins} minutes ago`;
  }
  if (ms < DAY) {
    const hours = Math.floor(ms / HOUR);
    return hours === 1 ? 'an hour ago' : `${hours} hours ago`;
  }
  if (ms < 30 * DAY) {
    const days = Math.floor(ms / DAY);
    return days === 1 ? 'yesterday' : `${days} days ago`;
  }
  const d = new Date(then);
  const sameYear = d.getFullYear() === new Date(now).getFullYear();
  return sameYear
    ? `on ${d.getDate()} ${MONTHS[d.getMonth()]}`
    : `on ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}
