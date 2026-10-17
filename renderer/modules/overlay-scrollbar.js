// A scrollbar that behaves like macOS's overlay one but is drawn here, so it
// can look like Tower's: nothing while the list sits still, however long it
// grows, a bar floating over the rows while it scrolls, gone again a moment
// after. Chromium's own overlay bar behaves the same but draws a heavier
// thumb that cannot be restyled, so the scroller hides it (scrollbar-width:
// none in styles.css).

// How far the bar stays clear of the scroller's top and bottom edges.
const INSET = 2;
// The thumb never gets shorter than this, however long the list.
const MIN_LENGTH = 24;
// A thumb exactly as long as the share of the list in view reads larger than
// Tower's beside it, so it is drawn at this fraction of that.
const LENGTH_SCALE = 0.7;
// How long the bar stays after the last scroll before it fades.
const LINGER = 150;
// A trackpad's momentum dies away slowly, and fingers resting on the pad
// still twitch the list: either way it goes on creeping a fraction of a pixel
// at a time long after it looks still, while Tower's bar is already gone.
// Movement slower than this, in pixels a millisecond (80 a second, about
// three rows), no longer keeps the bar up.
const CREEP = 0.08;
// Wheel events further apart than this are a new gesture, not a slow one.
const GESTURE_GAP = 100;

export function overlayScrollbar(scroller) {
  const rail = document.createElement('div');
  rail.className = 'overlay-scrollbar';
  const thumb = document.createElement('div');
  thumb.className = 'overlay-scrollbar-thumb';
  rail.append(thumb);
  // Outside the scroller, so the bar does not scroll away with the rows.
  scroller.after(rail);

  let timer = null;
  let hovering = false;
  let dragging = false;

  const scrollable = () => scroller.scrollHeight > scroller.clientHeight;

  // The track is the scroller's height less the insets; the thumb's share of
  // it follows the share of the list in view.
  function measure() {
    const { scrollTop, scrollHeight, clientHeight } = scroller;
    const track = clientHeight - 2 * INSET;
    const length = Math.max(MIN_LENGTH, Math.round(track * clientHeight / scrollHeight * LENGTH_SCALE));
    const range = scrollHeight - clientHeight;
    const top = INSET + (range > 0 ? Math.round((track - length) * scrollTop / range) : 0);
    return { track, length, range, top };
  }

  function place() {
    const box = scroller.getBoundingClientRect();
    rail.style.top = `${box.top}px`;
    rail.style.left = `${box.left}px`;
    rail.style.width = `${box.width}px`;
    rail.style.height = `${box.height}px`;
    const { length, top } = measure();
    thumb.style.height = `${length}px`;
    thumb.style.transform = `translateY(${top}px)`;
  }

  function reveal() {
    if (!scrollable()) return;
    place();
    rail.classList.add('visible');
    clearTimeout(timer);
    timer = setTimeout(fade, LINGER);
  }

  function fade() {
    if (hovering || dragging) return;
    rail.classList.remove('visible');
  }

  // Only a hand on the wheel or trackpad brings the bar up. A scroll the list
  // makes by itself, such as when the window grows and the bottom rows come
  // back into view, leaves it hidden, as Tower's does. Once it is up, any
  // scroll faster than a creep keeps it there, which covers a trackpad's
  // momentum until it is all but spent. A sideways swipe has no business
  // showing an up-and-down bar.
  let lastWheel = -Infinity;
  scroller.addEventListener('wheel', (e) => {
    const gap = e.timeStamp - lastWheel;
    lastWheel = e.timeStamp;
    if (!e.deltaY) return;
    if (gap > GESTURE_GAP || Math.abs(e.deltaY) / gap >= CREEP) reveal();
  }, { passive: true });

  let lastTop = scroller.scrollTop;
  let lastScroll = -Infinity;
  scroller.addEventListener('scroll', (e) => {
    const speed = Math.abs(scroller.scrollTop - lastTop) / (e.timeStamp - lastScroll);
    lastTop = scroller.scrollTop;
    lastScroll = e.timeStamp;
    if (!rail.classList.contains('visible')) return;
    // A creep still moves the thumb, it just no longer holds the fade off.
    if (speed >= CREEP) reveal();
    else place();
  }, { passive: true });
  new ResizeObserver(() => {
    if (rail.classList.contains('visible')) place();
  }).observe(scroller);

  // The thumb sits outside the scroller, so a wheel turned over it would
  // otherwise scroll nothing.
  thumb.addEventListener('wheel', (e) => {
    scroller.scrollTop += e.deltaY;
  }, { passive: true });

  thumb.addEventListener('mouseenter', () => { hovering = true; });
  thumb.addEventListener('mouseleave', () => {
    hovering = false;
    reveal();
  });

  thumb.addEventListener('mousedown', (e) => {
    e.preventDefault();
    const startY = e.clientY;
    const startTop = scroller.scrollTop;
    const { track, length, range } = measure();
    // A pixel of thumb travel is this many pixels of list.
    const ratio = range / Math.max(1, track - length);
    dragging = true;
    rail.classList.add('dragging');

    function onDrag(ev) {
      scroller.scrollTop = startTop + (ev.clientY - startY) * ratio;
    }
    function onDragEnd() {
      dragging = false;
      rail.classList.remove('dragging');
      document.removeEventListener('mousemove', onDrag);
      document.removeEventListener('mouseup', onDragEnd);
      reveal();
    }
    document.addEventListener('mousemove', onDrag);
    document.addEventListener('mouseup', onDragEnd);
  });
}
