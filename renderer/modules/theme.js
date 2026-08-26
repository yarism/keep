// Applies a theme from themes.js to the document and owns the theme picker.
//
// The chosen theme lives in two places on purpose: settings.json is the record
// of truth, but it is read over async IPC, which would mean a frame of the
// wrong colours on every launch. localStorage is synchronous, so it is written
// alongside and read first to paint the right theme immediately.

import { $, escapeHtml, suspendTitlebarDrag } from './state.js';
import {
  DEFAULT_THEME_ID, DEFAULT_PINS, isSystemTheme, resolveTheme, swatchFor,
  quickSelections, restThemes, themeGroups, normalizePins, togglePin, isPinned,
  pinsAreFull, MAX_PINS,
} from '../themes.js';
import { icon } from '../icons.js';

const STORAGE_KEY = 'keep.theme';
const PINS_KEY = 'keep.themePins';

// The selection in force. A selection rather than a theme, which means it can
// be 'system'. There used to be a second one alongside it, because hovering the
// picker painted a theme without choosing it and the tick had to stay behind;
// now that nothing changes under a moving pointer, what is on screen and what
// was chosen are the same thing.
let savedId = DEFAULT_THEME_ID;

// Which themes the popover lists. Stored the same way as the selection above
// and for the same reason: settings.json is the record, localStorage is the
// copy that can be read before the first frame. Nothing paints from it that
// early — the popover is closed at launch — but keeping the pair together means
// there is one story about where appearance is kept, not two.
let pins = [...DEFAULT_PINS];

// What the OS appearance is set to, which only the system selection cares
// about. The media query is the answer at first paint, but it is not always
// the OS's: pointing the window chrome at a dark theme forces the whole app's
// appearance dark, and the query then reports that back to us. So it is only
// trusted while the system selection is the one in charge — the rest of the
// time main hands back the real value, which it can read for the same reason.
let systemDark = readSystemDark();

function readSystemDark() {
  try { return window.matchMedia('(prefers-color-scheme: dark)').matches; } catch { return false; }
}

function setSystemDark(dark) {
  if (typeof dark !== 'boolean' || dark === systemDark) return;
  systemDark = dark;
  if (isSystemTheme(savedId)) applyTheme(savedId);
}

export function currentThemeId() {
  return savedId;
}

// Paints a selection. Nothing else — no persistence, no menu redraw — so the
// OS flipping appearance under the system theme costs a repaint and no more.
export function applyTheme(id) {
  const theme = resolveTheme(id, systemDark);
  // Both halves matter: the same selection can resolve to the other theme when
  // the OS flips underneath it.
  if (id === savedId && document.documentElement.dataset.theme === theme.id) return;
  const root = document.documentElement;
  for (const [token, value] of Object.entries(theme.tokens)) {
    root.style.setProperty(`--${token}`, value);
  }
  // Lets the OS style native widgets (scrollbars, form controls, the window
  // chrome behind the traffic lights) to match.
  root.style.colorScheme = theme.dark ? 'dark' : 'light';
  root.dataset.theme = theme.id;
  savedId = id;
  // The window frame is macOS's, not ours, so it has to be told separately —
  // otherwise a light theme sits inside a dark outline. Sent on preview too:
  // the frame is part of what the theme looks like.
  windowChrome(id);
}

// The two things the main process needs to match the window to the theme.
function chromeOf(id) {
  const theme = resolveTheme(id, systemDark);
  const chrome = { background: theme.tokens['bg'], dark: theme.dark };
  if (isSystemTheme(id)) {
    // In system mode main decides which of the two to use, because at launch
    // it has to colour the window before the renderer exists to say what the
    // OS is set to. So it gets both to choose from.
    chrome.system = true;
    chrome.backgrounds = {
      light: resolveTheme(id, false).tokens['bg'],
      dark: resolveTheme(id, true).tokens['bg'],
    };
  }
  return chrome;
}

