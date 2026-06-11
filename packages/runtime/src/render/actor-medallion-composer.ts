import { AFFINITY_COLOR_HEX, hexToRgba } from "./affinity-palette.js";

export const ACTOR_MEDALLION_CANONICAL_SIZE = 64;
export const ACTOR_MEDALLION_EXPRESSION_STYLE = "triangles";

export const ACTOR_MEDALLION_COMPONENT_IDS = Object.freeze({
  frame: "component.actor-medallion.frame",
  actors: Object.freeze({
    delver: "component.actor-medallion.actor.delver",
    warden: "component.actor-medallion.actor.warden",
  }),
  vitals: Object.freeze({
    durability: "component.actor-medallion.vital.durability",
    health: "component.actor-medallion.vital.health",
    stamina: "component.actor-medallion.vital.stamina",
    mana: "component.actor-medallion.vital.mana",
  }),
  expressions: Object.freeze({
    push: "component.actor-medallion.expression.push",
    pull: "component.actor-medallion.expression.pull",
    emit: "component.actor-medallion.expression.emit",
    draw: "component.actor-medallion.expression.draw",
  }),
  affinities: Object.freeze(
    Object.fromEntries(
      Object.keys(AFFINITY_COLOR_HEX).map((kind) => [kind, `component.actor-medallion.affinity.${kind}`]),
    ),
  ),
  motivations: Object.freeze(
    [
      "random",
      "stationary",
      "exploring",
      "patrolling",
      "attacking",
      "defending",
      "stealthy",
      "friendly",
      "reflexive",
      "goal_oriented",
      "strategy_focused",
      "user_controlled",
    ].reduce<Record<string, string>>((acc, kind) => {
      acc[kind] = `component.actor-medallion.motivation.${kind}`;
      return acc;
    }, {}),
  ),
});

export const ACTOR_MEDALLION_BRIGHT_VITAL_COLORS = Object.freeze({
  durability: "#ffa412",
  health: "#ff3030",
  stamina: "#4cff28",
  mana: "#269cff",
});

type Rgba = readonly [number, number, number, number];
type MutableRgba = [number, number, number, number];
type VitalKey = keyof typeof ACTOR_MEDALLION_BRIGHT_VITAL_COLORS;

export type ActorMedallionRole = "delver" | "warden";
export type ActorMedallionExpression = "push" | "pull" | "emit" | "draw";

export interface ActorMedallionVitalState {
  current: number;
  max: number;
  fraction: number;
}

export interface ActorMedallionState {
  role: ActorMedallionRole;
  affinity: string;
  expression: ActorMedallionExpression;
  motivation: string;
  vitals: Record<VitalKey, ActorMedallionVitalState>;
}

export interface ActorMedallionComponentAtlas {
  frame?: Uint8ClampedArray;
  actors?: Partial<Record<ActorMedallionRole, Uint8ClampedArray>>;
  affinities?: Record<string, Uint8ClampedArray>;
  expressions?: Partial<Record<ActorMedallionExpression, Uint8ClampedArray>>;
  motivations?: Record<string, Uint8ClampedArray>;
}

export interface ComposeActorMedallionInput {
  actor?: unknown;
  state?: Partial<ActorMedallionState>;
  componentAtlas?: ActorMedallionComponentAtlas;
  size?: number;
}

const FRAME = Object.freeze({
  background: hexToRgba("#101316", 255),
  backgroundAlt: hexToRgba("#171b1f", 255),
  inner: hexToRgba("#24282a", 255),
  groove: hexToRgba("#080a0c", 255),
  stone: hexToRgba("#665d52", 255),
  stoneLight: hexToRgba("#9b9081", 255),
  actor: hexToRgba("#b6ad9d", 255),
  actorShadow: hexToRgba("#14100d", 230),
  white: hexToRgba("#f8fcff", 225),
  whiteShadow: hexToRgba("#141b24", 210),
  black: hexToRgba("#050607", 255),
});

function clampByte(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 1));
}

