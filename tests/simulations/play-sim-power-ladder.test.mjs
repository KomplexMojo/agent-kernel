// Power ladder (Darren, 2026-11-03): the scenario's delver scaled rung by rung, each rung priced by
// the Allocator through `ak create` and played by the seat driver. A fixture picker; no model.
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { runPowerLadder, scaleDelverSpec } from "../../scripts/testing/play-sim-power-ladder.mjs";

const SPEC = "count=1;id=hero;affinity=fire;affinities=fire:emit:2:1,fire:push:3:1;equip=fire:emit;motivation=user_controlled;vitals=health:20:1,mana:30:3,stamina:10:2,durability:10:1";

test("a rung scales vitals and regen by k and push/pull intensity by the square root of k", () => {
  expect(scaleDelverSpec(SPEC, 1)).toBe(SPEC);
  expect(scaleDelverSpec(SPEC, 4)).toBe(SPEC
    .replace("fire:push:3:1", "fire:push:3:2")
    .replace("vitals=health:20:1,mana:30:3,stamina:10:2,durability:10:1", "vitals=health:80:4,mana:120:12,stamina:40:8,durability:40:4"));
  expect(scaleDelverSpec(SPEC, 1.5)).toContain("health:30:2");
  expect(() => scaleDelverSpec(SPEC, 0)).toThrow();
});

test("each rung builds the same map with a stronger delver, priced, and is played through the seat", async () => {
  const outDir = mkdtempSync(join(tmpdir(), "power-ladder-"));
  try {
    const seatPicker = async ({ actions }) => actions.find((action) => action.id === "wait")?.id;
    const { runs, summary } = await runPowerLadder({ rungs: [1, 2], seeds: [0], maxTicks: 2, seatPicker, outDir });
    expect(runs.map((run) => run.outcome)).toEqual(["timeout", "timeout"]);
    expect(runs[1].delverTokens).toBeGreaterThan(runs[0].delverTokens);
    expect(summary.lowestWinningRung).toBeNull();
    const rung2 = JSON.parse(readFileSync(join(outDir, "rung-2-s0.json"), "utf8"));
    expect(rung2.build.fingerprint).toMatch(/hero-1\[fire:emit:2:1,fire:push:3:1\|health40,mana60,stamina20,durability20\]/);
    expect(readFileSync(join(outDir, "report.md"), "utf8")).toMatch(/\| ×2 \| 0 \| timeout \|/);
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
}, 180000);
