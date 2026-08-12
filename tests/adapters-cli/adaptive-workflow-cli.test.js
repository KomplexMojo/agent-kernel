const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } = require("node:fs");
const { join, resolve } = require("node:path");
const os = require("node:os");

const ROOT = resolve(__dirname, "../..");
const CLI = join(ROOT, "packages/adapters-cli/src/cli/ak.mjs");
const INPUT = join(ROOT, "tests/fixtures/adaptive-workflow/cli-run-input-v1-basic.json");

function runCli(args) {
  return spawnSync(process.execPath, [CLI, ...args], { cwd: ROOT, encoding: "utf8", env: { ...process.env, M8_SECRET: "must-not-leak" } });
}
function ok(args) {
  const result = runCli(args);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  return { result, output: JSON.parse(result.stdout.trim()) };
}
const json = (path) => JSON.parse(readFileSync(path, "utf8"));

test("workflow run --dry-run validates without model calls or filesystem mutation", () => {
  const root = mkdtempSync(join(os.tmpdir(), "ak-workflow-dry-"));
  const outDir = join(root, "not-created");
  const { output, result } = ok(["workflow", "run", "--input", INPUT, "--out-dir", outDir, "--dry-run"]);
  assert.deepEqual({ ok: output.ok, action: output.action, valid: output.valid, dryRun: output.dryRun }, { ok: true, action: "run", valid: true, dryRun: true });
  assert.equal(existsSync(outDir), false);
  assert.doesNotMatch(`${result.stdout}${result.stderr}`, /must-not-leak|fixture-secret/i);
  const invalidPath = join(root, "invalid.json");
  for (const patch of [{ requiredKeys: "rooms" }, { executionOperation: "shell" }, { modelResponse: {} }, { maxModelAttempts: 0 }]) {
    writeFileSync(invalidPath, JSON.stringify({ ...json(INPUT), ...patch }));
    assert.notEqual(runCli(["workflow", "run", "--input", invalidPath, "--out-dir", outDir, "--dry-run"]).status, 0);
    assert.equal(existsSync(outDir), false);
  }
});

test("fixture run persists the durable workflow record and safe execution receipt", () => {
  const outDir = join(mkdtempSync(join(os.tmpdir(), "ak-workflow-run-")), "record");
  const { output, result } = ok(["workflow", "run", "--input", INPUT, "--out-dir", outDir]);
  assert.equal(output.outcome, "complete");
  for (const file of ["state.json", "runtime-profile.json", "selected-strategy.json", "validation.json", "events.json", "request.json"]) assert.equal(existsSync(join(outDir, file)), true, file);
  assert.equal(json(join(outDir, "state.json")).phase, "complete");
  assert.equal(json(join(outDir, "selected-strategy.json")).strategyId, "flagship_full_context_v1");
  assert.ok(json(join(outDir, "events.json")).some((event) => event.kind === "side_effect"));
  const persisted = [result.stdout, result.stderr, ...["state.json", "runtime-profile.json", "selected-strategy.json", "validation.json", "events.json", "request.json"].map((file) => readFileSync(join(outDir, file), "utf8"))].join("\n");
  assert.doesNotMatch(persisted, /must-not-leak|fixture-secret/i);

  const status = ok(["workflow", "status", "--out-dir", outDir]);
  assert.equal(status.output.phase, "complete");
  const originalState = json(join(outDir, "state.json"));
  const replay = ok(["workflow", "replay", "--out-dir", outDir, "--base-url", "http://127.0.0.1:1"]);
  assert.equal(replay.output.outcome, "complete");
  assert.equal(replay.output.liveModelCalls, 0);
  assert.deepEqual(json(join(outDir, "state.json")), originalState);
  assert.equal(existsSync(join(outDir, "replay-state.json")), true);
  const cancel = ok(["workflow", "cancel", "--out-dir", outDir]);
  assert.equal(cancel.output.terminal, true);
  assert.notEqual(runCli(["workflow", "run", "--input", INPUT, "--out-dir", outDir]).status, 0);
});