function rgba(hex: string, alpha = 255): MutableRgba {
  return hexToRgba(hex, alpha) as MutableRgba;
}

function createPixelBuffer(width: number, height: number): Uint8ClampedArray {
  return new Uint8ClampedArray(width * height * 4);
}

function idx(width: number, x: number, y: number): number {
  return (y * width + x) * 4;
}

function setPixel(pixels: Uint8ClampedArray, width: number, x: number, y: number, color: Rgba): void {
  if (x < 0 || y < 0 || x >= width || y >= pixels.length / 4 / width) return;
  const index = idx(width, x, y);
  pixels[index] = color[0];
  pixels[index + 1] = color[1];
  pixels[index + 2] = color[2];
  pixels[index + 3] = color[3];
}

function blendPixel(pixels: Uint8ClampedArray, width: number, x: number, y: number, color: Rgba): void {
  if (x < 0 || y < 0 || x >= width || y >= pixels.length / 4 / width) return;
  const index = idx(width, x, y);
  const srcA = color[3] / 255;
  const dstA = pixels[index + 3] / 255;
  const outA = srcA + dstA * (1 - srcA);
  if (outA <= 0) return;
  pixels[index] = clampByte((color[0] * srcA + pixels[index] * dstA * (1 - srcA)) / outA);
  pixels[index + 1] = clampByte((color[1] * srcA + pixels[index + 1] * dstA * (1 - srcA)) / outA);
  pixels[index + 2] = clampByte((color[2] * srcA + pixels[index + 2] * dstA * (1 - srcA)) / outA);
  pixels[index + 3] = clampByte(outA * 255);
}

function fillRect(
  pixels: Uint8ClampedArray,
  width: number,
  x: number,
  y: number,
  rectWidth: number,
  rectHeight: number,
  color: Rgba,
): void {
  for (let yy = 0; yy < rectHeight; yy += 1) {
    for (let xx = 0; xx < rectWidth; xx += 1) {
      blendPixel(pixels, width, x + xx, y + yy, color);
    }
  }
}

function drawLine(
  pixels: Uint8ClampedArray,
  width: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  color: Rgba,
  thickness = 1,
): void {
  const radius = Math.max(0, Math.floor((thickness - 1) / 2));
  let dx = Math.abs(x1 - x0);
  const sx = x0 < x1 ? 1 : -1;
  let dy = -Math.abs(y1 - y0);
  const sy = y0 < y1 ? 1 : -1;
  let error = dx + dy;
  while (true) {
    for (let oy = -radius; oy <= radius; oy += 1) {
      for (let ox = -radius; ox <= radius; ox += 1) {
        blendPixel(pixels, width, x0 + ox, y0 + oy, color);
      }
    }
    if (x0 === x1 && y0 === y1) break;
    const next = 2 * error;
    if (next >= dy) {
      if (x0 === x1) break;
      error += dy;
      x0 += sx;
    }
    if (next <= dx) {
      if (y0 === y1) break;
      error += dx;
      y0 += sy;
    }
  }
}

function fillCircle(pixels: Uint8ClampedArray, width: number, cx: number, cy: number, radius: number, color: Rgba): void {
  for (let y = -radius; y <= radius; y += 1) {
    for (let x = -radius; x <= radius; x += 1) {
      if (x * x + y * y <= radius * radius) {
        blendPixel(pixels, width, cx + x, cy + y, color);
      }
    }
  }
}

function drawRing(
  pixels: Uint8ClampedArray,
  width: number,
  cx: number,
  cy: number,
  outerRadius: number,
  innerRadius: number,
  color: Rgba,
): void {
  for (let y = -outerRadius; y <= outerRadius; y += 1) {
    for (let x = -outerRadius; x <= outerRadius; x += 1) {
      const dist = x * x + y * y;
      if (dist <= outerRadius * outerRadius && dist >= innerRadius * innerRadius) {
        blendPixel(pixels, width, cx + x, cy + y, color);
      }
    }
  }
}

