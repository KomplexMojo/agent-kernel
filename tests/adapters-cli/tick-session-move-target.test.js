import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "vitest";
import { renderAscii } from "../../packages/adapters-cli/src/tick-session.mjs";
import { boxedTerrain, buildUnifiedArtifacts } from "../fixtures/personas/unified-actor-runtime.mjs";

function writeRun(root, params) {
  const { simConfig, initialState } = buildUnifiedArtifacts({
    width: 3,
    height: 3,
    terrain: boxedTerrain(3, 3).map((cell, index) => (index === 4 ? "floor" : cell)),
    runId: "run_tick_target",
    clock: "2026-04-10T00:00:00.000Z",
    actors: [{
      id: "actor_1",
      category: "delver",
      position: { x: 1, y: 1 },
      motivations: ["exploring"],
      vitals: { health: { current: 10, max: 10, regen: 0 } },
    }],
  });
  const buildDir = join(root, "create");
  const runDir = join(root, "run");
  mkdirSync(buildDir, { recursive: true });
  mkdirSync(runDir, { recursive: true });
  writeFileSync(join(buildDir, "sim-config.json"), JSON.stringify(simConfig));
  writeFileSync(join(buildDir, "initial-state.json"), JSON.stringify(initialState));
  writeFileSync(join(runDir, "tick-frames.json"), JSON.stringify([{
    tick: 1,
    acceptedActions: [{ kind: "move", actorId: "actor_1", params }],
  }]));
  return root;
}

test("tick replay moves the actor to params.target", async () => {
  const root = writeRun(mkdtempSync(join(tmpdir(), "ak-tick-target-")), { target: { x: 2, y: 1 } });
  const ascii = await renderAscii(root, 1);
  const row = ascii.split("\n")[1];
  assert.equal(row[2], "@");
  assert.equal(row[1], ".");
});

test("tick replay ignores a leftover params.to destination", async () => {
  const root = writeRun(mkdtempSync(join(tmpdir(), "ak-tick-to-")), { to: { x: 2, y: 1 } });
  const ascii = await renderAscii(root, 1);
  const row = ascii.split("\n")[1];
  assert.equal(row[1], "@");
  assert.equal(row[2], "#");
});
