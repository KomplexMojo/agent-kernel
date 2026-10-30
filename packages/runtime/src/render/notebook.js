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
  const inRoom = (x, y) => rooms.some((room) => x >= room.x && x < room.x + room.width && y >= room.y && y < room.y + room.height);

  // Hallway cells: seen floor outside every known room.
  const lineBlocks = new Set();
  grid.forEach((row, y) => row.forEach((char, x) => { if (open(char) && !inRoom(x, y)) lineBlocks.add(block(x, y)); }));

  // A room is one mark, at the block holding its centre. A hallway block touching the room's
  // body is led on to that mark (across x, then y) so the line meets it.
  const marks = new Map();
  const centreOf = (room) => block(room.x + Math.floor(room.width / 2), room.y + Math.floor(room.height / 2));
  for (const room of rooms) marks.set(centreOf(room), room);
  const bodyBlocks = (room) => {
    const found = new Set();
    for (let y = room.y; y < room.y + room.height; y += 1) for (let x = room.x; x < room.x + room.width; x += 1) found.add(block(x, y));
    return found;
  };
  const joined = new Set(lineBlocks);
  for (const room of rooms) {
    const body = bodyBlocks(room);
    const [cx, cy] = parse(centreOf(room));
    for (const key of lineBlocks) {
      const [bx, by] = parse(key);
      const touches = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => body.has(`${bx + dx},${by + dy}`));
      if (!touches) continue;
      let [x, y] = [bx, by];
      for (let guard = 0; guard < 64 && (x !== cx || y !== cy); guard += 1) {
        const step = body.has(`${x + Math.sign(cx - x)},${y}`) && x !== cx ? [Math.sign(cx - x), 0] : [0, Math.sign(cy - y)];
        if (step[0] === 0 && step[1] === 0) break;
        x += step[0]; y += step[1];
        if (!marks.has(`${x},${y}`)) joined.add(`${x},${y}`);
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
  const hereRoom = player ? rooms.find((room) => player.x >= room.x && player.x < room.x + room.width
    && player.y >= room.y && player.y < room.y + room.height) ?? null : null;
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
