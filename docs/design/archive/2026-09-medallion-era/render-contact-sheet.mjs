// Regenerates the medallion-era contact sheet from the frozen composer.
//   node docs/design/archive/2026-09-medallion-era/render-contact-sheet.mjs
// Writes contact-sheet.png beside this file. Self-contained: the frozen composer
// vendors the era's palette, so this keeps working after the live palette changes.
import { writeFileSync } from "node:fs";
import { composeActorMedallion, normalizeActorMedallionState } from "./actor-medallion-composer.frozen.js";
import { encodePng } from "../../../../scripts/design/png.mjs";
import { FONT } from "../../../../scripts/design/glyphs.mjs";

const SUBJECTS = [
  { role: "delver", affinity: "fire",    expression: "push", motivation: "exploring" },
  { role: "delver", affinity: "water",   expression: "pull", motivation: "patrolling" },
  { role: "delver", affinity: "wind",    expression: "emit", motivation: "attacking" },
  { role: "warden", affinity: "fire",    expression: "draw", motivation: "defending" },
  { role: "warden", affinity: "fortify", expression: "emit", motivation: "stationary" },
  { role: "warden", affinity: "dark",    expression: "push", motivation: "stealthy" },
];
const SIZES = [64, 32, 16];
const VITALS = { durability: { current: 7, max: 10, fraction: 0.7 }, health: { current: 4, max: 10, fraction: 0.4 },
                 stamina: { current: 9, max: 10, fraction: 0.9 }, mana: { current: 2, max: 10, fraction: 0.2 } };

const CELL = 96, PAD = 16, HEAD = 64, GUT = 52;
const W = PAD * 2 + GUT + SUBJECTS.length * CELL;
const H = HEAD + PAD + SIZES.length * (CELL + 26) + PAD;
const buf = Buffer.alloc(W * H * 4);
const put = (x, y, c) => { if (x < 0 || y < 0 || x >= W || y >= H) return; const i = (y * W + x) * 4; buf[i] = c[0]; buf[i+1] = c[1]; buf[i+2] = c[2]; buf[i+3] = c[3] ?? 255; };
const rect = (x, y, w, h, c) => { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) put(x + i, y + j, c); };
function text(s, x, y, c, sc = 1) {
  let cx = x;
  for (const ch of String(s).toUpperCase()) {
    const g = FONT[ch] || FONT[" "];
    for (let r = 0; r < 7; r++) for (let q = 0; q < 5; q++) if (g[r][q]) rect(cx + q * sc, y + r * sc, sc, sc, c);
    cx += 6 * sc;
  }
}
rect(0, 0, W, H, [26, 29, 34, 255]);
text("MEDALLION ERA - RETIRED 2026-09-02", PAD, 16, [232, 236, 240, 255], 2);
text("EIGHT DIMENSIONS IN ONE TILE - ROLE, AFFINITY, EXPRESSION, MOTIVATION, 4 VITALS", PAD, 38, [138, 148, 158, 255], 1);

SIZES.forEach((size, row) => {
  const ry = HEAD + PAD + row * (CELL + 26);
  text(`${size}PX`, PAD, ry + CELL / 2, [138, 148, 158, 255], 1);
  SUBJECTS.forEach((subj, col) => {
    const state = normalizeActorMedallionState({ ...subj, vitals: VITALS });
    const px = composeActorMedallion({ actor: subj, state, size });
    const ox = PAD + GUT + col * CELL + (CELL - size) / 2;
    const oy = ry + (CELL - size) / 2;
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      if (px[i + 3] === 0) continue;
      put(ox + x, oy + y, [px[i], px[i + 1], px[i + 2], px[i + 3]]);
    }
    if (row === 0) {
      text(subj.role, PAD + GUT + col * CELL + 4, ry - 24, [232, 236, 240, 255], 1);
      text(subj.affinity, PAD + GUT + col * CELL + 4, ry - 13, [138, 148, 158, 255], 1);
    }
  });
});
writeFileSync(new URL("contact-sheet.png", import.meta.url), encodePng(W, H, buf));
console.log(`wrote contact-sheet.png (${W}x${H})`);
