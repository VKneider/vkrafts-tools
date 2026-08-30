// Pure geometry helpers for DragDropService — no DOM, no state.
//
// Extracted so they can be unit-tested in Node (see DragDropService.test.js),
// the same way DataGridEngine exposes its math as static helpers. The service
// imports these; consumers never touch them directly.

// Maps a handle name to the box edges it drives.
export function getHandleConfig(name) {
  const MAP = {
    n:  { edges: ['n'] },
    s:  { edges: ['s'] },
    e:  { edges: ['e'] },
    w:  { edges: ['w'] },
    ne: { edges: ['n', 'e'] },
    nw: { edges: ['n', 'w'] },
    se: { edges: ['s', 'e'] },
    sw: { edges: ['s', 'w'] },
  };
  return MAP[name] || null;
}

export function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

// Given the original rect, a pointer delta, and the active edges, returns the
// new { top, left, width, height }. West/north edges move the origin so the
// opposite edge stays pinned; clamping to min/max never lets the box cross over.
export function computeResizeRect(orig, delta, edges, minW, minH, maxW, maxH) {
  let { top, left, width, height } = orig;
  if (edges.includes('e')) width = clamp(width + delta.x, minW, maxW);
  if (edges.includes('s')) height = clamp(height + delta.y, minH, maxH);
  if (edges.includes('w')) {
    const nw = clamp(width - delta.x, minW, maxW);
    left += width - nw;
    width = nw;
  }
  if (edges.includes('n')) {
    const nh = clamp(height - delta.y, minH, maxH);
    top += height - nh;
    height = nh;
  }
  return { top, left, width, height };
}
