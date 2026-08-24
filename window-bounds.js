// Where the window opens, decided in that order of preference:
//
//   1. The size you left it at. A window you dragged to a comfortable shape
//      should come back that shape, on the screen you left it on.
//   2. Failing that, a fixed share of the screen it opens on — so a laptop and
//      a 5K panel each get a window in proportion to them, rather than the same
//      pixel count looking generous on one and lost on the other.
//
// Pure, so it can be tested without a screen: callers pass the work areas in
// and get plain bounds back.

// Calibrated against a 16" laptop, where this lands on 1538×945 — the size that
// felt right when picked by hand. The work area already excludes the menu bar
// and the dock, so a window can take nearly all of its height and still sit in
// clear space.
const SHARE = { width: 0.89, height: 0.94 };

// Below this a window is unusable; above it, a git client on an ultrawide is
// just stretched whitespace.
const MIN = { width: 900, height: 600 };
const MAX = { width: 2000, height: 1250 };

// How much of a remembered window has to land on a real screen for it to count
// as reachable — enough of the title bar to grab and drag back.
const VISIBLE = { width: 200, height: 100 };

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function defaultSize(workArea) {
  return {
    width: Math.round(clamp(workArea.width * SHARE.width, MIN.width, Math.min(MAX.width, workArea.width))),
    height: Math.round(clamp(workArea.height * SHARE.height, MIN.height, Math.min(MAX.height, workArea.height))),
  };
}

// A window remembered on a monitor that has since been unplugged would open
// somewhere nobody can see, so its position only survives if it still overlaps
// a display that exists now.
function isReachable(bounds, workAreas) {
  return workAreas.some((area) => {
    const overlapX = Math.min(bounds.x + bounds.width, area.x + area.width) - Math.max(bounds.x, area.x);
    const overlapY = Math.min(bounds.y + bounds.height, area.y + area.height) - Math.max(bounds.y, area.y);
    return overlapX >= VISIBLE.width && overlapY >= VISIBLE.height;
  });
}

const isSize = (v) => v && Number.isFinite(v.width) && Number.isFinite(v.height) && v.width > 0 && v.height > 0;
const isPoint = (v) => v && Number.isFinite(v.x) && Number.isFinite(v.y);

// `saved` is whatever was in settings.json, which is to say: anything. Treat a
// half-written or hand-edited entry as no entry rather than trusting it.
function windowBounds(saved, workArea, workAreas = [workArea]) {
  const remembered = isSize(saved);
  const size = remembered
    ? {
        // Still clamped: a size saved on a big monitor must not open taller
        // than the laptop it is reopened on.
        width: Math.round(clamp(saved.width, MIN.width, Math.max(MIN.width, workArea.width))),
        height: Math.round(clamp(saved.height, MIN.height, Math.max(MIN.height, workArea.height))),
      }
    : defaultSize(workArea);

  const position = remembered && isPoint(saved) && isReachable({ ...saved, ...size }, workAreas)
    ? { x: Math.round(saved.x), y: Math.round(saved.y) }
    : null;

  return { ...size, ...(position || {}), maximized: Boolean(saved && saved.maximized) };
}

module.exports = { windowBounds, defaultSize, SHARE, MIN, MAX };
