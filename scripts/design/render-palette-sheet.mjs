import { writeFileSync, readFileSync } from "node:fs";
import { encodePng } from "./png.mjs";
import { FONT } from "./glyphs.mjs";

const NEW = JSON.parse(readFileSync(new URL("../../docs/design/affinity-palette-2026-09.json", import.meta.url), "utf8"));
const OLD = { fire:"#f05a28", water:"#2b7fff", earth:"#7a5c33", wind:"#60d8c0", life:"#49b96b",
              decay:"#a05828", corrode:"#c8c030", fortify:"#9ca3af", light:"#f5d14d", dark:"#0b0d12" };
const ORDER = ["fire","water","earth","wind","life","decay","corrode","fortify","light","dark"];
const FLOOR = "#3a3a3a", BG = "#15181c", INK = "#e8ecf0", DIM = "#8a949e", OUTLINE = "#f2f5f8";

const W = 1268, H = 760;
const buf = Buffer.alloc(W * H * 4);
const rgb = (h) => [parseInt(h.slice(1,3),16), parseInt(h.slice(3,5),16), parseInt(h.slice(5,7),16)];
function px(x, y, c, a = 255) {
  x |= 0; y |= 0; if (x < 0 || y < 0 || x >= W || y >= H) return;
  const i = (y * W + x) * 4, s = a / 255, d = buf[i+3] / 255, o = s + d * (1 - s);
  if (o <= 0) return;
  for (let k = 0; k < 3; k++) buf[i+k] = Math.round((c[k]*s + buf[i+k]*d*(1-s)) / o);
  buf[i+3] = Math.round(o * 255);
}
const rect = (x,y,w,h,c,a=255) => { for (let j=0;j<h;j++) for (let i=0;i<w;i++) px(x+i,y+j,c,a); };
function text(s, x, y, c, sc = 1) {
  let cx = x;
  for (const ch of s.toUpperCase()) {
    const g = FONT[ch] || FONT[" "];
    for (let r = 0; r < 7; r++) for (let q = 0; q < 5; q++) if (g[r][q]) rect(cx + q*sc, y + r*sc, sc, sc, c);
    cx += 6 * sc;
  }
  return cx;
}
// Role silhouettes, rasterised the way the composer will: a filled shape + 1px outline.
function shape(role, cx, cy, size, fill, outline) {
  const r = size / 2, inside = [];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = (x + 0.5) / size * 2 - 1, v = (y + 0.5) / size * 2 - 1;
    let hit = false;
    if (role === "delver") hit = v > -0.92 && Math.abs(u) <= (v + 0.92) / 1.84 * 0.98;      // ▲
    else if (role === "warden") { const a = Math.atan2(v, u), rr = Math.hypot(u, v);          // ⬢
      hit = rr <= 0.94 * Math.cos(Math.PI/6) / Math.cos(((a % (Math.PI/3)) + Math.PI/3) % (Math.PI/3) - Math.PI/6); }
    else if (role === "resource") hit = Math.abs(u) + Math.abs(v) <= 0.92;                    // ◆
    else { const a = Math.atan2(v, u), rr = Math.hypot(u, v); hit = rr <= 0.45 + 0.48 * Math.abs(Math.cos(4 * a)); } // ✳
    if (hit) inside.push([x, y]);
  }
  const set = new Set(inside.map(([x,y]) => y*size+x));
  for (const [x, y] of inside) {
    const edge = [[1,0],[-1,0],[0,1],[0,-1]].some(([dx,dy]) => !set.has((y+dy)*size + (x+dx)));
    px(cx - r + x, cy - r + y, edge && size >= 12 ? outline : fill);
  }
}
rect(0, 0, W, H, rgb(BG));
text("AFFINITY PALETTE - LANDED 2026-09-02", 24, 22, rgb(INK), 2);
text("BOXED BY SEMANTICS, OPTIMISED IN OKLCH, PAIRED BY THE AFFINITY-OPPOSITES TABLE", 24, 46, rgb(DIM), 1);

// --- Section 1: old vs new, grouped by opposite pair
let y = 76;
text("RETIRED", 250, y, rgb(DIM), 1);
text("LANDED", 340, y, rgb(DIM), 1);
text("OPPOSED ON", 470, y, rgb(DIM), 1);
y += 14;
const PAIRS = [["fire","water","HUE"],["earth","wind","HUE"],["life","decay","HUE"],
               ["corrode","fortify","CHROMA - SATURATED VS NEUTRAL"],["light","dark","LIGHTNESS - NEAR WHITE VS CHARCOAL"]];