function fillTriangle(
  pixels: Uint8ClampedArray,
  width: number,
  p0: [number, number],
  p1: [number, number],
  p2: [number, number],
  color: Rgba,
): void {
  const minX = Math.floor(Math.min(p0[0], p1[0], p2[0]));
  const maxX = Math.ceil(Math.max(p0[0], p1[0], p2[0]));
  const minY = Math.floor(Math.min(p0[1], p1[1], p2[1]));
  const maxY = Math.ceil(Math.max(p0[1], p1[1], p2[1]));
  const area = (p1[1] - p2[1]) * (p0[0] - p2[0]) + (p2[0] - p1[0]) * (p0[1] - p2[1]);
  if (area === 0) return;
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const a = ((p1[1] - p2[1]) * (x - p2[0]) + (p2[0] - p1[0]) * (y - p2[1])) / area;
      const b = ((p2[1] - p0[1]) * (x - p2[0]) + (p0[0] - p2[0]) * (y - p2[1])) / area;
      const c = 1 - a - b;
      if (a >= 0 && b >= 0 && c >= 0) {
        blendPixel(pixels, width, x, y, color);
      }
    }
  }
}

function scalePoint(point: [number, number], scale: number): [number, number] {
  return [Math.round(point[0] * scale), Math.round(point[1] * scale)];
}

function blitScaled(
  target: Uint8ClampedArray,
  targetSize: number,
  source: Uint8ClampedArray,
  sourceSize: number,
  destX: number,
  destY: number,
  destSize: number,
  opacity = 1,
): void {
  const alphaScale = clamp01(opacity);
  if (alphaScale <= 0 || source.length !== sourceSize * sourceSize * 4) return;
  for (let y = 0; y < destSize; y += 1) {
    for (let x = 0; x < destSize; x += 1) {
      const sx = Math.min(sourceSize - 1, Math.floor((x / destSize) * sourceSize));
      const sy = Math.min(sourceSize - 1, Math.floor((y / destSize) * sourceSize));
      const sourceIndex = idx(sourceSize, sx, sy);
      const alpha = Math.round(source[sourceIndex + 3] * alphaScale);
      if (alpha <= 0) continue;
      blendPixel(target, targetSize, destX + x, destY + y, [
        source[sourceIndex],
        source[sourceIndex + 1],
        source[sourceIndex + 2],
        alpha,
      ]);
    }
  }
}

function drawFrame(pixels: Uint8ClampedArray, size: number): void {
  fillRect(pixels, size, 0, 0, size, size, FRAME.background);
  const cell = Math.max(2, Math.round(size / 8));
  for (let y = 0; y < size; y += cell) {
    for (let x = 0; x < size; x += cell) {
      if (((x / cell) + (y / cell)) % 2 === 0) {
        fillRect(pixels, size, x, y, cell, cell, FRAME.backgroundAlt);
      }
    }
  }
  const s = size / 64;
  fillRect(pixels, size, Math.round(7 * s), Math.round(7 * s), Math.round(50 * s), Math.round(50 * s), FRAME.inner);
  for (const line of [22, 40]) {
    drawLine(pixels, size, Math.round(8 * s), Math.round(line * s), Math.round(56 * s), Math.round(line * s), FRAME.groove);
    drawLine(pixels, size, Math.round(line * s), Math.round(8 * s), Math.round(line * s), Math.round(56 * s), FRAME.groove);
  }
  drawLine(pixels, size, 0, 0, size - 1, 0, FRAME.black, Math.max(1, Math.round(2 * s)));
  drawLine(pixels, size, 0, size - 1, size - 1, size - 1, FRAME.black, Math.max(1, Math.round(2 * s)));
  drawLine(pixels, size, 0, 0, 0, size - 1, FRAME.black, Math.max(1, Math.round(2 * s)));
  drawLine(pixels, size, size - 1, 0, size - 1, size - 1, FRAME.black, Math.max(1, Math.round(2 * s)));
}

