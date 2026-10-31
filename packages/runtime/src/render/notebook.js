/**
 * The notebook (Darren, 2026-10-30; notes/ascii-minimap-layouts-2026-10-30.md): the player's
 * second context. The first is the 10x10 window of what they see; this is what they remember,
 * jotted as symbols, not redrawn: a mark where a room is, single-line hallways between rooms,
 * and a pie on each room that says how much of what was seen there is done. Pure: the play
 * view in, text lines out. It reads only the fogged rows and the rooms the seat has been near,
 * so it can show nothing the player does not know.
 */

/** Cleared pies, one column wide each (East Asian Width N): none, 1/4, 1/2, 3/4, all. */
export const PIE_GLYPHS = Object.freeze(["◌", "◔", "◒", "◕", "◉"]);
export const PIE_ASCII = Object.freeze(["0", "1", "2", "3", "4"]);
/** Tiles per notebook cell. */
export const NOTEBOOK_SCALE = 4;

/** 0..4 quarters cleared. Only seen things count; a room is all-clear only once fully explored. */
export function pieQuarters(room) {
  if (room.seen === 0) return room.explored ? 4 : 0;
  const quarters = Math.floor((4 * room.done) / room.seen);
  return room.explored ? quarters : Math.min(quarters, 3);
}

const LINE = Object.freeze({
  "": "∙", N: "│", S: "│", NS: "│", E: "─", W: "─", EW: "─",
  NE: "└", NW: "┘", ES: "┌", SW: "┐", NES: "├", NSW: "┤",
  ESW: "┬", NEW: "┴", NESW: "┼",
});
const LINE_ASCII = Object.freeze({ "": "+", N: "|", S: "|", NS: "|", E: "-", W: "-", EW: "-" });

/**
 * @param {object} args
 * @param {string[]} args.rows        the seat's fogged board rows (never-seen cells are `legend.fog`)
 * @param {object}   args.legend      `{ wall, wallGlyphs, fog }`
 * @param {Array}    args.rooms       `view.rooms`: the rooms the seat has been near, with seen/done/explored
 * @param {{x:number,y:number}|null} [args.player]
 * @param {boolean}  [args.ascii]     digits and `- | +` instead of pies and line glyphs
 * @returns {{ lines: string[], here: object|null }}
 */
