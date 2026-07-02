import assert from "node:assert/strict";
import {
  composeActorMedallion,
  normalizeActorMedallionState,
} from "../../packages/runtime/src/render/actor-medallion-composer.js";

const size = 64;

function pixel(pixels: Uint8ClampedArray, x: number, y: number) {
  const index = (y * size + x) * 4;
  return [pixels[index], pixels[index + 1], pixels[index + 2], pixels[index + 3]];
}

function luminance([r, g, b]: number[]) {
  return r + g + b;
}

function averageColor(pixels: Uint8ClampedArray, left: number, top: number, right: number, bottom: number) {
  const total = [0, 0, 0, 0];
  let count = 0;
  for (let y = top; y <= bottom; y += 1) {
    for (let x = left; x <= right; x += 1) {
      const [r, g, b, a] = pixel(pixels, x, y);
      total[0] += r;
      total[1] += g;
      total[2] += b;
      total[3] += a;
      count += 1;
    }
  }
  return total.map((value) => value / count);
}

function redCenterMassY(pixels: Uint8ClampedArray) {
  let weightedY = 0;
  let weight = 0;
  for (let y = 20; y <= 46; y += 1) {
    for (let x = 22; x <= 42; x += 1) {
      const [r, g, b, a] = pixel(pixels, x, y);
      const score = Math.max(0, r - Math.max(g, b)) * (a / 255);
      weightedY += y * score;
      weight += score;
    }
  }
  return weight > 0 ? weightedY / weight : 0;
}

test("composer renders delver circle and warden diamond actor glyphs", () => {
  const delver = composeActorMedallion({
    size,
    actor: { role: "delver", affinities: [{ kind: "water", expression: "emit" }] },
  });
  const warden = composeActorMedallion({
    size,
    actor: { role: "warden", affinities: [{ kind: "water", expression: "emit" }] },
  });

  assert.ok(luminance(pixel(delver, 32, 14)) > luminance(pixel(warden, 32, 14)) + 100, "delver circle should occupy the top ring");
  assert.ok(luminance(pixel(warden, 32, 10)) > luminance(pixel(delver, 32, 10)) + 50, "warden diamond should occupy the top point");
  assert.ok(luminance(pixel(warden, 52, 32)) > luminance(pixel(delver, 52, 32)) + 50, "warden diamond should occupy the right point");
});

test("composer changes the center affinity glyph when primary affinity changes", () => {
  const fire = composeActorMedallion({
    size,
    actor: { role: "delver", affinities: [{ kind: "fire", expression: "emit" }] },
  });
  const water = composeActorMedallion({
    size,
    actor: { role: "delver", affinities: [{ kind: "water", expression: "emit" }] },
  });

  const fireCenter = averageColor(fire, 28, 28, 36, 36);
  const waterCenter = averageColor(water, 28, 28, 36, 36);
  assert.ok(fireCenter[0] > waterCenter[0] + 30, "fire center should be redder than water");
  assert.ok(waterCenter[2] > fireCenter[2] + 30, "water center should be bluer than fire");
});

test("composer expression triangles change for push, pull, emit, and draw", () => {
  const actor = { role: "delver", affinities: [{ kind: "earth", expression: "emit" }] };
  const sprites = Object.fromEntries(
    ["push", "pull", "emit", "draw"].map((expression) => [
      expression,
      composeActorMedallion({
        size,
        actor: { ...actor, affinities: [{ kind: "earth", expression }] },
      }),
    ]),
  );

  assert.ok(luminance(pixel(sprites.push, 10, 5)) > 500, "push should mark right-facing top-left triangle");
  assert.ok(luminance(pixel(sprites.pull, 1, 5)) > 500, "pull should mark left-facing top-left triangle");
  assert.ok(luminance(pixel(sprites.emit, 0, 0)) > 500, "emit should touch the outer corner");
  assert.ok(luminance(pixel(sprites.draw, 9, 9)) > 500, "draw should point inward");
});

test("composer shifts the warden affinity glyph down inside the diamond", () => {
  const delver = composeActorMedallion({
    size,
    actor: { role: "delver", affinities: [{ kind: "fire", expression: "emit" }] },
  });
  const warden = composeActorMedallion({
    size,
    actor: { role: "warden", affinities: [{ kind: "fire", expression: "emit" }] },
  });

  assert.ok(redCenterMassY(warden) > redCenterMassY(delver) + 1.5);
});

test("composer vital bar pixels change when current and max change", () => {
  const full = composeActorMedallion({
    size,
    actor: { role: "delver", affinities: [{ kind: "life", expression: "emit" }] },
  });
  const damaged = composeActorMedallion({
    size,
    actor: {
      role: "delver",
      affinities: [{ kind: "life", expression: "emit" }],
      vitals: { health: { current: 4, max: 10 } },
    },
  });

  const fullRightBar = pixel(full, 61, 10);
  const damagedRightBar = pixel(damaged, 61, 10);
  assert.ok(fullRightBar[0] > 200, "full health should render a bright right-edge bar");
  assert.ok(damagedRightBar[0] < fullRightBar[0] - 100, "reduced health should reveal the dark right-edge track");
});

test("composer normalizes primary affinity from actor configuration", () => {
  const state = normalizeActorMedallionState({
    role: "warden",
    affinities: [
      { kind: "water", expression: "pull" },
      { kind: "fire", expression: "push" },
    ],
    motivation: "defending",
  });

  assert.equal(state.role, "warden");
  assert.equal(state.affinity, "water");
  assert.equal(state.expression, "pull");
  assert.equal(state.motivation, "defending");
});

// ## TODO: Test Permutations
// - actors with traits.affinities fallback but no actor.affinities should choose the first trait key deterministically
// - actor vitals with zero max should clamp to a safe default instead of producing NaN pixels
// - 32x32 and 16x16 composition should retain non-transparent expression and vital pixels