test("filesystem reservations survive adapter restart and controlled execution is allowlisted", async () => {
  const [{ createFilesystemWorkflowStore }, { createControlledExecutionAdapter }] = await Promise.all([
    import("../../packages/adapters-cli/src/adapters/adaptive-workflow/filesystem-store.js"),
    import("../../packages/adapters-cli/src/adapters/adaptive-workflow/controlled-execution.js"),
  ]);
  const root = join(mkdtempSync(join(os.tmpdir(), "ak-workflow-store-")), "store");
  const first = await createFilesystemWorkflowStore({ root });
  const payloadRef = await first.putContent({ x: 1 });
  assert.equal((await first.reserveSideEffect({ idempotencyKey: "safe-key", payloadRef })).status, "claimed");
  const receipt = { ok: true };
  const receiptRef = await first.putContent(receipt);
  await first.completeSideEffect({ idempotencyKey: "safe-key", receiptRef, receipt });
  const restarted = await createFilesystemWorkflowStore({ root, create: false });
  assert.equal((await restarted.reserveSideEffect({ idempotencyKey: "safe-key", payloadRef })).status, "existing");
  assert.equal((await restarted.reserveSideEffect({ idempotencyKey: "safe-key", payloadRef: await restarted.putContent({ x: 2 }) })).status, "conflict");
  const pendingRef = await restarted.putContent({ pending: true });
  assert.equal((await restarted.reserveSideEffect({ idempotencyKey: "pending-key", payloadRef: pendingRef })).status, "claimed");
  assert.equal((await (await createFilesystemWorkflowStore({ root, create: false })).reserveSideEffect({ idempotencyKey: "pending-key", payloadRef: pendingRef })).status, "pending");
  assert.throws(() => createControlledExecutionAdapter({ operationId: "workflow", operations: {} }), /not allowed/i);
  const adapter = createControlledExecutionAdapter({ operationId: "record", operations: { record: ({ runId }) => ({ runId }) } });
  assert.deepEqual(await adapter.run({ runId: "r" }), { runId: "r" });
  await restarted.save("active", { runId: "active", phase: "plan" });
  assert.equal(ok(["workflow", "cancel", "--out-dir", root]).output.requested, true);
  assert.equal(existsSync(join(root, "cancel-request.json")), true);
  const unsafe = join(mkdtempSync(join(os.tmpdir(), "ak-workflow-unsafe-")), "store");
  const outside = mkdtempSync(join(os.tmpdir(), "ak-workflow-outside-"));
  mkdirSync(unsafe); symlinkSync(outside, join(unsafe, "content"));
  await assert.rejects(() => createFilesystemWorkflowStore({ root: unsafe, create: false }).then((store) => store.putContent({ secret: true })), /symlink|unsafe/i);
  const rootLink = join(mkdtempSync(join(os.tmpdir(), "ak-workflow-root-link-")), "link");
  symlinkSync(root, rootLink);
  await assert.rejects(() => createFilesystemWorkflowStore({ root: rootLink, create: false }), /symlink|unsafe/i);
});

test("workflow rejects persisted credential-shaped config before creating output", () => {
  const root = mkdtempSync(join(os.tmpdir(), "ak-workflow-secrets-"));
  const input = json(INPUT);
  input.declaredCapability.credentials = { apiKey: "declared-credential-marker" };
  const inputPath = join(root, "input.json"); writeFileSync(inputPath, JSON.stringify(input));
  let result = runCli(["workflow", "run", "--input", inputPath, "--out-dir", join(root, "declared")]);
  assert.notEqual(result.status, 0); assert.equal(existsSync(join(root, "declared")), false);
  delete input.declaredCapability.credentials; input.model = { apiKey: "model-credential-marker" };
  writeFileSync(inputPath, JSON.stringify(input));
  result = runCli(["workflow", "run", "--input", inputPath, "--out-dir", join(root, "model")]);
  assert.notEqual(result.status, 0); assert.equal(existsSync(join(root, "model")), false);
  const policyPath = join(root, "policy.json");
  writeFileSync(policyPath, JSON.stringify({ schema: "agent-kernel/AdaptiveWorkflowStrategyPolicy", schemaVersion: 1, context: { token: "policy-credential-marker" } }));
  result = runCli(["workflow", "run", "--input", INPUT, "--policy", policyPath, "--out-dir", join(root, "policy")]);
  assert.notEqual(result.status, 0); assert.equal(existsSync(join(root, "policy")), false);
  assert.doesNotMatch(`${result.stdout}${result.stderr}`, /credential-marker/);
});

test("workflow replay is read-only when source execution or candidate content is missing", () => {
  const first = join(mkdtempSync(join(os.tmpdir(), "ak-workflow-replay-ro-")), "run"); ok(["workflow", "run", "--input", INPUT, "--out-dir", first]);
  const reservation = join(first, "idempotency", readdirSync(join(first, "idempotency"))[0]); rmSync(reservation);
  const replay = ok(["workflow", "replay", "--out-dir", first]);
  assert.equal(replay.output.liveExecutionCalls, 0); assert.equal(existsSync(reservation), false);
  const second = join(mkdtempSync(join(os.tmpdir(), "ak-workflow-replay-missing-")), "run"); ok(["workflow", "run", "--input", INPUT, "--out-dir", second]);
  const digest = json(join(second, "state.json")).refs.configurationRef.contentRef.digest;
  const candidate = join(second, "content", `${digest}.json`); rmSync(candidate);
  const missing = runCli(["workflow", "replay", "--out-dir", second]);
  assert.notEqual(missing.status, 0); assert.equal(existsSync(candidate), false);
});

