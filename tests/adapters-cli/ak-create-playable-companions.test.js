// Darren's example level (2026-10-13): one character you play and five cheap companions
// that explore and attack on their own, sent to swamp a floor's wardens and traps.
//
// `ak create` makes only the delver authored `user_controlled` playable, charges the
// playable premium once, takes one motivation per family (`exploring+attacking`), and
// prices a playable-only delver's movement like any moving actor's.

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { mkdtempSync, readFileSync } = require("node:fs");
const { resolve, join } = require("node:path");
const os = require("node:os");

const ROOT = resolve(__dirname, "../..");
const CLI = resolve(ROOT, "packages/adapters-cli/src/cli/ak.mjs");
const FLOOR = "vitals=health:10:1,mana:10:1,stamina:10:1,durability:10:1";

function create(args) {
  const outDir = mkdtempSync(join(os.tmpdir(), "agent-kernel-playable-"));
  const result = spawnSync(process.execPath, [CLI, "create", ...args, "--budget-tokens", "6000",
    "--created-at", "2026-10-14T00:00:00.000Z", "--out-dir", outDir], { cwd: ROOT, encoding: "utf8" });
  assert.equal(result.status, 0, `${result.stderr}\n${result.stdout}`);
  const read = (name) => JSON.parse(readFileSync(join(outDir, name), "utf8"));
  return { summary: JSON.parse(result.stdout.trim()), receipt: read("budget-receipt.json"), initialState: read("initial-state.json") };
}

function motivationLines(receipt, id) {
  return receipt.lineItems.filter((line) => line.id === id);
}

function spendBySubject(receipt) {
  const totals = new Map();
  for (const line of receipt.lineItems) {
    const subject = line.subjectRef?.id;
    if (subject) totals.set(subject, (totals.get(subject) || 0) + line.totalCost);
  }
  return totals;
}

test("one playable character and five exploring+attacking companions", async () => {
  const { receipt, initialState } = create([
    "--room", "size=medium;count=2",
    "--delver", `count=1;id=hero;affinity=light;motivation=user_controlled;${FLOOR}`,
    "--delver", `count=5;id=minion;affinity=dark;motivation=exploring+attacking;${FLOOR}`,
    "--warden", "count=1;affinity=corrode;motivation=patrolling+defending",
  ]);

  const byId = new Map(initialState.actors.map((actor) => [actor.id, actor]));
  const playable = initialState.actors.filter((actor) => actor.motivations?.includes("user_controlled"));
  assert.deepEqual(playable.map((actor) => actor.id), ["hero-1"], "only the authored character is playable");
  for (let n = 1; n <= 5; n += 1) {
    assert.deepEqual(byId.get(`minion-${n}`)?.motivations, ["exploring", "attacking"]);
  }

  const premium = motivationLines(receipt, "motivation_user_controlled");
  assert.equal(premium.length, 1, "the playable premium is charged once");
  assert.equal(premium[0].subjectRef.id, "hero-1");
  assert.equal(motivationLines(receipt, "motivation_exploring").length, 5);
  assert.equal(motivationLines(receipt, "motivation_attacking").length, 5);

  const { defaultPlayerActorId } = await import("../../packages/runtime/src/runner/play-session.js");
  assert.equal(defaultPlayerActorId(initialState), "hero-1", "play seats the playable character");
});

test("a playable-only delver costs more than an exploring companion like it", () => {
  const { receipt } = create([
    "--room", "size=medium;count=1",
    "--delver", `count=1;id=hero;affinity=wind;motivation=user_controlled;${FLOOR}`,
    "--delver", `count=1;id=scout;affinity=wind;motivation=exploring;${FLOOR}`,
  ]);
  const spend = spendBySubject(receipt);
  assert.ok(spend.get("hero-1") > spend.get("scout-1"),
    `hero ${spend.get("hero-1")} should cost more than scout ${spend.get("scout-1")}`);
});

test("a level with no user_controlled delver is made, with nobody marked playable", () => {
  const { summary, initialState } = create([
    "--room", "size=small;count=1",
    "--delver", "count=2;affinity=fire;motivation=exploring",
  ]);
  assert.equal(summary.ok, true);
  assert.equal(initialState.actors.some((actor) => actor.motivations?.includes("user_controlled")), false);
});

test("two motivations from one family are refused with the Configurator's reason", () => {
  const outDir = mkdtempSync(join(os.tmpdir(), "agent-kernel-playable-conflict-"));
  const result = spawnSync(process.execPath, [CLI, "create", "--room", "size=small;count=1",
    "--delver", "count=1;affinity=water;motivation=exploring+patrolling", "--dry-run", "--out-dir", outDir],
  { cwd: ROOT, encoding: "utf8" });
  const dryRun = JSON.parse(result.stdout.trim());
  assert.equal(dryRun.valid, false);
  assert.match(dryRun.errors[0], /exploring.*patrolling.*mobility/);
});

test("ak_create's structured form takes a motivation list, one per family", async () => {
  const { buildArgv } = await import("../../packages/adapters-cli/src/mcp/tools/shared.mjs");
  const { authoringSpec } = await import("../../packages/adapters-cli/src/mcp/tools/authoring.mjs");
  const argv = buildArgv({ delver: [{ count: 5, affinity: "dark", motivation: ["exploring", "attacking"] }] }, authoringSpec);
  const spec = argv[argv.indexOf("--delver") + 1];
  assert.match(spec, /(^|;)motivation=exploring\+attacking(;|$)/);
});

// ## TODO: Test Permutations
// - MCP ak_create end to end with a structured delver { motivation: ["exploring", "attacking"] } authors both.
// - a warden authored user_controlled is playable and charged the premium.
// - delver shorthand segments ("exploring;attacking") are refused as a repeated motivation.
// - --delver motivation=user_controlled+stealthy is charged the premium plus stealthy.