function windowChrome(id) {
  let sent;
  try { sent = window.git.setWindowChrome(chromeOf(id)); } catch { return; }
  if (!isSystemTheme(id) || !sent || !sent.then) return;
  // Main replies with the appearance it ended up following. In system mode it
  // has just handed the override back to the OS, so that answer is the OS's.
  sent.then(r => setSystemDark(r && r.dark)).catch(() => {});
}

// Paints a theme and records it as the choice.
function selectTheme(id, { persist = true } = {}) {
  applyTheme(id);
  if (persist) {
    try { localStorage.setItem(STORAGE_KEY, savedId); } catch {}
    // The chrome goes to disk alongside the id so the next launch can colour
    // the window before the renderer exists to say what the theme is.
    window.git.saveSettings({ theme: savedId, themeChrome: chromeOf(savedId) });
  }
  renderThemeMenu();
}

// ── Pins ──
//
// Which themes the popover lists is a preference like the theme itself, so it
// travels the same road: read from localStorage before the first frame, written
// to both stores when it changes.

// An absent list is a fresh install, which gets the default four. An empty one
// is a deliberate act — someone unpinned everything — so it is left empty; the
// popover still has the system entry and the row into the gallery.
function readPins() {
  let raw = null;
  try { raw = localStorage.getItem(PINS_KEY); } catch {}
  if (raw === null) return [...DEFAULT_PINS];
  try { return normalizePins(JSON.parse(raw)); } catch { return [...DEFAULT_PINS]; }
}

function setPins(next, { persist = true } = {}) {
  pins = normalizePins(next);
  if (persist) {
    try { localStorage.setItem(PINS_KEY, JSON.stringify(pins)); } catch {}
    window.git.saveSettings({ themePins: pins });
  }
  // The popover is what pins are for, so it is redrawn even while it is closed:
  // it is a handful of rows, and the alternative is remembering to do it on the
  // way in.
  renderThemeMenu();
}

// Called before first paint, from the synchronously-available cache.
export function initTheme() {
  let stored = null;
  try { stored = localStorage.getItem(STORAGE_KEY); } catch {}
  pins = readPins();
  selectTheme(stored || DEFAULT_THEME_ID, { persist: false });
  watchSystemAppearance();
}

// macOS switches appearance on its own — at sunset, or when the user flips it
// in System Settings — so the system theme has to follow while the app is open.
// Two sources say so: the media query, and main, which notices the same change
// a level down. Either is enough; both are idempotent.
function watchSystemAppearance() {
  try {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
      if (isSystemTheme(savedId)) setSystemDark(e.matches);
    });
  } catch {}
  try { window.git.onSystemTheme((s) => setSystemDark(s && s.dark)); } catch {}
}

// Called once settings.json has been read. Both halves only do work if the two
// stores disagree, which they normally don't — this is here for the launch
// after settings were edited by hand, or written by another window.
export function syncThemeFromSettings(settings) {
  syncPinsFromSettings(settings);
  const id = settings && settings.theme;
  if (!id || id === savedId) return;
  applyTheme(id);
  try { localStorage.setItem(STORAGE_KEY, savedId); } catch {}
  window.git.saveSettings({ themeChrome: chromeOf(savedId) });
  renderThemeMenu();
}

function syncPinsFromSettings(settings) {
  const stored = settings && settings.themePins;
  if (!Array.isArray(stored)) return;
  const next = normalizePins(stored);
  if (next.join() === pins.join()) return;
  // Written back to localStorage rather than to settings, which is where this
  // just came from.
  pins = next;
  try { localStorage.setItem(PINS_KEY, JSON.stringify(pins)); } catch {}
  renderThemeMenu();
}


// ── The popover ──
//
// A short list, not a catalogue: the system entry, a fixed handful of themes,
// the one in force if it is not among them, and a row that opens the gallery.
// Adding a theme to themes.js therefore adds nothing to the toolbar — it lands
// in the gallery, and only ever appears up here while it is the chosen one.