function vitalFractionFromValue(value: unknown): ActorMedallionVitalState {
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const max = Number(record.max ?? record.maximum ?? record.total ?? 1);
    const current = Number(record.current ?? record.value ?? record.remaining ?? max);
    const safeMax = Number.isFinite(max) && max > 0 ? max : 1;
    const safeCurrent = Number.isFinite(current) ? current : safeMax;
    return { current: safeCurrent, max: safeMax, fraction: clamp01(safeCurrent / safeMax) };
  }
  if (typeof value === "number") {
    const fraction = value > 1 ? clamp01(value / 100) : clamp01(value);
    return { current: fraction, max: 1, fraction };
  }
  return { current: 1, max: 1, fraction: 1 };
}

function actorRecord(actor: unknown): Record<string, unknown> {
  return actor && typeof actor === "object" ? actor as Record<string, unknown> : {};
}

function vitalFor(actor: unknown, key: VitalKey): ActorMedallionVitalState {
  const record = actorRecord(actor);
  const traits = actorRecord(record.traits);
  const vitals = actorRecord(record.vitals);
  const traitVitals = actorRecord(traits.vitals);
  return vitalFractionFromValue(vitals[key] ?? traitVitals[key] ?? record[key]);
}

function drawVitalBars(pixels: Uint8ClampedArray, size: number, vitals: Record<VitalKey, ActorMedallionVitalState>): void {
  const thickness = Math.max(2, Math.round(size * 0.078));
  const track = rgba("#060708", 230);
  const drawHorizontal = (y: number, fraction: number, color: Rgba) => {
    fillRect(pixels, size, 0, y, size, thickness, track);
    fillRect(pixels, size, 0, y, Math.max(1, Math.round(size * fraction)), thickness, color);
  };
  const drawVertical = (x: number, fraction: number, color: Rgba) => {
    fillRect(pixels, size, x, 0, thickness, size, track);
    const fill = Math.max(1, Math.round(size * fraction));
    fillRect(pixels, size, x, size - fill, thickness, fill, color);
  };
  drawHorizontal(0, vitals.durability.fraction, rgba(ACTOR_MEDALLION_BRIGHT_VITAL_COLORS.durability));
  drawVertical(size - thickness, vitals.health.fraction, rgba(ACTOR_MEDALLION_BRIGHT_VITAL_COLORS.health));
  drawHorizontal(size - thickness, vitals.stamina.fraction, rgba(ACTOR_MEDALLION_BRIGHT_VITAL_COLORS.stamina));
  drawVertical(0, vitals.mana.fraction, rgba(ACTOR_MEDALLION_BRIGHT_VITAL_COLORS.mana));
}

function inferActorRole(actor: unknown): ActorMedallionRole {
  const record = actorRecord(actor);
  const raw = `${record.role || ""} ${record.kind || ""} ${record.id || ""}`.toLowerCase();
  return raw.includes("warden") ? "warden" : "delver";
}

