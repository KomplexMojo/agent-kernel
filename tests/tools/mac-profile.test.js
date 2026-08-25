const assert = require("node:assert/strict");
const { resolve } = require("node:path");

const {
  loadConfig, getProfile, serviceEnvironment,
} = require("../../tools/remote-ollama-control/scripts/lib/config");
const { buildContentGenMatrix } = require("../../tools/remote-ollama-control/scripts/lib/benchmark");

const ROOT = resolve(__dirname, "../../tools/remote-ollama-control");

// A second machine can run the matrix, but only on purpose.
//
// The `mac` profile describes this MacBook so a run can be pointed at it without inventing the
// hardware facts at the call site. What it deliberately does NOT do is join the benchmark matrix:
// `buildContentGenMatrix` derives configurations from models.json's per-model `profiles` list, so a
// profile nothing references is inert, and matrixHash -- the identity every published result is
// compared through -- does not move. That inertness is the whole safety property here, and the
// tests below hold it in place rather than trusting a comment to.

function configWithoutMac() {
  const config = loadConfig(ROOT);
  const profiles = { ...config.profiles };
  delete profiles.mac;
  return { ...config, profiles };
}

function matrixHash(config) {
  return buildContentGenMatrix(config, { scenarioCount: 100, maximumPasses: 3 }).sha256;
}

test("the mac profile is complete enough that activating it cannot fail at matrix-build time", () => {
  const profile = getProfile(loadConfig(ROOT), "mac");
  for (const field of ["gpuCount", "capacityRank", "defaultContext", "defaultNumPredict", "port"]) {
    assert.ok(
      Number.isInteger(profile[field]) && profile[field] > 0,
      `mac.${field} must be a positive integer — buildContentGenMatrix throws on anything else`,
    );
  }
  assert.equal(typeof profile.hardwareClass, "string");
  assert.ok(profile.hardwareClass.length > 0, "mac.hardwareClass must be non-empty");
  assert.ok(profile.defaultModel, "mac.defaultModel must name a model this machine can serve");
});

// Copying an existing profile is the obvious way to add one, and every existing profile is AMD.
// Carrying those fields over would be silently wrong rather than loudly wrong: they are meaningless
// on Metal, and an empty one is actively harmful (see the serviceEnvironment test below).
test("the mac profile declares no AMD device visibility", () => {
  const raw = require("../../tools/remote-ollama-control/config/llm-profiles.json").profiles.mac;
  for (const field of ["rocrVisibleDevices", "hipVisibleDevices", "hsaOverrideGfxVersion", "gpuDevices"]) {
    assert.equal(
      raw[field], undefined,
      `mac.${field} is an AMD/ROCm concept and must be absent, not empty — `
      + "loadConfig normalises absent to '', and '' is not the same as unset downstream",
    );
  }
});

// The reason absent must not become empty. ROCR_VISIBLE_DEVICES='' does not read as "unset" to the
// ROCm runtime, it reads as "no devices", which drops the server to CPU without erroring.
test("serviceEnvironment omits device visibility rather than exporting it empty", () => {
  const config = loadConfig(ROOT);
  const mac = serviceEnvironment(getProfile(config, "mac"));
  assert.ok(!("ROCR_VISIBLE_DEVICES" in mac), "mac must not export ROCR_VISIBLE_DEVICES at all");
  assert.ok(!("HIP_VISIBLE_DEVICES" in mac), "mac must not export HIP_VISIBLE_DEVICES at all");
  assert.equal(mac.OLLAMA_PROFILE, "mac");

  // ...and the guard must not have disarmed the profiles that genuinely need these set.
  const dual = serviceEnvironment(getProfile(config, "dual"));
  assert.equal(dual.ROCR_VISIBLE_DEVICES, "0,1");
  assert.equal(dual.HIP_VISIBLE_DEVICES, "0,1");
  assert.equal(dual.HSA_OVERRIDE_GFX_VERSION, "10.3.0");
});

// The load-bearing one. Every published result is comparable only to results carrying the same
// matrixHash, and the box has that hash pinned in its agent env. If merely DEFINING a profile moved
// it, this change would silently orphan every prior result and the pin would compare incomparable
// runs without erroring.
test("defining the mac profile does not move matrixHash", () => {
  assert.equal(
    matrixHash(loadConfig(ROOT)), matrixHash(configWithoutMac()),
    "the mac profile changed the content-gen matrix identity — it must stay inert until a model opts in",
  );
});

// What makes the profile inert is that no model references it. Activating the Mac means editing
// models.json, and that is a decision with a cost this test states rather than hides: resourceOrder
// ranks configurations by gpuCount then capacityRank to report "the cheapest configuration that
// qualifies", and that ordering assumes one machine. One GPU on an M3 Pro and one GPU on the
// benchmark box are not the same cost, so mixing them into one matrix makes that answer incoherent.
// Settle the ordering question first; then delete this test in the same diff that opts a model in.
test("no model opts into the mac profile yet", () => {
  const models = require("../../tools/remote-ollama-control/config/models.json").models;
  const opted = Object.entries(models)
    .filter(([, model]) => (model.profiles || []).includes("mac"))
    .map(([id]) => id);
  assert.deepEqual(
    opted, [],
    `${opted.join(", ")} opted into the mac profile. That changes matrixHash and mixes two machines `
    + "into one resourceOrder ranking — decide how cross-machine cost is ordered before landing it",
  );
});