// The gallery row keeps the swatch's shape so the labels line up. What it does
// not keep is a set of borrowed accents: four colours taken from four unrelated
// themes are four colours nobody chose to put together, and it showed. It gets
// a spectrum of the current theme's own semantic colours instead — a palette by
// construction, and painted from tokens in the stylesheet rather than here.
function themeRow(id, name, swatchColours, { checked = false, more = false } = {}) {
  const swatch = more ? '' : swatchColours.map(c => `<i style="background:${c}"></i>`).join('');
  return `
    <div class="theme-item${checked ? ' active' : ''}${more ? ' theme-more' : ''}"
         ${more ? 'data-theme-more' : `data-theme-id="${id}"`}
         role="${more ? 'menuitem' : 'menuitemradio'}"${more ? '' : ` aria-checked="${checked}"`} tabindex="0">
      <span class="theme-swatch" aria-hidden="true">${swatch}</span>
      <span class="theme-name">${escapeHtml(name)}</span>
      <span class="theme-check">${checked ? icon('check', 14) : ''}${more ? icon('chevron', 13) : ''}</span>
    </div>`;
}

function renderThemeMenu() {
  const list = $('#theme-menu-items');
  if (!list) return;
  const rows = quickSelections(savedId, pins)
    .map(t => themeRow(t.id, t.name, swatchFor(t.id), { checked: t.id === savedId }));
  // The row that hands over to the gallery, counting what it holds. Left out
  // entirely when there is nothing more to show.
  const rest = restThemes(savedId, pins);
  if (rest.length) {
    rows.push('<div class="theme-menu-sep"></div>');
    rows.push(themeRow(null, `More themes (${rest.length})`, null, { more: true }));
  }
  list.innerHTML = rows.join('');
}

function openThemeMenu() {
  renderThemeMenu();
  $('#theme-menu').hidden = false;
  $('#btn-theme').classList.add('active');
  suspendTitlebarDrag('theme-menu', true);
}

// Nothing to undo on the way out: a row only ever changes the theme when it is
// clicked, so closing the menu leaves whatever is on screen alone.
function closeThemeMenu() {
  const menu = $('#theme-menu');
  if (!menu || menu.hidden) return;
  menu.hidden = true;
  $('#btn-theme').classList.remove('active');
  suspendTitlebarDrag('theme-menu', false);
}

// ── The gallery ──
//
// Every theme at once, split into light and dark because that is the half of
// the decision you have already made when you open it. Each card is a small
// mock of the window rather than a strip of colours: a palette only tells you
// what a theme looks like once the colours are in the places they will be in.
//
// Clicking is the try, here as in the popover: nothing repaints under a moving
// pointer, and a click puts the theme on for real. The gallery then stays open
// rather than closing, because picking here is usually picking twice.
//
// The one in force wears no tick. The popover needs one because its rows are a
// list and every row looks alike; a card is already ringed and tinted in the
// accent when it is the chosen one, and a tick on top of that is the same thing
// said twice. `aria-checked` still says it for anyone not looking at it.

// The control that decides whether a theme is in the popover. It sits in the
// card's bottom corner, on the label's line, where a pin goes — and it is a
// bare glyph, because that line belongs to the card rather than to the preview
// above it. Nothing has to be built under it to keep it legible, so nothing is:
// it is the quietest thing on a card that is otherwise all colour.
function pinButton(id, pinned) {
  const full = !pinned && pinsAreFull(pins);
  const label = pinLabel(pinned, full);
  return `
    <button type="button" class="theme-pin${pinned ? ' pinned' : ''}${full ? ' full' : ''}"
            data-pin="${id}" tabindex="-1"
            aria-pressed="${pinned}" aria-disabled="${full}"
            title="${label}" aria-label="${label}"
      >${icon(pinned ? 'pin-filled' : 'pin', 13)}</button>`;
}

function pinLabel(pinned, full) {
  if (pinned) return 'Unpin from the theme menu';
  return full ? `The menu holds ${MAX_PINS} — unpin one first` : 'Pin to the theme menu';
}

