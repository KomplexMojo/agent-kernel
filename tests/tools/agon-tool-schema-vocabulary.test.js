// #765 — the benchmark's agon_create tool schema is hand-tuned for models (see the comments in
// agon-tool-schema.js), so it stays its own file; but the vocabularies in it are not ours to
// restate. Derive the check instead of the schema: every enum it offers must be the runtime's, so a
// vocabulary change fails here rather than silently splitting what models are told from what the
// MCP server and the CLI accept.
const assert = require("node:assert/strict");

const SCHEMA = "../../tools/remote-ollama-control/scripts/lib/agon-tool-schema";
const CONTRACTS = "../../packages/runtime/src/contracts";

async function vocabulary() {
  const domain = await import(`${CONTRACTS}/domain-constants.js`);
  const game = await import(`${CONTRACTS}/game-vocabulary.js`);
  return { domain, game };
}

function collectEnums(node, path = "", out = []) {
  if (!node || typeof node !== "object") return out;
  if (Array.isArray(node.enum)) out.push({ path, values: node.enum });
  for (const [key, child] of Object.entries(node)) {
    if (key === "enum") continue;
    collectEnums(child, `${path}.${key}`, out);
  }
  return out;
}

test("the benchmark's affinity and expression enums are the runtime's, in order", async () => {
  const schema = require(SCHEMA);
  const { domain } = await vocabulary();
  assert.deepEqual(schema.AFFINITY_ENUM, [...domain.AFFINITY_KINDS]);
  assert.deepEqual(schema.EXPRESSION_ENUM, [...domain.AFFINITY_EXPRESSIONS]);
});

test("every motivation the benchmark offers is a motivation the runtime knows", async () => {
  const schema = require(SCHEMA);
  const { game } = await vocabulary();
  const unknown = schema.MOTIVATION_ENUM.filter((kind) => !game.GAME_MOTIVATION_KINDS.includes(kind));
  assert.deepEqual(unknown, [], `the benchmark offers motivations the runtime does not know: ${unknown.join(", ")}`);
});

test("the actor vital keys the benchmark offers are exactly the game's", async () => {
  const { AGON_CREATE_TOOL } = require(SCHEMA);
  const { game } = await vocabulary();
  const delver = AGON_CREATE_TOOL.function.parameters.properties.delver.items;
  assert.deepEqual(Object.keys(delver.properties.vitals.properties).sort(), [...game.GAME_VITAL_KEYS].sort());
});

test("every affinity or expression enum anywhere in the tool schema is the runtime's", async () => {
  const { AGON_CREATE_TOOL } = require(SCHEMA);
  const { domain } = await vocabulary();
  const kinds = new Set(domain.AFFINITY_KINDS);
  const expressions = new Set(domain.AFFINITY_EXPRESSIONS);
  for (const { path, values } of collectEnums(AGON_CREATE_TOOL)) {
    const asKinds = values.every((value) => kinds.has(value));
    const asExpressions = values.every((value) => expressions.has(value));
    if (!asKinds && !asExpressions) continue; // sizes, priorities, vitals... are not affinity vocabulary
    assert.deepEqual(values, [...(asKinds ? domain.AFFINITY_KINDS : domain.AFFINITY_EXPRESSIONS)], `${path} drifted from the runtime`);
  }
});

// ## TODO: Test Permutations
