/**
 * How the people of a call share the screen: the columns and rows that give every picture the largest size for
 * the room there is. A phone held upright stacks two people; turned sideways it puts them side by side; four make
 * a two-by-two. Pure, so the call screen and its test agree (src/components/calls/call-room.tsx).
 */
export interface Grid {
  cols: number;
  rows: number;
}

/** The grid for `count` pictures of shape `aspect` (width / height) in a box of `width` x `height`, `gap` between them. */
export function bestGrid(count: number, width: number, height: number, aspect = 16 / 9, gap = 8): Grid {
  const n = Math.max(1, Math.floor(count));
  if (width <= 0 || height <= 0) return { cols: 1, rows: n };
  let best: Grid = { cols: 1, rows: n };
  let bestArea = -1;
  for (let cols = 1; cols <= n; cols++) {
    const rows = Math.ceil(n / cols);
    const cellW = (width - gap * (cols - 1)) / cols;
    const cellH = (height - gap * (rows - 1)) / rows;
    if (cellW <= 0 || cellH <= 0) continue;
    // the picture inside its cell keeps its shape: it is as large as the tighter side allows
    const picW = Math.min(cellW, cellH * aspect);
    const area = picW * (picW / aspect);
    if (area > bestArea + 0.5) {
      bestArea = area;
      best = { cols, rows };
    }
  }
  return best;
}