function normalizeKey(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function firstAffinityEntry(actor: unknown): { kind: string; expression: ActorMedallionExpression } {
  const record = actorRecord(actor);
  const affinities = Array.isArray(record.affinities) ? record.affinities : [];
  for (const rawEntry of affinities) {
    const entry = actorRecord(rawEntry);
    const kind = normalizeKey(entry.kind);
    if (!kind) continue;
    const expression = normalizeExpression(entry.expression);
    return { kind, expression };
  }
  const traits = actorRecord(record.traits);
  const traitAffinities = actorRecord(traits.affinities);
  for (const [rawKey] of Object.entries(traitAffinities)) {
    const [kindPart, expressionPart] = rawKey.split(":");
    const kind = normalizeKey(kindPart);
    if (!kind) continue;
    return { kind, expression: normalizeExpression(expressionPart) };
  }
  const affinity = normalizeKey(record.affinity);
  if (affinity) {
    return { kind: affinity, expression: normalizeExpression(record.expression) };
  }
  return { kind: "", expression: "emit" };
}

function normalizeExpression(value: unknown): ActorMedallionExpression {
  const key = normalizeKey(value);
  return key === "push" || key === "pull" || key === "draw" || key === "emit" ? key : "emit";
}

function inferMotivation(actor: unknown): string {
  const record = actorRecord(actor);
  const traits = actorRecord(record.traits);
  return normalizeKey(record.motivation) || normalizeKey(traits.motivation);
}

export function normalizeActorMedallionState(actor: unknown = {}, override: Partial<ActorMedallionState> = {}): ActorMedallionState {
  const affinity = firstAffinityEntry(actor);
  return {
    role: override.role || inferActorRole(actor),
    affinity: override.affinity ?? affinity.kind,
    expression: override.expression || affinity.expression,
    motivation: override.motivation ?? inferMotivation(actor),
    vitals: {
      durability: override.vitals?.durability || vitalFor(actor, "durability"),
      health: override.vitals?.health || vitalFor(actor, "health"),
      stamina: override.vitals?.stamina || vitalFor(actor, "stamina"),
      mana: override.vitals?.mana || vitalFor(actor, "mana"),
    },
  };
}

function drawActorGlyph(pixels: Uint8ClampedArray, size: number, role: ActorMedallionRole): void {
  const s = size / 64;
  const cx = Math.round(32 * s);
  const cy = Math.round(32 * s);
  const thickness = Math.max(2, Math.round(4 * s));
  if (role === "warden") {
    const outer = ([
      [32, 13],
      [13, 49],
      [51, 49],
    ] as Array<[number, number]>).map((point) => scalePoint(point, s));
    drawLine(pixels, size, outer[0][0] + 1, outer[0][1] + 1, outer[1][0] + 1, outer[1][1] + 1, FRAME.actorShadow, thickness + 2);
    drawLine(pixels, size, outer[1][0] + 1, outer[1][1] + 1, outer[2][0] + 1, outer[2][1] + 1, FRAME.actorShadow, thickness + 2);
    drawLine(pixels, size, outer[2][0] + 1, outer[2][1] + 1, outer[0][0] + 1, outer[0][1] + 1, FRAME.actorShadow, thickness + 2);
    drawLine(pixels, size, outer[0][0], outer[0][1], outer[1][0], outer[1][1], FRAME.actor, thickness);
    drawLine(pixels, size, outer[1][0], outer[1][1], outer[2][0], outer[2][1], FRAME.actor, thickness);
    drawLine(pixels, size, outer[2][0], outer[2][1], outer[0][0], outer[0][1], FRAME.actor, thickness);
    return;
  }
  drawRing(pixels, size, cx + 1, cy + 1, Math.round(18 * s), Math.round(12 * s), FRAME.actorShadow);
  drawRing(pixels, size, cx, cy, Math.round(18 * s), Math.round(12 * s), FRAME.actor);
  drawRing(pixels, size, cx, cy, Math.round(12 * s), Math.round(10 * s), rgba("#3b3430", 190));
}

function drawExpressionTriangles(pixels: Uint8ClampedArray, size: number, expression: ActorMedallionExpression): void {
  const layouts: Record<ActorMedallionExpression, Array<[[number, number], [number, number], [number, number]]>> = {
    push: [
      [[10, 5], [4, 2], [4, 8]],
      [[62, 5], [56, 2], [56, 8]],
      [[10, 59], [4, 56], [4, 62]],
      [[62, 59], [56, 56], [56, 62]],
    ],
    pull: [
      [[1, 5], [7, 2], [7, 8]],
      [[53, 5], [59, 2], [59, 8]],
      [[1, 59], [7, 56], [7, 62]],
      [[53, 59], [59, 56], [59, 62]],
    ],
    emit: [
      [[0, 0], [7, 2], [2, 7]],
      [[63, 0], [56, 2], [61, 7]],
      [[0, 63], [2, 56], [7, 61]],
      [[63, 63], [61, 56], [56, 61]],
    ],
    draw: [
      [[9, 9], [2, 5], [5, 2]],
      [[54, 9], [59, 2], [62, 5]],
      [[9, 54], [2, 59], [5, 62]],
      [[54, 54], [62, 59], [59, 62]],
    ],
  };
  const s = size / 64;
  for (const triangle of layouts[expression]) {
    const shadow = triangle.map((point) => scalePoint([point[0] + 1, point[1] + 1], s)) as [[number, number], [number, number], [number, number]];
    const foreground = triangle.map((point) => scalePoint(point, s)) as [[number, number], [number, number], [number, number]];
    fillTriangle(pixels, size, shadow[0], shadow[1], shadow[2], FRAME.whiteShadow);
    fillTriangle(pixels, size, foreground[0], foreground[1], foreground[2], FRAME.white);
  }
}

function drawAffinityGlyph(pixels: Uint8ClampedArray, size: number, state: ActorMedallionState): void {
  if (!state.affinity) return;
  const color = rgba(AFFINITY_COLOR_HEX[state.affinity] || "#ffffff");
  const glow = [color[0], color[1], color[2], 70] as const;
  const s = size / 64;
  const cx = Math.round(32 * s);
  const cy = Math.round((state.role === "warden" ? 36 : 32) * s);
  const radius = Math.max(3, Math.round(7 * s));
  drawRing(pixels, size, cx, cy, Math.round(11 * s), Math.round(9 * s), rgba("#08090a", 210));
  fillCircle(pixels, size, cx, cy, Math.round(10 * s), glow);
  switch (state.affinity) {
    case "fire":
      fillTriangle(pixels, size, [cx, cy - radius - 2], [cx - radius, cy + radius], [cx + radius, cy + radius], color);
      fillCircle(pixels, size, cx, cy + Math.round(3 * s), Math.round(4 * s), rgba("#ffe289", 230));
      break;
    case "water":
      fillCircle(pixels, size, cx, cy + Math.round(2 * s), radius, color);
      fillTriangle(pixels, size, [cx, cy - radius - 3], [cx - radius, cy + 1], [cx + radius, cy + 1], color);
      drawLine(pixels, size, cx - radius, cy + radius + 2, cx + radius, cy + radius, rgba("#bde7ff", 220), Math.max(1, Math.round(2 * s)));
      break;
    case "earth":
      fillTriangle(pixels, size, [cx, cy - radius], [cx - radius, cy], [cx, cy + radius], color);
      fillTriangle(pixels, size, [cx, cy - radius], [cx + radius, cy], [cx, cy + radius], color);
      drawLine(pixels, size, cx - radius, cy, cx + radius, cy, rgba("#e4c68f", 200), Math.max(1, Math.round(2 * s)));
      break;
    case "wind":
      drawLine(pixels, size, cx - radius - 2, cy - 4, cx + radius + 1, cy - 4, color, Math.max(1, Math.round(2 * s)));
      drawLine(pixels, size, cx - radius, cy + 1, cx + radius + 3, cy + 1, rgba("#c9f1ff", 220), Math.max(1, Math.round(2 * s)));
      drawLine(pixels, size, cx - 2, cy + 6, cx + radius, cy + 6, color, Math.max(1, Math.round(2 * s)));
      break;
    case "life":
      fillCircle(pixels, size, cx - Math.round(3 * s), cy, radius - 1, color);
      fillCircle(pixels, size, cx + Math.round(4 * s), cy - Math.round(2 * s), radius - 2, rgba("#9ef0a6", 230));
      drawLine(pixels, size, cx, cy + radius, cx + Math.round(6 * s), cy - radius, rgba("#f3ffe0", 210), Math.max(1, Math.round(2 * s)));
      break;
    case "decay":
      drawRing(pixels, size, cx, cy, radius + 2, radius - 2, color);
      drawLine(pixels, size, cx - radius, cy + radius, cx + radius, cy - radius, rgba("#d8dda3", 220), Math.max(1, Math.round(2 * s)));
      break;
    case "corrode":
      fillCircle(pixels, size, cx, cy, radius, color);
      drawLine(pixels, size, cx - radius, cy - 2, cx + radius, cy + 3, rgba("#e6ff7a", 230), Math.max(1, Math.round(2 * s)));
      drawLine(pixels, size, cx - 3, cy + radius, cx + 2, cy - radius, rgba("#355b1d", 190), Math.max(1, Math.round(2 * s)));
      break;
    case "fortify":
      fillTriangle(pixels, size, [cx, cy - radius], [cx - radius, cy - 2], [cx, cy + radius + 2], color);
      fillTriangle(pixels, size, [cx, cy - radius], [cx + radius, cy - 2], [cx, cy + radius + 2], color);
      drawLine(pixels, size, cx - radius, cy - 2, cx + radius, cy - 2, rgba("#d9cdfd", 220), Math.max(1, Math.round(2 * s)));
      break;
    case "light":
      drawLine(pixels, size, cx, cy - radius - 2, cx, cy + radius + 2, color, Math.max(1, Math.round(2 * s)));
      drawLine(pixels, size, cx - radius - 2, cy, cx + radius + 2, cy, color, Math.max(1, Math.round(2 * s)));
      drawLine(pixels, size, cx - radius, cy - radius, cx + radius, cy + radius, rgba("#fff6c0", 220), Math.max(1, Math.round(2 * s)));
      drawLine(pixels, size, cx + radius, cy - radius, cx - radius, cy + radius, rgba("#fff6c0", 220), Math.max(1, Math.round(2 * s)));
      break;
    case "dark":
      fillCircle(pixels, size, cx, cy, radius + 2, color);
      fillCircle(pixels, size, cx + Math.round(4 * s), cy - Math.round(2 * s), radius + 1, rgba("#101316", 255));
      break;
    default:
      fillCircle(pixels, size, cx, cy, radius, color);
      break;
  }
}

function drawMotivationGlyph(pixels: Uint8ClampedArray, size: number, motivation: string): void {
  if (!motivation) return;
  const s = size / 64;
  const x = Math.round(49 * s);
  const y = Math.round(49 * s);
  const color = rgba("#f2e7c8", 215);
  const accent = rgba("#11161b", 190);
  const r = Math.max(2, Math.round(4 * s));
  fillRect(pixels, size, x - r, y - r, r * 2 + 1, r * 2 + 1, accent);
  if (motivation.includes("defend") || motivation.includes("stationary")) {
    drawRing(pixels, size, x, y, r, Math.max(1, r - 2), color);
  } else if (motivation.includes("attack")) {
    drawLine(pixels, size, x - r, y + r, x + r, y - r, color, Math.max(1, Math.round(2 * s)));
    drawLine(pixels, size, x + r, y - r, x + r - Math.round(3 * s), y - r, color);
    drawLine(pixels, size, x + r, y - r, x + r, y - r + Math.round(3 * s), color);
  } else if (motivation.includes("explor") || motivation.includes("patrol")) {
    drawLine(pixels, size, x - r, y, x + r, y, color, Math.max(1, Math.round(2 * s)));
    drawLine(pixels, size, x, y - r, x, y + r, color, Math.max(1, Math.round(2 * s)));
  } else {
    fillCircle(pixels, size, x, y, Math.max(1, Math.round(2 * s)), color);
  }
}

export function composeActorMedallion({
  actor = {},
  state,
  componentAtlas,
  size = ACTOR_MEDALLION_CANONICAL_SIZE,
}: ComposeActorMedallionInput = {}): Uint8ClampedArray {
  const resolvedSize = Math.max(8, Math.round(Number(size) || ACTOR_MEDALLION_CANONICAL_SIZE));
  const resolved = normalizeActorMedallionState(actor, state || {});
  const pixels = createPixelBuffer(resolvedSize, resolvedSize);
  const atlasSize = ACTOR_MEDALLION_CANONICAL_SIZE;

  if (componentAtlas?.frame) {
    blitScaled(pixels, resolvedSize, componentAtlas.frame, atlasSize, 0, 0, resolvedSize);
  } else {
    drawFrame(pixels, resolvedSize);
  }
  drawVitalBars(pixels, resolvedSize, resolved.vitals);

  const actorLayer = componentAtlas?.actors?.[resolved.role];
  if (actorLayer) {
    blitScaled(pixels, resolvedSize, actorLayer, atlasSize, 0, 0, resolvedSize);
  } else {
    drawActorGlyph(pixels, resolvedSize, resolved.role);
  }

  const expressionLayer = componentAtlas?.expressions?.[resolved.expression];
  if (expressionLayer) {
    blitScaled(pixels, resolvedSize, expressionLayer, atlasSize, 0, 0, resolvedSize);
  } else {
    drawExpressionTriangles(pixels, resolvedSize, resolved.expression);
  }

  const affinityLayer = resolved.affinity ? componentAtlas?.affinities?.[resolved.affinity] : null;
  if (affinityLayer) {
    const glyphSize = Math.max(8, Math.round(resolvedSize * 0.36));
    const centerY = Math.round((resolved.role === "warden" ? 36 : 32) * (resolvedSize / 64));
    blitScaled(
      pixels,
      resolvedSize,
      affinityLayer,
      atlasSize,
      Math.round(resolvedSize / 2 - glyphSize / 2),
      Math.round(centerY - glyphSize / 2),
      glyphSize,
    );
  } else {
    drawAffinityGlyph(pixels, resolvedSize, resolved);
  }

  const motivationLayer = resolved.motivation ? componentAtlas?.motivations?.[resolved.motivation] : null;
  if (motivationLayer) {
    blitScaled(pixels, resolvedSize, motivationLayer, atlasSize, 0, 0, resolvedSize);
  } else {
    drawMotivationGlyph(pixels, resolvedSize, resolved.motivation);
  }
  return pixels;
}

export function buildActorMedallionComponentSprite(assetId: string, size = ACTOR_MEDALLION_CANONICAL_SIZE): Uint8ClampedArray {
  const resolvedSize = Math.max(8, Math.round(Number(size) || ACTOR_MEDALLION_CANONICAL_SIZE));
  const pixels = createPixelBuffer(resolvedSize, resolvedSize);
  const id = String(assetId || "");
  if (id === ACTOR_MEDALLION_COMPONENT_IDS.frame) {
    drawFrame(pixels, resolvedSize);
    return pixels;
  }
  if (id.startsWith("component.actor-medallion.actor.")) {
    drawActorGlyph(pixels, resolvedSize, id.endsWith(".warden") ? "warden" : "delver");
    return pixels;
  }
  if (id.startsWith("component.actor-medallion.vital.")) {
    const key = id.slice("component.actor-medallion.vital.".length) as VitalKey;
    const fullVitals = {
      durability: { current: 0, max: 1, fraction: 0 },
      health: { current: 0, max: 1, fraction: 0 },
      stamina: { current: 0, max: 1, fraction: 0 },
      mana: { current: 0, max: 1, fraction: 0 },
    };
    if (key in fullVitals) fullVitals[key] = { current: 1, max: 1, fraction: 1 };
    drawVitalBars(pixels, resolvedSize, fullVitals);
    return pixels;
  }
  if (id.startsWith("component.actor-medallion.expression.")) {
    drawExpressionTriangles(pixels, resolvedSize, normalizeExpression(id.slice("component.actor-medallion.expression.".length)));
    return pixels;
  }
  if (id.startsWith("component.actor-medallion.affinity.")) {
    const affinity = id.slice("component.actor-medallion.affinity.".length);
    drawAffinityGlyph(pixels, resolvedSize, {
      role: "delver",
      affinity,
      expression: "emit",
      motivation: "",
      vitals: {
        durability: { current: 1, max: 1, fraction: 1 },
        health: { current: 1, max: 1, fraction: 1 },
        stamina: { current: 1, max: 1, fraction: 1 },
        mana: { current: 1, max: 1, fraction: 1 },
      },
    });
    return pixels;
  }
  if (id.startsWith("component.actor-medallion.motivation.")) {
    drawMotivationGlyph(pixels, resolvedSize, id.slice("component.actor-medallion.motivation.".length));
    return pixels;
  }
  return pixels;
}
