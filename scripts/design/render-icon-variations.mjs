// Icon presentation variations for the chip UI (.design-card-icon-chip, 28px).
//   node scripts/design/render-icon-variations.mjs
import { writeFileSync } from "node:fs";
import { encodePng } from "./png.mjs";
import { FONT } from "./glyphs.mjs";
import { GAME_COLOR_PALETTE, GAME_AFFINITY_COLOR_HEX } from "../../packages/runtime/src/contracts/game-elements.js";
import { outlineForFill } from "../../packages/runtime/src/render/entity-sprite-composer.js";

const S = 6;                 // draw the 28px chip at 6x so decisions are visible
const CHIP = 28, CELL = CHIP * S + 26;
const PANEL = "#1e1818";     // the UI card background these chips sit on
const CHIP_BG = "#151011";   // current chip background
const CHIP_BORDER = "#674f48";
const INK = "#e8ecf0", DIM = "#8a949e";

const SUBJECTS = [
  { label: "fire",    kind: "affinity", color: GAME_AFFINITY_COLOR_HEX.fire },
  { label: "water",   kind: "affinity", color: GAME_AFFINITY_COLOR_HEX.water },
  { label: "dark",    kind: "affinity", color: GAME_AFFINITY_COLOR_HEX.dark },
  { label: "fortify", kind: "affinity", color: GAME_AFFINITY_COLOR_HEX.fortify },
  { label: "delver",  kind: "role", shape: "delver",   color: GAME_COLOR_PALETTE.types.delver },
  { label: "warden",  kind: "role", shape: "warden",   color: GAME_COLOR_PALETTE.types.warden },
  { label: "hazard",  kind: "role", shape: "hazard",   color: GAME_COLOR_PALETTE.items.hazard },
  { label: "health",  kind: "vital", color: GAME_COLOR_PALETTE.vitals.health },
];
const VARIANTS = [
  ["CURRENT", "art fills the chip; its own\nopaque bg hides the chip"],
  ["A INSET GLYPH", "transparent art at 60%,\nchip ring + bg do the work"],
  ["B FILLED DISC", "disc in the element colour,\nglyph knocked out"],
  ["C COLOUR RING", "colour in a 2px ring,\nneutral glyph inside"],
  ["D TINTED WASH", "chip bg tinted by element,\nglyph at full colour"],
  ["A+ INSET OUTLINED", "A, plus the board's own\noutline rule on the glyph"],
  ["D+ WASH OUTLINED", "D, plus the board's own\noutline rule on the glyph"],
];

const W = 150 + VARIANTS.length * CELL, H = 96 + SUBJECTS.length * CELL;
const buf = Buffer.alloc(W * H * 4);
const rgb = (h) => [parseInt(h.slice(1,3),16), parseInt(h.slice(3,5),16), parseInt(h.slice(5,7),16)];
const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
function px(x, y, c, al = 1) {
  x |= 0; y |= 0; if (x < 0 || y < 0 || x >= W || y >= H) return;
  const i = (y * W + x) * 4;
  for (let k = 0; k < 3; k++) buf[i+k] = Math.round(c[k] * al + buf[i+k] * (1 - al));
  buf[i+3] = 255;
}
const rect = (x,y,w,h,c,a=1) => { for (let j=0;j<h;j++) for (let i=0;i<w;i++) px(x+i,y+j,c,a); };
function text(s, x, y, c, sc = 1) {
  let cx = x;
  for (const ch of String(s).toUpperCase()) {
    const g = FONT[ch] || FONT[" "];
    for (let r = 0; r < 7; r++) for (let q = 0; q < 5; q++) if (g[r][q]) rect(cx+q*sc, y+r*sc, sc, sc, c);
    cx += 6 * sc;
  }
}
// Shape membership in normalized [-1,1]; `null` shape = a plain colour mark (affinity).
function inShape(shape, u, v) {
  switch (shape) {
    case "delver": return v > -0.92 && Math.abs(u) <= ((v + 0.92) / 1.84) * 0.98;
    case "warden": { const a = Math.atan2(v,u); const s = (((a % (Math.PI/3)) + Math.PI/3) % (Math.PI/3)) - Math.PI/6;
                     return Math.hypot(u,v) <= (0.94*Math.cos(Math.PI/6))/Math.cos(s); }
    case "hazard": return v < 0.92 && Math.abs(u) <= ((0.92 - v) / 1.84) * 0.98;
    case "drop":   return Math.hypot(u, v * 0.85) <= 0.86;           // affinity mark
    case "bar":    return Math.abs(v) <= 0.34 && Math.abs(u) <= 0.86; // vital mark
    default:       return Math.hypot(u, v) <= 0.86;
  }
}
function markFor(s) { return s.kind === "role" ? s.shape : s.kind === "vital" ? "bar" : "drop"; }