export function buildNotebook({ rows, legend = {}, rooms = [], player = null, scale = NOTEBOOK_SCALE, ascii = false } = {}) {
  const grid = (rows || []).map((row) => [...row]);
  const walls = new Set([legend.wall, ...(Array.isArray(legend.wallGlyphs) ? legend.wallGlyphs : [])].filter(Boolean));
  const open = (char) => char !== undefined && char !== " " && char !== legend.fog && !walls.has(char);
  const block = (x, y) => `${Math.floor(x / scale)},${Math.floor(y / scale)}`;
  const parse = (key) => key.split(",").map(Number);
  const roomAt = (x, y) => rooms.find((room) => x >= room.x && x < room.x + room.width && y >= room.y && y < room.y + room.height) ?? null;
  const centreOf = (room) => block(room.x + Math.floor(room.width / 2), room.y + Math.floor(room.height / 2));

  // Notebook cells covered by each room's tile rect. A doorway/spawn tile just outside the rect
  // often hashes into one of these (scale > 1); painting that cell as a hallway put a dangling
  // corridor stub on the room's own footprint (full-budget-tactics seed 9 playtest).
  const bodyBlocks = new Map();
  for (const room of rooms) {
    for (let y = room.y; y < room.y + room.height; y += 1) {
      for (let x = room.x; x < room.x + room.width; x += 1) {
        const key = block(x, y);
        if (!bodyBlocks.has(key)) bodyBlocks.set(key, room);
      }
    }
  }

  const marks = new Map();
  for (const room of rooms) marks.set(centreOf(room), room);

  // True hallway cells (outside every room rect AND outside every room's notebook footprint).
  // Doorway tiles that only look like hallways because of scale quantization become ports.
  const lineBlocks = new Set();
  const ports = []; // { room, x, y, key } — outside-rect open tile on a room body block
  grid.forEach((row, y) => row.forEach((char, x) => {
    if (!open(char) || roomAt(x, y)) return;
    const key = block(x, y);
    const bodyRoom = bodyBlocks.get(key);
    if (bodyRoom) ports.push({ room: bodyRoom, x, y, key });
    else lineBlocks.add(key);
  }));

  const joined = new Set(lineBlocks);

  /** Manhattan lead from one notebook cell to another; marks stay pies, not line cells. */
  const lead = (fromKey, toKey) => {
    let [x, y] = parse(fromKey);
    const [tx, ty] = parse(toKey);
    for (let guard = 0; guard < 64 && (x !== tx || y !== ty); guard += 1) {
      const step = x !== tx ? [Math.sign(tx - x), 0] : [0, Math.sign(ty - y)];
      x += step[0];
      y += step[1];
      if (!marks.has(`${x},${y}`)) joined.add(`${x},${y}`);
    }
  };

  // A hallway cell that touches a room footprint is led to that room's mark.
  for (const key of lineBlocks) {
    const [bx, by] = parse(key);
    for (const room of rooms) {
      const touches = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => {
        const n = `${bx + dx},${by + dy}`;
        return bodyBlocks.get(n) === room || centreOf(room) === n;
      });
      if (touches) lead(key, centreOf(room));
    }
  }

  // Ports are doors/spawns compressed onto a room footprint: do not draw them as corridor cells,
  // but when they touch another room (or that room's body), join the two marks so the sketch stays
  // one graph. A spawn that only touches its own room adds nothing (seed 9 start stays a lone @).
  for (const port of ports) {
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = port.x + dx;
      const ny = port.y + dy;
      if (!open(grid[ny]?.[nx])) continue;
      const other = roomAt(nx, ny) ?? bodyBlocks.get(block(nx, ny)) ?? null;
      if (other && other !== port.room) lead(centreOf(port.room), centreOf(other));
      const hallKey = block(nx, ny);
      if (!roomAt(nx, ny) && !bodyBlocks.has(hallKey) && lineBlocks.has(hallKey)) {
        lead(hallKey, centreOf(port.room));
      }
    }
  }

  const occupied = (x, y) => joined.has(`${x},${y}`) || marks.has(`${x},${y}`);
  const cells = new Map();
  for (const key of joined) {
    const [x, y] = parse(key);
    const sides = `${occupied(x, y - 1) ? "N" : ""}${occupied(x + 1, y) ? "E" : ""}${occupied(x, y + 1) ? "S" : ""}${occupied(x - 1, y) ? "W" : ""}`;
    cells.set(key, (ascii ? LINE_ASCII[sides] ?? "+" : LINE[sides]) ?? "+");
  }
  const pies = ascii ? PIE_ASCII : PIE_GLYPHS;
  for (const [key, room] of marks) cells.set(key, pies[pieQuarters(room)]);
  const hereRoom = player ? roomAt(player.x, player.y) : null;
  // You are marked on your room's own mark (the caption names its pie), or on the hallway cell you stand in.
  if (player) cells.set(hereRoom ? centreOf(hereRoom) : block(player.x, player.y), "@");

  if (cells.size === 0) return { lines: [], here: hereRoom };
  const coords = [...cells.keys()].map(parse);
  const [minX, maxX] = [Math.min(...coords.map(([x]) => x)), Math.max(...coords.map(([x]) => x))];
  const [minY, maxY] = [Math.min(...coords.map(([, y]) => y)), Math.max(...coords.map(([, y]) => y))];
  const lines = [];
  for (let y = minY; y <= maxY; y += 1) {
    let line = "";
    for (let x = minX; x <= maxX; x += 1) line += cells.get(`${x},${y}`) ?? " ";
    lines.push(line.trimEnd());
  }
  return { lines, here: hereRoom };
}
