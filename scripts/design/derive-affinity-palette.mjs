import { oklchToSrgb, inGamut, toHex, dE76, dE2000 } from "./color.mjs";
const FLOOR = "#3a3a3a";
// Deterministic PRNG: the palette is a committed constant, so the derivation
// that produced it must be reproducible. Re-running this script on the same
// seed must reproduce docs/design/affinity-palette-2026-09.json byte for byte.
const SEED = Number(process.env.PALETTE_SEED ?? 20260902);
let _s = SEED >>> 0;
function rand() {
  _s ^= _s << 13; _s >>>= 0; _s ^= _s >> 17; _s ^= _s << 5; _s >>>= 0;
  return _s / 4294967296;
}

// Opposites are a domain fact (AFFINITY_OPPOSITES). The palette should make them
// visually opposite too, on three different axes:
//   hue      : fire/water, earth/wind, life/decay
//   chroma   : corrode (saturated) / fortify (neutral)
//   lightness: light (near-white) / dark (charcoal)
const OPPOSITES = [["fire","water"],["earth","wind"],["life","decay"],["corrode","fortify"],["light","dark"]];
const BOX = [
  ["fire",     30,  48, 0.58, 0.72, 0.15, 0.22],
  ["water",   242, 268, 0.46, 0.64, 0.13, 0.21],
  ["earth",    62,  88, 0.44, 0.62, 0.05, 0.12],
  ["wind",    186, 214, 0.70, 0.88, 0.07, 0.15],
  ["life",    140, 166, 0.60, 0.80, 0.13, 0.21],
  ["decay",   316, 344, 0.42, 0.60, 0.09, 0.18],
  ["corrode", 106, 130, 0.70, 0.88, 0.13, 0.20],
  ["fortify", 228, 284, 0.60, 0.76, 0.004, 0.030],
  ["light",    92, 118, 0.90, 0.985, 0.00, 0.055],
  ["dark",    288, 322, 0.26, 0.44, 0.02, 0.09],
];
const NAMES = BOX.map((b) => b[0]);
const FLOOR_MIN = 20;
function build(p) {
  const out = {};
  for (let i = 0; i < BOX.length; i += 1) {
    const rgb = oklchToSrgb(p[i].L, p[i].C, p[i].h);
    if (!inGamut(rgb)) return null;
    out[BOX[i][0]] = toHex(rgb);
  }
  return out;
}
function score(pal) {
  let minPair = Infinity, minFloor = Infinity;
  for (let i = 0; i < NAMES.length; i += 1) {
    minFloor = Math.min(minFloor, dE76(pal[NAMES[i]], FLOOR));
    for (let j = i + 1; j < NAMES.length; j += 1) minPair = Math.min(minPair, dE76(pal[NAMES[i]], pal[NAMES[j]]));
  }
  const oppMin = Math.min(...OPPOSITES.map(([a, b]) => dE76(pal[a], pal[b])));
  return { fitness: minPair + 0.35 * oppMin + Math.min(0, minFloor - FLOOR_MIN) * 60, minPair, minFloor, oppMin };
}
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
let best = null, bestS = null;
for (let r = 0; r < 28; r += 1) {
  let cur = BOX.map(([, hl, hh, Ll, Lh, Cl, Ch]) => ({ h: hl + rand() * (hh - hl), L: Ll + rand() * (Lh - Ll), C: Cl + rand() * (Ch - Cl) }));
  let pal = build(cur); if (!pal) { r -= 1; continue; }
  let s = score(pal);
  const N = 26000;
  for (let it = 0; it < N; it += 1) {
    const T = 1.4 * (1 - it / N);
    const nx = cur.map((o) => ({ ...o }));
    const i = Math.floor(rand() * nx.length);
    const [, hl, hh, Ll, Lh, Cl, Ch] = BOX[i];
    nx[i].h = clamp(nx[i].h + (rand() - 0.5) * 14, hl, hh);
    nx[i].L = clamp(nx[i].L + (rand() - 0.5) * 0.10, Ll, Lh);
    nx[i].C = clamp(nx[i].C + (rand() - 0.5) * 0.05, Cl, Ch);
    const np = build(nx); if (!np) continue;
    const ns = score(np);
    if (ns.fitness > s.fitness || rand() < Math.exp((ns.fitness - s.fitness) / Math.max(T, 0.01))) { cur = nx; s = ns; pal = np; }
    if (!bestS || s.fitness > bestS.fitness) { best = pal; bestS = s; }
  }
}
const ordered = {};
for (const n of ["fire","water","earth","wind","life","decay","corrode","fortify","light","dark"]) ordered[n] = best[n];
console.log(JSON.stringify(ordered, null, 1));
const pairs = [];
for (let i = 0; i < NAMES.length; i += 1) for (let j = i + 1; j < NAMES.length; j += 1) pairs.push([NAMES[i], NAMES[j], dE76(best[NAMES[i]], best[NAMES[j]]), dE2000(best[NAMES[i]], best[NAMES[j]])]);
pairs.sort((a, b) => a[2] - b[2]);
console.log(`\nminPair dE76 = ${bestS.minPair.toFixed(1)}   minFloor = ${bestS.minFloor.toFixed(1)}   worst opposite pair = ${bestS.oppMin.toFixed(1)}`);
console.log("\ntightest 5 of 45 pairs (dE76 / dE2000):");
pairs.slice(0, 5).forEach((p) => console.log(`  ${p[0].padEnd(9)}${p[1].padEnd(9)} ${p[2].toFixed(1).padStart(5)} / ${p[3].toFixed(1)}`));
console.log("\nopposites (should be far apart):");
OPPOSITES.forEach(([a, b]) => console.log(`  ${a.padEnd(9)}${b.padEnd(9)} ${dE76(best[a], best[b]).toFixed(1)}`));
console.log("\nvs floor #3a3a3a:");
NAMES.map((x) => [x, dE76(best[x], FLOOR)]).sort((a, b) => a[1] - b[1]).forEach((p) => console.log(`  ${p[0].padEnd(9)} ${p[1].toFixed(1)}`));
import { writeFileSync } from "node:fs";
writeFileSync(new URL("../../docs/design/affinity-palette-2026-09.json", import.meta.url), JSON.stringify(ordered, null, 2));
