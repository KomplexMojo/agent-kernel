const assert = require("node:assert/strict");

const { normalizeToolArgs } = require("../../tools/remote-ollama-control/scripts/lib/ak-runner");

// normalizeToolArgs' array repair (M3, see coding-issues-affecting-benchmarking.md) is a general
// bracket-balance fix, not a lookup table of the two malformed strings the benchmark happened to
// record. tests/fixtures/benchmark-failures/bf-003.json and bf-027.json prove it against those
// exact real attempts; this file proves the underlying MECHANISM against hand-built cases the
// corpus doesn't cover, so a future regression in the general logic doesn't hide behind "no
// historical fixture happens to exercise that shape".

function delverOf(result) {
  return normalizeToolArgs({ delver: result }).delver;
}

test("a well-formed JSON array string is parsed unchanged", () => {
  const out = delverOf('[{"affinity":"fire","count":1}]');
  assert.deepEqual(out, [{ affinity: "fire", count: 1 }]);
});

test("an extra trailing brace after a complete array is dropped", () => {
  // The bf-003 shape, generalized: {"delver": [...]} where only the substring from [ onward
  // reached the delver field, carrying the outer object's closing } along with it.
  const out = delverOf('[{"affinity":"fire","count":1},{"affinity":"water","count":2}]}');
  assert.deepEqual(out, [{ affinity: "fire", count: 1 }, { affinity: "water", count: 2 }]);
});

test("a missing closing bracket on an otherwise-complete array is appended", () => {
  // The bf-018/bf-027 shape, generalized: every object inside is balanced, but the outer [ never
  // closes -- a generation cut off exactly at the array boundary.
  const out = delverOf('[{"affinity":"fire","count":1},{"affinity":"water","count":2}');
  assert.deepEqual(out, [{ affinity: "fire", count: 1 }, { affinity: "water", count: 2 }]);
});

test("a bracket character inside a quoted string does not confuse the repair", () => {
  // Guards the string-awareness in repairJsonBrackets itself: a value containing a literal ] or }
  // must not be read as closing the array early or corrupting the balance count.
  const out = delverOf('[{"affinity":"fire","note":"closes with ] and } inside quotes","count":1}]}');
  assert.deepEqual(out, [{ affinity: "fire", note: "closes with ] and } inside quotes", count: 1 }]);
});

test("content too broken to repair degrades to a single opaque entity rather than throwing", () => {
  // A mismatched closer inside an otherwise-open array (}  where ] was structurally expected) is
  // not one of the two repairable shapes: repairJsonBrackets bails out (an unmatched closer means
  // the string cannot be trusted past that point) and the JSON.parse retry still fails, so
  // normalizeToolArgs must not throw -- it falls back to the pre-existing safe behavior of
  // wrapping the raw string as one entity for the CLI to reject cleanly.
  const broken = '[}{"affinity":"fire"';
  assert.doesNotThrow(() => delverOf(broken));
  const out = delverOf(broken);
  assert.deepEqual(out, [broken]);
});
