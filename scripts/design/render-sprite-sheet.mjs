// Renders the live entity-sprite composer at every role x affinity, at the sizes
// the gameplay camera actually produces. This is the acceptance evidence for the
// minimal sprite language.
//   node scripts/design/render-sprite-sheet.mjs
import { writeFileSync } from "node:fs";
import { encodePng } from "./png.mjs";
import { FONT } from "./glyphs.mjs";
import {
  ENTITY_SPRITE_ROLES,
  composeEntitySprite,
  normalizeEntitySpriteState,
} from "../../packages/runtime/src/render/entity-sprite-composer.js";
import { AFFINITY_KINDS } from "../../packages/runtime/src/contracts/domain-constants.js";
import { GAME_COLOR_PALETTE } from "../../packages/runtime/src/contracts/game-elements.js";

const SIZES = [32, 16, 12];
const FLOOR = [1, 3, 5].map((i) => parseInt(GAME_COLOR_PALETTE.tiles.floor.slice(i, i + 2), 16)), BG = [21, 24, 28], INK = [232, 236, 240], DIM = [138, 148, 158];
const COLW = 150, ROWH = 44, LEFT = 96, TOP = 84;
const W = LEFT + ENTITY_SPRITE_ROLES.length * COLW + 24;
const H = TOP + AFFINITY_KINDS.length * ROWH + 40;
const buf = Buffer.alloc(W * H * 4);
const put = (x, y, c) => { if (x < 0 || y < 0 || x >= W || y >= H) return; const i = (y * W + x) * 4; buf[i] = c[0]; buf[i+1] = c[1]; buf[i+2] = c[2]; buf[i+3] = 255; };
const rect = (x, y, w, h, c) => { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) put(x + i, y + j, c); };
function text(s, x, y, c, sc = 1) {
  let cx = x;
  for (const ch of String(s).toUpperCase()) {
    const g = FONT[ch] || FONT[" "];
    for (let r = 0; r < 7; r++) for (let q = 0; q < 5; q++) if (g[r][q]) rect(cx + q * sc, y + r * sc, sc, sc, c);
    cx += 6 * sc;
  }
}
rect(0, 0, W, H, BG);
text("MINIMAL SPRITE LANGUAGE - ROLE x AFFINITY", 20, 20, INK, 2);
text("SILHOUETTE = ROLE, FILL = AFFINITY. 12PX IS THE CAMERA FLOOR. BOARD = CANONICAL FLOOR TILE.", 20, 42, DIM, 1);
rect(LEFT - 12, TOP - 20, ENTITY_SPRITE_ROLES.length * COLW + 8, AFFINITY_KINDS.length * ROWH + 24, FLOOR);
ENTITY_SPRITE_ROLES.forEach((role, c) => {
  text(role, LEFT + c * COLW, TOP - 34, INK, 1);
  text("32   16  12", LEFT + c * COLW, TOP - 24, DIM, 1);
});
AFFINITY_KINDS.forEach((affinity, r) => {
  const y = TOP + r * ROWH;
  text(affinity, 16, y + 14, INK, 1);
  ENTITY_SPRITE_ROLES.forEach((role, c) => {
    let ox = LEFT + c * COLW;
    for (const size of SIZES) {
      const px = composeEntitySprite({ state: normalizeEntitySpriteState({ role, affinity }), size });
      const oy = y + (36 - size) / 2;
      for (let sy = 0; sy < size; sy++) for (let sx = 0; sx < size; sx++) {
        const i = (sy * size + sx) * 4;
        if (px[i + 3] === 0) continue;
        put(Math.round(ox + sx), Math.round(oy + sy), [px[i], px[i+1], px[i+2]]);
      }
      ox += size + 10;
    }
  });
});
writeFileSync(new URL("../../docs/design/entity-sprite-sheet.png", import.meta.url), encodePng(W, H, buf));
console.log(`wrote docs/design/entity-sprite-sheet.png (${W}x${H})`);
