/**
 * The notebook (Darren, 2026-10-30; notes/ascii-minimap-layouts-2026-10-30.md): the player's
 * second context. The first is the 10x10 window of what they see; this is what they remember,
 * jotted as symbols, not redrawn: a mark where a room is, single-line hallways between rooms,
 * and a pie on each room that says how much of what was seen there is done. Pure: the play
 * view in, text lines out. It reads only the fogged rows and the rooms the seat has been near,
 * so it can show nothing the player does not know.
 *
 * Layout is the room graph, not a redraw of fogged floor: one pie per room at its centre, and
 * at most one Manhattan lead per undirected room–room edge (or one stub for a hallway that only
 * touches a single known room). Painting every scale-quantized hallway cell, or leading A→B and
 * B→A, filled opposite L-paths into corridor rectangles with ├┤ junctions (generate-random seed 4).
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
 * @param {(glyph:string, mark:"start"|"exit")=>string} [args.paint]  colours a start/exit cell (#593); without it, plain text
 * @returns {{ lines: string[], here: object|null }}
 */
export function buildNotebook({ rows, legend = {}, rooms = [], player = null, scale = NOTEBOOK_SCALE, ascii = false, paint = null } = {}) {
  const grid = (rows || []).map((row) => [...row]);
  const walls = new Set([legend.wall, ...(Array.isArray(legend.wallGlyphs) ? legend.wallGlyphs : [])].filter(Boolean));
  const open = (char) => char !== undefined && char !== " " && char !== legend.fog && !walls.has(char);
  const block = (x, y) => `${Math.floor(x / scale)},${Math.floor(y / scale)}`;
  const parse = (key) => key.split(",").map(Number);
  const roomAt = (x, y) => rooms.find((room) => x >= room.x && x < room.x + room.width && y >= room.y && y < room.y + room.height) ?? null;
  const centreOf = (room) => block(room.x + Math.floor(room.width / 2), room.y + Math.floor(room.height / 2));
  const tileKey = (x, y) => `${x},${y}`;

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

  // True hallway tiles (outside every room rect AND outside every room's notebook footprint).
  // Doorway tiles that only look like hallways because of scale quantization become ports.
  const hallTiles = [];
  const ports = []; // { room, x, y, key } — outside-rect open tile on a room body block
  grid.forEach((row, y) => row.forEach((char, x) => {
    if (!open(char) || roomAt(x, y)) return;
    const key = block(x, y);
    const bodyRoom = bodyBlocks.get(key);
    if (bodyRoom) ports.push({ room: bodyRoom, x, y, key });
    else hallTiles.push({ x, y, key });
  }));

  /** Undirected room–room edges keyed by sorted notebook centres. */
  const edges = new Set();
  const joinRooms = (a, b) => {
    if (!a || !b || a === b) return;
    const ends = [centreOf(a), centreOf(b)].sort();
    edges.add(`${ends[0]}|${ends[1]}`);
  };

  /** Board-adjacent to the room rect, or notebook-adjacent to its body/centre (scale stubs). */
  const touchesRoom = (room, x, y) => {
    if ([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => roomAt(x + dx, y + dy) === room)) return true;
    const [bx, by] = parse(block(x, y));
    return [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => {
      const n = `${bx + dx},${by + dy}`;
      return bodyBlocks.get(n) === room || centreOf(room) === n;
    });
  };

  // Connected components of true hallway tiles → room edges or a single stub per orphan.
  const parent = new Map();
  const find = (key) => {
    while (parent.get(key) !== key) {
      parent.set(key, parent.get(parent.get(key)));
      key = parent.get(key);
    }
    return key;
  };
  const unite = (a, b) => {
    a = find(a);
    b = find(b);
    if (a !== b) parent.set(a, b);
  };
  for (const tile of hallTiles) parent.set(tileKey(tile.x, tile.y), tileKey(tile.x, tile.y));
  for (const tile of hallTiles) {
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const n = tileKey(tile.x + dx, tile.y + dy);
      if (parent.has(n)) unite(tileKey(tile.x, tile.y), n);
    }
  }
  const comps = new Map();
  for (const tile of hallTiles) {
    const root = find(tileKey(tile.x, tile.y));
    if (!comps.has(root)) comps.set(root, []);
    comps.get(root).push(tile);
  }

  const stubs = []; // { from: notebookKey, room }
  for (const tiles of comps.values()) {
    const touched = rooms.filter((room) => tiles.some((tile) => touchesRoom(room, tile.x, tile.y)));
    if (touched.length >= 2) {
      for (let i = 0; i < touched.length; i += 1) {
        for (let j = i + 1; j < touched.length; j += 1) joinRooms(touched[i], touched[j]);
      }
    } else if (touched.length === 1) {
      const uniq = [...new Set(tiles.map((tile) => tile.key))];
      const cx = Math.round(uniq.map((key) => parse(key)[0]).reduce((a, b) => a + b, 0) / uniq.length);
      const cy = Math.round(uniq.map((key) => parse(key)[1]).reduce((a, b) => a + b, 0) / uniq.length);
      stubs.push({ from: `${cx},${cy}`, room: touched[0] });
    }
  }

  // Ports are doors/spawns compressed onto a room footprint: join the two rooms they bridge.
  for (const port of ports) {
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = port.x + dx;
      const ny = port.y + dy;
      if (!open(grid[ny]?.[nx])) continue;
      const other = roomAt(nx, ny) ?? bodyBlocks.get(block(nx, ny)) ?? null;
      if (other && other !== port.room) joinRooms(port.room, other);
    }
  }

  const joined = new Set();

  /** One Manhattan lead; marks stay pies. Abutting centres (dist ≤ 1) need no hallway. */
  const lead = (fromKey, toKey) => {
    let [x, y] = parse(fromKey);
    const [tx, ty] = parse(toKey);
    if (Math.abs(x - tx) + Math.abs(y - ty) <= 1) return;
    for (let guard = 0; guard < 64 && (x !== tx || y !== ty); guard += 1) {
      const step = x !== tx ? [Math.sign(tx - x), 0] : [0, Math.sign(ty - y)];
      x += step[0];
      y += step[1];
      if (!marks.has(`${x},${y}`)) joined.add(`${x},${y}`);
    }
  };

  // One lead per undirected edge, always from the top-left centre so A→B and B→A cannot paint
  // opposite L-paths into a corridor rectangle (the seed-4 ├┤ failure).
  for (const edge of edges) {
    const [a, b] = edge.split("|");
    const [ax, ay] = parse(a);
    const [bx, by] = parse(b);
    if (ay < by || (ay === by && ax <= bx)) lead(a, b);
    else lead(b, a);
  }
  for (const stub of stubs) {
    if (!marks.has(stub.from)) joined.add(stub.from);
    lead(stub.from, centreOf(stub.room));
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

  // #593: a room holding the start or the exit gets an S and/or E beside its pie, in the blank cell
  // to the right, else the left. With no blank cell the pie takes the colour instead (exit wins);
  // the letter is never placed over a hallway or another room's note.
  const marked = new Map(); // cell key -> "start" | "exit"
  const claimed = new Set();
  const free = (x, y) => !cells.has(`${x},${y}`) && !claimed.has(`${x},${y}`);
  for (const [key, room] of marks) {
    const kinds = [room.start ? "start" : null, room.exit ? "exit" : null].filter(Boolean);
    if (kinds.length === 0) continue;
    const [x, y] = parse(key);
    const spots = [[x - 1, y], [x + 1, y]].filter(([sx, sy]) => free(sx, sy));
    const place = (spot, kind) => { claimed.add(`${spot[0]},${spot[1]}`); marked.set(`${spot[0]},${spot[1]}`, kind); cells.set(`${spot[0]},${spot[1]}`, kind === "start" ? "S" : "E"); };
    if (kinds.length === 2 && spots.length === 2) { place(spots[0], "start"); place(spots[1], "exit"); }
    else if (kinds.length === 1 && spots.length > 0) place(spots[spots.length - 1], kinds[0]);
    else if (cells.get(key) !== "@") marked.set(key, kinds[kinds.length - 1]);
  }

  if (cells.size === 0) return { lines: [], here: hereRoom };
  const coords = [...cells.keys()].map(parse);
  const [minX, maxX] = [Math.min(...coords.map(([x]) => x)), Math.max(...coords.map(([x]) => x))];
  const [minY, maxY] = [Math.min(...coords.map(([, y]) => y)), Math.max(...coords.map(([, y]) => y))];
  const lines = [];
  for (let y = minY; y <= maxY; y += 1) {
    const row = [];
    for (let x = minX; x <= maxX; x += 1) row.push([cells.get(`${x},${y}`) ?? " ", marked.get(`${x},${y}`) ?? null]);
    while (row.length > 0 && row[row.length - 1][0] === " ") row.pop();
    lines.push(row.map(([glyph, mark]) => (mark && paint ? paint(glyph, mark) : glyph)).join(""));
  }
  return { lines, here: hereRoom };
}
