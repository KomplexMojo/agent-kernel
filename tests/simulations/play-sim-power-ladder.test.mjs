// Power ladder (Darren, 2026-11-03): the scenario's delver scaled rung by rung, each rung priced by
// the Allocator through `ak create` and played by the seat driver. A fixture picker; no model.
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { attackUse, equipEveryHeld, playProfile, runPowerLadder, scaleDelverSpec } from "../../scripts/testing/play-sim-power-ladder.mjs";

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
    const { runs, summary } = await runPowerLadder({ rungs: [1, 2], seeds: [0], repeats: 2, maxTicks: 2, seatPicker, outDir });
    expect(runs.map((run) => `${run.rung}:${run.repeat}:${run.outcome}:${run.label}`)).toEqual(["1:1:timeout:timeout", "1:2:timeout:timeout", "2:1:timeout:timeout", "2:2:timeout:timeout"]);
    expect(runs[2].delverTokens).toBeGreaterThan(runs[0].delverTokens);
    expect(summary.lowestWinningRung).toBeNull();
    expect(summary.byRung.map((rung) => [rung.rung, rung.plays, rung.wins])).toEqual([[1, 2, 0], [2, 2, 0]]);
    const rung2 = JSON.parse(readFileSync(join(outDir, "rung-2-s0-r1.json"), "utf8"));
    expect(rung2.profile.casts).toBe(0);
    expect(rung2.build.fingerprint).toMatch(/hero-1\[fire:emit:2:1,fire:push:3:1\|health40,mana60,stamina20,durability20\]/);
    const report = readFileSync(join(outDir, "report.md"), "utf8");
    expect(report).toMatch(/\| ×2 \| 0\/2 \|/);
    expect(report).toMatch(/\| ×2 \| 0 \| 2 \| timeout \| timeout \|/);
    // A seat that only waits held its push and never cast it: #724 flags every play.
    expect(summary.attackUnused).toBe(4);
    expect(rung2.profile).toMatchObject({ attackHeld: ["fire:push"], attackEquippedAtStart: true, attackUnused: true });
    expect(report).toMatch(/\*\*Defect:\*\* 4 of 4 play\(s\) held an attack and never cast it\./);
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
}, 180000);

test("a play is labelled from the seat's own record: fought, pinned, avoided", () => {
  const turn = (pick, hp, st, screen = "") => ({ pick, hud: `D1 hero-1 · HP ${hp}/20 (+1) MP 9/30 (+3) ST ${st}/10 (+2)`, screen });
  const pinned = playProfile({ outcome: "defeated", seatLog: { transcript: [turn("move:east", 20, 4, "In sight: W1 guard-1"), turn("wait", 12, 0), turn("wait", 0, 0)] } });
  expect(pinned).toEqual({ label: "pinned", equips: 0, casts: 0, struck: 0, healthLost: 20, hostileInSightTurns: 1 });
  const fought = playProfile({ outcome: "exited", seatLog: { transcript: [turn("equip:fire:push", 20, 10), turn("cast:fire:push@guard-1", 20, 10, "T1 You cast fire push and struck W1 guard-1: a solid hit; it looks hurt.")] } });
  expect(fought).toMatchObject({ label: "fought", equips: 1, casts: 1, struck: 1 });
  expect(playProfile({ outcome: "exited", seatLog: { transcript: [turn("move:north", 20, 9)] } }).label).toBe("avoided");
});

test("#722: a rung's delver starts with every held affinity equipped, up to three slots", () => {
  expect(equipEveryHeld(SPEC)).toBe(SPEC.replace("equip=fire:emit", "equip=fire:emit,fire:push"));
  const noEquip = SPEC.replace(";equip=fire:emit", "");
  expect(equipEveryHeld(noEquip)).toBe(`${noEquip};equip=fire:emit,fire:push`);
  const four = SPEC.replace("affinities=fire:emit:2:1,fire:push:3:1", "affinities=fire:emit:2,fire:push:3,dark:emit:1,decay:pull:2");
  expect(equipEveryHeld(four)).toContain("equip=fire:emit,fire:push,dark:emit;");
});

test("#724: a play that held a castable attack and cast none is flagged, and says whether it was equipped", () => {
  const turn = (pick, refused = false) => ({ pick, refused, hud: "", screen: "" });
  const never = attackUse(SPEC, { seatLog: { transcript: [turn("move:n"), turn("wait")] } });
  expect(never).toEqual({ attackHeld: ["fire:push"], attackEquippedAtStart: false, attackCasts: 0, attackUnused: true });
  const used = attackUse(equipEveryHeld(SPEC), { seatLog: { transcript: [turn("cast:fire:push@guard-1"), turn("cast:fire:push@guard-1", true)] } });
  expect(used).toEqual({ attackHeld: ["fire:push"], attackEquippedAtStart: true, attackCasts: 1, attackUnused: false });
  // A restoring push is support, not an attack: nothing to flag.
  const support = SPEC.replaceAll("fire:", "growth:").replace("affinity=fire", "affinity=growth");
  expect(attackUse(support, { seatLog: { transcript: [] } })).toMatchObject({ attackHeld: [], attackUnused: false });
});
