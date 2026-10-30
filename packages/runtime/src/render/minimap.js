/**
 * Mini map prototype (Darren, 2026-10-30; spec notes/ascii-minimap-layouts-2026-10-30.md).
 * Pure: a play view's board rows in, map lines out. The rows already hide what the seat has never
 * seen (the fog glyph) and carry no actors it cannot see, so the map shows remembered layout and
 * nothing more. Every UI renders these lines; none computes them.
 *
 * Each `scale` x `scale` block of tiles becomes one character, floor beats wall (so a corridor
 * survives): `.` any floor, `#` only wall, ` ` never seen, `@` the block holding the seat.
 */
export const MINIMAP_SCALE = 2;

/** @param {{rows: string[], legend: object, player?: {x:number,y:number}|null, scale?: number}} args */
export function buildMinimap({ rows, legend = {}, player = null, scale = MINIMAP_SCALE } = {}) {
  const grid = (rows || []).map((row) => [...row]);
  const walls = new Set([legend.wall, ...(Array.isArray(legend.wallGlyphs) ? legend.wallGlyphs : [])].filter(Boolean));
  const kind = (char) => (char === undefined || char === legend.fog || char === " " ? "unseen" : walls.has(char) ? "wall" : "floor");
  const height = Math.ceil(grid.length / scale);
  const width = Math.ceil(Math.max(0, ...grid.map((row) => row.length)) / scale);
  const lines = [];
  for (let by = 0; by < height; by += 1) {
    let line = "";
    for (let bx = 0; bx < width; bx += 1) {
      const kinds = new Set();
      for (let y = by * scale; y < Math.min(grid.length, (by + 1) * scale); y += 1) {
        for (let x = bx * scale; x < (bx + 1) * scale; x += 1) kinds.add(kind(grid[y][x]));
      }
      const here = player && Math.floor(player.x / scale) === bx && Math.floor(player.y / scale) === by;
      line += here ? "@" : kinds.has("floor") ? "." : kinds.has("wall") ? "#" : " ";
    }
    lines.push(line);
  }
  // Trim empty margins so a small explored patch is not lost in a big level.
  const used = lines.filter((line) => line.trim() !== "");
  if (used.length === 0) return [];
  const left = Math.min(...used.map((line) => line.length - line.trimStart().length));
  const top = lines.findIndex((line) => line.trim() !== "");
  const bottom = lines.length - 1 - [...lines].reverse().findIndex((line) => line.trim() !== "");
  return lines.slice(top, bottom + 1).map((line) => line.slice(left).trimEnd());
}