// The line under the gallery's title. It says what the pin is for until the
// pins run out, and then says that instead — which is the only warning there
// needs to be, because the buttons it is talking about have gone grey at the
// same moment.
function renderPinHint() {
  const hint = $('#theme-gallery-hint');
  if (!hint) return;
  const count = normalizePins(pins).length;
  hint.textContent = count >= MAX_PINS
    ? `All ${MAX_PINS} pins are used — unpin one to make room for another`
    : `Pin the ones you switch between and they'll be in the toolbar menu (${count} of ${MAX_PINS})`;
}

function galleryCard(theme) {
  const t = theme.tokens;
  const active = theme.id === savedId;
  const pinned = isPinned(pins, theme.id);
  const line = (colour, width) => `<i class="theme-mini-line" style="background:${colour};width:${width}"></i>`;
  return `
    <div class="theme-card${active ? ' active' : ''}" data-theme-id="${theme.id}"
         role="menuitemradio" aria-checked="${active}" tabindex="0">
      ${pinButton(theme.id, pinned)}
      <div class="theme-mini" style="background:${t['bg']};border-color:${t['border-strong']}" aria-hidden="true">
        <div class="theme-mini-bar" style="background:${t['bg-surface']};border-color:${t['border']}">
          ${line(t['text-dim'], '18px')}
          <i class="theme-mini-pill" style="background:${t['accent']}"></i>
        </div>
        <div class="theme-mini-body">
          <div class="theme-mini-side" style="background:${t['bg-surface']};border-color:${t['border']}">
            ${line(t['text-mute'], '70%')}
            ${line(t['accent'], '55%')}
            ${line(t['text-mute'], '80%')}
            ${line(t['text-mute'], '45%')}
          </div>
          <div class="theme-mini-main">
            ${line(t['text-dim'], '72%')}
            ${line(t['text-mute'], '48%')}
            <div class="theme-mini-diff" style="background:${t['diff-add-bg']}">${line(t['diff-add-text'], '60%')}</div>
            <div class="theme-mini-diff" style="background:${t['diff-del-bg']}">${line(t['diff-del-text'], '44%')}</div>
          </div>
        </div>
      </div>
      <div class="theme-card-label">
        <span class="theme-name">${escapeHtml(theme.name)}</span>
      </div>
    </div>`;
}

// `focusId` puts the keyboard back where it was: picking a theme redraws the
// grid, which throws away the card the user was standing on.
function renderThemeGallery(focusId = null) {
  const body = $('#theme-gallery-body');
  if (!body) return;
  body.innerHTML = themeGroups().map(group => `
    <div class="theme-gallery-group">
      <div class="popover-header">${escapeHtml(group.label)}</div>
      <div class="theme-gallery-grid">${group.themes.map(galleryCard).join('')}</div>
    </div>
  `).join('');
  renderPinHint();
  if (focusId) {
    const card = body.querySelector(`.theme-card[data-theme-id="${focusId}"]`);
    if (card) card.focus();
  }
}

function openThemeGallery() {
  const overlay = $('#theme-gallery');
  if (!overlay) return;
  renderThemeGallery();
  overlay.hidden = false;
  suspendTitlebarDrag('theme-gallery', true);
}

// Nothing to undo on the way out: every theme in here was put on by a click,
// which is a choice rather than a preview. Note the gallery holds no system
// entry — following the OS is a mode, not a palette, so it stays pinned to the
// top of the popover where it is one click away rather than sitting in here
// pretending to be an eighth theme.
function closeThemeGallery() {
  const overlay = $('#theme-gallery');
  if (!overlay || overlay.hidden) return;
  overlay.hidden = true;
  suspendTitlebarDrag('theme-gallery', false);
}

function galleryIsOpen() {
  const overlay = $('#theme-gallery');
  return !!overlay && !overlay.hidden;
}