for (const [a, b, axis] of PAIRS) {
  for (const [k, name] of [[0, a], [1, b]]) {
    const ry = y + k * 30;
    text(name, 24, ry + 9, rgb(INK), 2);
    rect(250, ry, 44, 24, rgb(OLD[name]));
    text(OLD[name], 298, ry + 9, rgb(DIM), 1);
    rect(340, ry, 44, 24, rgb(NEW[name]));
    text(NEW[name], 388, ry + 9, rgb(INK), 1);
  }
  axis.split(" - ").forEach((ln, li) => text(ln, 470, y + 10 + li * 12, rgb(DIM), 1));
  rect(455, y + 2, 2, 52, rgb(DIM), 120);
  y += 76;
}

// --- Section 2: the actual test — sprites on the real floor colour at real sizes
const sx = 640;
text("ON THE BOARD - FLOOR #3A3A3A, AT REAL PIXEL SIZES", sx, 76, rgb(INK), 1);
text("32PX      16   12  8        32PX      16   12  8", sx, 94, rgb(DIM), 1);
rect(sx, 108, 600, 588, rgb(FLOOR));
for (let i = 0; i < ORDER.length; i++) {
  const name = ORDER[i];
  const col = i % 2, row = (i / 2) | 0;
  const bx = sx + 12 + col * 300, by = 120 + row * 116;
  text(name, bx, by, rgb(INK), 1);
  shape("delver", bx + 20, by + 34, 32, rgb(NEW[name]), rgb(OUTLINE));
  shape("warden", bx + 20, by + 76, 32, rgb(NEW[name]), rgb(OUTLINE));
  shape("delver", bx + 78, by + 34, 16, rgb(NEW[name]), rgb(OUTLINE));
  shape("warden", bx + 78, by + 76, 16, rgb(NEW[name]), rgb(OUTLINE));
  shape("delver", bx + 112, by + 34, 12, rgb(NEW[name]), rgb(OUTLINE));
  shape("delver", bx + 138, by + 34, 8, rgb(NEW[name]), rgb(OUTLINE));
  shape("warden", bx + 112, by + 76, 12, rgb(NEW[name]), rgb(OUTLINE));
  shape("warden", bx + 138, by + 76, 8, rgb(NEW[name]), rgb(OUTLINE));
  // side-by-side with the CURRENT colour, same shapes, for direct comparison
  shape("delver", bx + 160, by + 34, 32, rgb(OLD[name]), rgb(OUTLINE));
  shape("warden", bx + 160, by + 76, 32, rgb(OLD[name]), rgb(OUTLINE));
  shape("delver", bx + 200, by + 34, 16, rgb(OLD[name]), rgb(OUTLINE));
  shape("warden", bx + 200, by + 76, 16, rgb(OLD[name]), rgb(OUTLINE));
  shape("delver", bx + 250, by + 34, 12, rgb(OLD[name]), rgb(OUTLINE));
  shape("delver", bx + 274, by + 34, 8, rgb(OLD[name]), rgb(OUTLINE));
  shape("warden", bx + 250, by + 76, 12, rgb(OLD[name]), rgb(OUTLINE));
  shape("warden", bx + 274, by + 76, 8, rgb(OLD[name]), rgb(OUTLINE));
}
text("LEFT BLOCK - LANDED       RIGHT BLOCK - RETIRED", sx, 706, rgb(DIM), 1);
// four roles
text("ROLES AT 32 / 16 / 12 / 8 - SHAPE SEPARABILITY", 24, 470, rgb(INK), 1);
rect(24, 486, 420, 210, rgb(FLOOR));
["delver","warden","resource","hazard"].forEach((role, i) => {
  const ry = 500 + i * 50;
  text(role, 34, ry + 12, rgb(INK), 1);
  shape(role, 150, ry + 16, 32, rgb(NEW.fire), rgb(OUTLINE));
  shape(role, 215, ry + 16, 16, rgb(NEW.fire), rgb(OUTLINE));
  shape(role, 258, ry + 16, 12, rgb(NEW.fire), rgb(OUTLINE));
  shape(role, 288, ry + 16, 8, rgb(NEW.fire), rgb(OUTLINE));
  shape(role, 340, ry + 16, 32, rgb(NEW.water), rgb(OUTLINE));
  shape(role, 400, ry + 16, 16, rgb(NEW.water), rgb(OUTLINE));
});
writeFileSync(new URL("../../docs/design/affinity-palette-sheet.png", import.meta.url), encodePng(W, H, buf));
console.log("wrote palette-sheet.png");
