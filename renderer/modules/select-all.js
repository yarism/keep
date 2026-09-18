// Select All, kept to where the user is standing.
//
// Left alone, Cmd+A reaches the Edit menu's Select All, which selects the
// document, and here the document is the whole window: toolbar, sidebar, commit
// list and every open diff at once. So the shortcut is answered here, before the
// menu gets to see it, and means what it means in Tower: inside a diff, the
// chunk being read; in the list of changed files, every file in it.
import { selectAllFiles } from './working-copy.js';

const FILE_LIST = '#wc-file-list';
const HUNK = '.diff-hunk';
// Standing in a file without standing in any one chunk of it: on its header,
// say, having just clicked it open. There the whole diff is what is meant. Each
// pair is the part of the window a press has to be inside of, and the text
// within it that gets selected. The release panel is here for the same reason
// the diffs are: its log is the other thing worth copying whole.
const REGIONS = [
  ['#wc-diff-panel', '.diff-view'],
  ['.changeset-file', '.changeset-file-diff'],
  ['#release-panel', '.release-body'],
];

// False for a collapsed file, a view that is not the active one, and anything a
// re-render has thrown away since it was pressed. Visibility is asked about as
// well as display, because that is how the release panel hides when closed.
const isShown = (el) => el.checkVisibility({ visibilityProperty: true });

// Somewhere with a caret of its own, where Cmd+A already means the right thing.
const isTextField = (el) =>
  el instanceof HTMLTextAreaElement
  || (el instanceof HTMLInputElement && el.type !== 'checkbox' && el.type !== 'radio')
  || (el instanceof HTMLElement && el.isContentEditable);

// Everything Select All could mean from where a node sits, narrowest first.
function targetsAround(node) {
  const el = node instanceof Element ? node : node && node.parentElement;
  if (!el) return [];
  const found = [el.closest(HUNK), el.closest(FILE_LIST)];
  for (const [region, text] of REGIONS) {
    const within = el.closest(region);
    if (within) found.push(within.querySelector(text));
  }
  return found.filter(Boolean);
}

function select(target) {
  if (target.matches(FILE_LIST)) { selectAllFiles(); return; }
  const range = document.createRange();
  range.selectNodeContents(target);
  // A chunk is its lines. The header above them says where they are from, which
  // is not something anyone means to copy along with them.
  const header = target.matches(HUNK) && target.querySelector(':scope > .diff-hunk-header');
  if (header) range.setStartAfter(header);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
}

export function setupSelectAll() {
  // Where the mouse last went down. The selection alone does not say where the
  // user is: a press on a line number, or anything else that cannot be
  // selected, leaves it sitting wherever it was before. Worked out at the press
  // rather than at the shortcut, because by then a redrawn list has replaced
  // the row that was pressed, and a row that is no longer in the document
  // cannot say which list it used to be in.
  let pressed = [];
  // Capturing, so a handler that stops the event on its way up cannot hide a
  // press from this one.
  document.addEventListener('mousedown', (e) => { pressed = targetsAround(e.target); }, true);
  document.addEventListener('keydown', (e) => {
    if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey) return;
    // Either case: Caps Lock turns the one into the other.
    if (e.key !== 'a' && e.key !== 'A') return;
    if (isTextField(e.target)) return;
    // From here on the window is never selected wholesale, even when there is
    // nothing to select instead: that selection is of no use to anyone.
    e.preventDefault();
    // A modal owns the window while it is up, and everything else is behind it.
    if (document.querySelector('.modal-overlay:not([hidden])')) return;
    // Focus first, since the keyboard can move it without a press. Then the
    // press, which is never older than the selection and is the one of the two
    // the user remembers making.
    const target = [
      ...targetsAround(e.target),
      ...pressed,
      ...targetsAround(window.getSelection().anchorNode),
    ].find(isShown);
    if (target) select(target);
  });
}
