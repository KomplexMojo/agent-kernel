// Play-sim M4 (#615): the T1 picker chooses only from the legal list. Fixture pickers; no live model.
import { createRequire } from "node:module";
import { expect, test } from "vitest";
import { createPlaySession } from "../../packages/runtime/src/runner/play-session.js";
import { listLegalPlayCommands, llmPicker, runBurst } from "../../scripts/testing/play-sim-t1.mjs";

const require = createRequire(import.meta.url);
const { buildUnifiedLevel, viableVitals } = require("../fixtures/ui-ascii/unified-level.mjs");

const level = (mana = 200) => buildUnifiedLevel({
  id: "t1", tiles: ["######", "#....#", "#....E", "######"],
  actors: [
    { category: "delver", id: "hero", position: { x: 1, y: 1 }, motivations: ["user_controlled"], vitals: viableVitals({ mana }),
      affinities: [{ kind: "water", expression: "push", stacks: 3, intensity: 1 }] },
    { category: "warden", id: "guard", position: { x: 3, y: 1 }, motivations: ["stationary"], vitals: viableVitals(), affinities: [] },
  ],
});
const start = async (mana) => createPlaySession({ ...level(mana), fog: false });

test("the legal list holds wait, open steps, and casts at targets in reach, with stable ids", async () => {
  const session = await start();
  await session.act({ kind: "equip_affinity", params: { affinityKey: "water:push" } });
  const actions = listLegalPlayCommands(session.view());
  const ids = actions.map((action) => action.id);
  expect(ids).toEqual([...ids].sort());
  expect(ids).toContain("wait");
  expect(ids).toContain("move:east");
  expect(ids).not.toContain("move:north"); // a wall
  expect(ids).not.toContain("move:west");
  expect(ids).toContain("cast:water:push@guard");
  for (const action of actions) expect(action.command.kind).toMatch(/wait|move|cast_affinity|take/);
});

test("a cast the seat cannot pay for is not listed", async () => {
  const session = await start(1);
  await session.act({ kind: "equip_affinity", params: { affinityKey: "water:push" } });
  expect(listLegalPlayCommands(session.view()).map((action) => action.id).some((id) => id.startsWith("cast:"))).toBe(false);
});

test("a legal pick is executed; an id outside the list is refused, retried, then ends the burst", async () => {
  const session = await start();
  const good = await runBurst({ session, picker: async () => "wait", burst: 2 });
  expect(good).toMatchObject({ picks: ["wait", "wait"], illegal: 0, ended: "burst" });
  const tick = session.status().tick;
  const bad = await runBurst({ session, picker: async () => "teleport:exit", burst: 3, retries: 2 });
  expect(bad).toMatchObject({ picks: [], illegal: 3, ended: "illegal" });
  expect(session.status().tick).toBe(tick); // nothing ran
});

test("the model picker asks with the action list and reads {action}; junk answers read as no pick", async () => {
  const session = await start();
  const prompts = [];
  const answer = (text) => ({ generate: async ({ prompt }) => { prompts.push(prompt); return { response: text }; } });
  const actions = listLegalPlayCommands(session.view());
  expect(await llmPicker({ adapter: answer('{"action":"wait"}'), model: "fixture" })({ view: session.view(), actions })).toBe("wait");
  expect(prompts[0]).toMatch(/move:east/);
  expect(await llmPicker({ adapter: answer("go east"), model: "fixture" })({ view: session.view(), actions })).toBeNull();
});

// ## TODO: Test Permutations
// - take entries from view.loot; sprint ids; burst ending on exit/defeat; the --driver t1-contact CLI flag

test("play-sim with a T1 picker records the driver and the burst counts", async () => {
  const { mkdtempSync, readFileSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { runPlaySim } = await import("../../scripts/testing/play-sim.mjs");
  const outDir = mkdtempSync(join(tmpdir(), "play-sim-t1-"));
  try {
    const { runs } = await runPlaySim({ scenarios: ["duel"], seeds: [0], outDir, baseline: true, treatment: false, maxTicks: 60, picker: async () => "wait" });
    const record = JSON.parse(readFileSync(join(outDir, runs[0].file), "utf8"));
    expect(record.driver).toBe("t1-contact");
    expect(record.t1.bursts).toBeGreaterThan(0);
    expect(record.t1.illegal).toBe(0);
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
}, 120000);