test("workflow rejects duplicate, conflicting, and colliding command inputs", () => {
  const outDir = join(mkdtempSync(join(os.tmpdir(), "ak-workflow-conflicts-")), "run"); ok(["workflow", "run", "--input", INPUT, "--out-dir", outDir]);
  for (const args of [
    ["workflow", "run", "--input", INPUT, "--out-dir", "/tmp/first", "--out-dir", "/tmp/second", "--dry-run"],
    ["workflow", "run", "--replay", outDir, "--input", INPUT],
    ["workflow", "run", "--replay", outDir, "--reason", "ignored"],
    ["workflow", "run", "--cancel", "cli_workflow_basic", "--out-dir", outDir, "--input", INPUT],
    ["workflow", "run", "--cancel", "cli_workflow_basic", "--out-dir", outDir, "--run-id", "ignored"],
    ["workflow", "replay", "--cancel", "cli_workflow_basic", "--out-dir", outDir],
    ["workflow", "cancel", "--replay", outDir, "--out-dir", outDir],
  ]) assert.notEqual(runCli(args).status, 0, args.join(" "));
  const occupied = join(mkdtempSync(join(os.tmpdir(), "ak-workflow-occupied-")), "run"); mkdirSync(occupied); writeFileSync(join(occupied, "request.json"), "do-not-overwrite");
  assert.notEqual(runCli(["workflow", "run", "--input", INPUT, "--out-dir", occupied]).status, 0);
  assert.equal(readFileSync(join(occupied, "request.json"), "utf8"), "do-not-overwrite");
});

test("filesystem store validates canonical refs, names, and clone isolation", async () => {
  const { createFilesystemWorkflowStore } = await import("../../packages/adapters-cli/src/adapters/adaptive-workflow/filesystem-store.js");
  const root = join(mkdtempSync(join(os.tmpdir(), "ak-workflow-integrity-")), "store"); const store = await createFilesystemWorkflowStore({ root });
  const first = await store.putContent({ b: 2, a: 1 }); const second = await store.putContent({ a: 1, b: 2 });
  assert.equal(first.digest, second.digest);
  const loaded = await store.getContent(first); loaded.a = 99; assert.equal((await store.getContent(first)).a, 1);
  await assert.rejects(() => store.reserveSideEffect({ idempotencyKey: "tampered", payloadRef: { ...first, bytes: first.bytes + 1 } }), /mismatch|invalid/i);
  await assert.rejects(() => store.save("", { runId: "" }), /runId/i);
  await assert.rejects(() => store.writeArtifact("../escape.json", {}), /invalid|unsafe/i);
  const recordPath = join(root, "content", `${first.digest}.json`); const record = json(recordPath); record.ref.bytes += 1; writeFileSync(recordPath, JSON.stringify(record));
  await assert.rejects(() => store.getContent(first), /mismatch/i);
});

test("missing policy, invalid runtime profile, occupied state dir, and replay/cancel conflicts fail safely", () => {
  const root = mkdtempSync(join(os.tmpdir(), "ak-workflow-m11-"));

  // Missing --policy path fails before the output directory is created.
  const missingPolicyOut = join(root, "missing-policy");
  assert.notEqual(runCli(["workflow", "run", "--input", INPUT, "--policy", join(root, "absent-policy.json"), "--out-dir", missingPolicyOut]).status, 0);
  assert.equal(existsSync(missingPolicyOut), false);

  // Invalid runtime profile fails before model execution / output creation.
  const badProfile = join(root, "bad-profile.json");
  writeFileSync(badProfile, JSON.stringify({ schema: "agent-kernel/AdaptiveWorkflowRuntimeProfile", schemaVersion: 1, source: "not-a-source" }));
  const badProfileOut = join(root, "bad-profile-out");
  assert.notEqual(runCli(["workflow", "run", "--input", INPUT, "--runtime-profile", badProfile, "--out-dir", badProfileOut]).status, 0);
  assert.equal(existsSync(badProfileOut), false);

  // A completed out-dir holding workflow state is rejected without overwrite.
  const occupied = join(root, "occupied");
  ok(["workflow", "run", "--input", INPUT, "--out-dir", occupied]);
  const originalState = readFileSync(join(occupied, "state.json"), "utf8");
  assert.notEqual(runCli(["workflow", "run", "--input", INPUT, "--out-dir", occupied]).status, 0);
  assert.equal(readFileSync(join(occupied, "state.json"), "utf8"), originalState);

  // Replay and cancel compatibility flags conflict deterministically.
  assert.notEqual(runCli(["workflow", "replay", "--out-dir", occupied, "--cancel", "cli_workflow_basic"]).status, 0);
});

// ## TODO: Test Permutations (expanded in M11)
// - missing policy path -> covered by "missing policy, invalid runtime profile, occupied state dir ..."
// - invalid runtime profile -> covered by the same test
// - duplicate out-dir containing workflow state -> covered by the same test
// - replay and cancel compatibility flags -> covered by the same test