// Pinning redraws the popover and the one button that changed, rather than the
// gallery: a full redraw here would throw away the card the pointer is over
// halfway through a run of pinning, and scroll the grid back to the top.
function togglePinned(id) {
  const before = normalizePins(pins);
  setPins(togglePin(pins, id));
  // Nothing moved: the pins are full and this one is not among them. Said out
  // loud rather than ignored, because the click was aimed at a button that is
  // already grey and the pointer may have missed it.
  if (normalizePins(pins).join() === before.join()) {
    if (!isPinned(pins, id)) nudgePinHint();
    return;
  }
  // Every pin is redrawn, not just the one clicked: crossing the limit greys
  // out the others, and coming back under it wakes them up again.
  refreshPinButtons();
}

function refreshPinButtons() {
  renderPinHint();
  document.querySelectorAll('#theme-gallery .theme-pin').forEach(button => {
    const id = button.dataset.pin;
    const pinned = isPinned(pins, id);
    const full = !pinned && pinsAreFull(pins);
    const label = pinLabel(pinned, full);
    button.classList.toggle('pinned', pinned);
    button.classList.toggle('full', full);
    button.setAttribute('aria-pressed', String(pinned));
    button.setAttribute('aria-disabled', String(full));
    button.title = label;
    button.setAttribute('aria-label', label);
    button.innerHTML = icon(pinned ? 'pin-filled' : 'pin', 13);
  });
}

// A one-shot flash of the hint, for the click that could not do anything.
function nudgePinHint() {
  const hint = $('#theme-gallery-hint');
  if (!hint) return;
  hint.classList.remove('nudge');
  // Reading a layout property between the two is what makes the animation run
  // again rather than being treated as never having stopped.
  void hint.offsetWidth;
  hint.classList.add('nudge');
}

export function setupThemePicker() {
  const btn = $('#btn-theme');
  const menu = $('#theme-menu');
  if (!btn || !menu) return;

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (menu.hidden) openThemeMenu(); else closeThemeMenu();
  });

  // A row is either a theme, or the one that hands over to the gallery.
  function chooseFromMenu(item) {
    if (item.hasAttribute('data-theme-more')) {
      closeThemeMenu();
      openThemeGallery();
      return;
    }
    selectTheme(item.dataset.themeId);
    closeThemeMenu();
  }

  menu.addEventListener('click', (e) => {
    e.stopPropagation();
    const item = e.target.closest('.theme-item');
    if (item) chooseFromMenu(item);
  });

  menu.addEventListener('keydown', (e) => {
    const item = e.target.closest('.theme-item');
    if (!item) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      chooseFromMenu(item);
    }
  });

  const overlay = $('#theme-gallery');
  if (overlay) {
    overlay.addEventListener('click', (e) => {
      e.stopPropagation();
      // The pin sits inside a card, so it has to be answered before the card
      // is, or pinning a theme would also put it on.
      const pin = e.target.closest('.theme-pin');
      if (pin) {
        togglePinned(pin.dataset.pin);
        return;
      }
      const card = e.target.closest('.theme-card');
      if (card) {
        // Redrawn rather than closed: picking here is usually picking twice,
        // and the tick has to move to show the first one landed.
        selectTheme(card.dataset.themeId);
        renderThemeGallery();
        return;
      }
      // A click on the backdrop, or on the close button, is a way out.
      if (e.target === overlay || e.target.closest('#theme-gallery-close')) closeThemeGallery();
    });
    overlay.addEventListener('keydown', (e) => {
      const card = e.target.closest('.theme-card');
      if (!card) return;
      // P for pin, from the card itself. The pin is not its own tab stop —
      // that would double the number of stops in a grid of cards, and the
      // second one in every pair does the rarer thing.
      if (e.key === 'p' || e.key === 'P') {
        e.preventDefault();
        togglePinned(card.dataset.themeId);
        return;
      }
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      selectTheme(card.dataset.themeId);
      renderThemeGallery(card.dataset.themeId);
    });
  }

  document.addEventListener('click', closeThemeMenu);
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    // The gallery sits on top of the menu, so it is what Escape means first.
    if (galleryIsOpen()) closeThemeGallery(); else closeThemeMenu();
  });
}