// One chip. `inset` is the fraction of the chip the glyph occupies.
function chip(ox, oy, subj, variant) {
  const col = rgb(subj.color), panel = rgb(PANEL), chipBg = rgb(CHIP_BG), border = rgb(CHIP_BORDER);
  const R = (CHIP * S) / 2, cx = ox + R, cy = oy + R;
  const shape = markFor(subj);
  const inset = variant === "CURRENT" ? 1.0 : 0.58;
  // A+ keeps A's plain chip background
  const ringW = variant === "C COLOUR RING" ? 2 * S : 1 * S;
  const ringCol = variant === "C COLOUR RING" ? col : border;
  let bg = chipBg;
  if (variant === "B FILLED DISC") bg = col;
  if (variant === "D TINTED WASH" || variant === "D+ WASH OUTLINED") bg = mix(panel, col, 0.20);
  if (variant === "CURRENT") bg = mix(chipBg, [0,0,0], 0.15); // the art's own opaque square

  for (let y = -R; y < R; y++) for (let x = -R; x < R; x++) {
    const d = Math.hypot(x, y);
    // CURRENT: the baked-in art background is a SQUARE, so it overruns the round chip
    const inChip = variant === "CURRENT" ? true : d <= R;
    if (!inChip) continue;
    if (d > R - ringW && variant !== "CURRENT") { px(cx+x, cy+y, ringCol); continue; }
    px(cx + x, cy + y, bg);
  }
  const gr = R * inset;
  const outlined = variant.endsWith("OUTLINED");
  const outline = rgb(outlineForFill(subj.color));
  const step = 1;
  for (let y = -gr; y < gr; y++) for (let x = -gr; x < gr; x++) {
    const u = x / gr, v = y / gr;
    if (!inShape(shape, u, v)) continue;
    let c = col;
    if (variant === "B FILLED DISC") c = mix(panel, [0,0,0], 0.25);
    if (variant === "C COLOUR RING") c = rgb("#e8ecf0");
    if (outlined) {
      // Edge test in glyph space, same rule the board sprite uses.
      const edge = [[step,0],[-step,0],[0,step],[0,-step]]
        .some(([dx,dy]) => !inShape(shape, (x+dx)/gr, (y+dy)/gr));
      if (edge) c = outline;
    }
    px(cx + x, cy + y, c);
  }
}

rect(0, 0, W, H, rgb(PANEL));
text("ICON CHIP VARIATIONS - 28PX CHIP SHOWN AT 6X", 20, 20, rgb(INK), 2);
text("PROBLEM: THE ART HAS AN OPAQUE BACKGROUND AND CSS FORCES WIDTH 100%, SO IT FILLS THE CHIP EDGE TO EDGE.", 20, 42, rgb(DIM), 1);
text("THE CHIP RING AND BACKGROUND BECOME INVISIBLE AND THE GLYPH HAS NO BREATHING ROOM.", 20, 54, rgb(DIM), 1);

VARIANTS.forEach(([name, desc], c) => {
  const x = 150 + c * CELL;
  text(name, x, 72, rgb(INK), 1);
  desc.split("\n").forEach((ln, i) => text(ln, x, 84 + i * 10, rgb(DIM), 1));
});
SUBJECTS.forEach((s, r) => {
  const y = 116 + r * CELL;
  text(s.label, 20, y + (CHIP * S) / 2 - 4, rgb(INK), 1);
  text(s.kind, 20, y + (CHIP * S) / 2 + 8, rgb(DIM), 1);
  VARIANTS.forEach(([name], c) => chip(150 + c * CELL, y, s, name));
});
writeFileSync(new URL("../../docs/design/icon-chip-variations.png", import.meta.url), encodePng(W, H, buf));
console.log(`wrote docs/design/icon-chip-variations.png (${W}x${H})`);
