/**
 * P5.3 — each persona README states its A1–A5 status, and the statement is CHECKED.
 *
 * The charter's rule is that a chartered behavior with no G1 test is not owned. That
 * status already has one origin — `persona-authority-registry.js` — and P5.3 puts it in
 * front of the reader who is about to change a persona, i.e. in its README. Copying a
 * status into prose is how a second origin starts, and this repository has watched that
 * happen enough times to stop pretending a doc stays true because someone meant it to:
 * seven persona READMEs asserted `.mts` was canonical long after `.js` became it, and the
 * registry itself spent two days reporting a behavior as blocked by a finding that had
 * closed. Prose cannot be run. A block that a test parses can.
 *
 * So the README does not RESTATE the registry — it MIRRORS it, and this guard fails when
 * the mirror is wrong. Each persona README carries:
 *
 *     <!-- A1-A5-STATUS:actor -->
 *     | `actor/no-budget-policy` | A1 | ✅ owned … | `tests/…` |
 *     <!-- /A1-A5-STATUS -->
 *
 * and the checks below require, for that persona's entries and no others:
 *   1. every registry entry for the persona appears, and no entry belonging to another
 *      persona does (a copy-paste between READMEs is the obvious failure mode);
 *   2. the row's criteria match the registry's criteria — the column that says WHICH
 *      ownership question was answered, and the easiest one to leave stale;
 *   3. an owned row says "owned" and names the proof the registry cites, so a reader
 *      can open the test rather than trust the tick;
 *   4. a blocked row says "blocked" and names the finding that blocks it.
 *
 * WHAT THIS DELIBERATELY DOES NOT CHECK: whether the prose around the block is true.
 * That is a review question, and claiming otherwise would make this guard read like
 * coverage it does not have — the failure mode it exists to prevent.
 */
const assert = require("node:assert/strict");
const { existsSync, readFileSync } = require("node:fs");
const { resolve } = require("node:path");

const {
  CHARTER_PERSONAS,
  REGISTRY,
  isOwned,
  blockingFinding,
} = require("./persona-authority-registry.js");

const ROOT = resolve(__dirname, "../..");

const readmePath = (persona) => `packages/runtime/src/personas/${persona}/README.md`;

const OPEN_MARKER = (persona) => `<!-- A1-A5-STATUS:${persona} -->`;
const CLOSE_MARKER = "<!-- /A1-A5-STATUS -->";

function statusBlock(persona) {
  const path = resolve(ROOT, readmePath(persona));
  assert.ok(existsSync(path), `${persona}: no README at ${readmePath(persona)}`);
  const source = readFileSync(path, "utf8");

  const open = source.indexOf(OPEN_MARKER(persona));
  assert.ok(
    open !== -1,
    `${persona}: README has no A1-A5 status block. Add ${OPEN_MARKER(persona)} … ${CLOSE_MARKER} `
      + "listing this persona's registry entries — P5.3 requires every persona README to state "
      + "which chartered behaviors have a passing G1 test and which do not.",
  );
  const close = source.indexOf(CLOSE_MARKER, open);
  assert.ok(close !== -1, `${persona}: A1-A5 status block is opened but never closed`);

  return source.slice(open + OPEN_MARKER(persona).length, close);
}

/** The block's row for one entry — the line that names it. */
function rowFor(block, id) {
  return block
    .split("\n")
    .find((line) => line.includes(`\`${id}\``)) ?? null;
}

test("every persona README carries an A1-A5 status block", () => {
  for (const persona of CHARTER_PERSONAS) {
    assert.ok(statusBlock(persona).trim().length > 0, `${persona}: the status block is empty`);
  }
});

test("each block lists exactly the registry entries that belong to that persona", () => {
  for (const persona of CHARTER_PERSONAS) {
    const block = statusBlock(persona);
    const expected = REGISTRY.filter((entry) => entry.persona === persona).map((entry) => entry.id);
    const found = REGISTRY.filter((entry) => rowFor(block, entry.id)).map((entry) => entry.id);

    assert.deepEqual(
      found.slice().sort(),
      expected.slice().sort(),
      `${persona}: the README's A1-A5 block and the registry disagree about which behaviors `
        + "this persona owns. Missing rows under-report the backlog; extra rows claim another "
        + "persona's proof. Regenerate the block from persona-authority-registry.js.",
    );
  }
});

test("each row states the criteria the registry records for that behavior", () => {
  for (const entry of REGISTRY) {
    const row = rowFor(statusBlock(entry.persona), entry.id);
    for (const criterion of entry.criteria) {
      assert.ok(
        row.includes(criterion),
        `${entry.id}: the README row does not name ${criterion}. The criteria column says which `
          + "ownership question was answered — a row that drops one claims more than the G1 test proves.",
      );
    }
    // And nothing it does not carry: A2 is the load-bearing criterion, so a row that
    // silently gains it reads as "production breaks without this persona" on evidence
    // that never tested that.
    for (const criterion of ["A1", "A2", "A3", "A4", "A5"]) {
      if (entry.criteria.includes(criterion)) continue;
      assert.ok(
        !row.includes(criterion),
        `${entry.id}: the README row claims ${criterion}, which the registry does not record for it`,
      );
    }
  }
});

test("an owned row says so and names the proof the registry cites", () => {
  for (const entry of REGISTRY.filter(isOwned)) {
    const row = rowFor(statusBlock(entry.persona), entry.id);
    assert.match(row, /owned/i, `${entry.id}: registry says owned; the README row does not`);
    assert.doesNotMatch(
      row,
      /blocked/i,
      `${entry.id}: the README row reads as blocked while the registry says owned`,
    );

    // The proof is the point of the claim. Entries prove themselves either by a cited
    // file or by a `G1 <id>:` test inside persona-authority.test.js.
    const proof = entry.status.provenBy ?? "tests/architecture/persona-authority.test.js";
    // Backticked, i.e. the WHOLE path and nothing appended. A substring check passed a
    // perturbation that renamed the cited file to `…test.js.OLD`, which is exactly the
    // "close enough to read as true" drift this guard is for.
    assert.ok(
      row.includes(`\`${proof}\``),
      `${entry.id}: the README row must name its proof as \`${proof}\` so a reader can open the `
        + "test instead of trusting the tick",
    );
  }
});

test("a blocked row says so and names the finding that blocks it", () => {
  for (const entry of REGISTRY.filter((candidate) => blockingFinding(candidate))) {
    const row = rowFor(statusBlock(entry.persona), entry.id);
    assert.match(row, /blocked/i, `${entry.id}: registry says blocked; the README row does not`);
    assert.ok(
      row.includes(blockingFinding(entry)),
      `${entry.id}: the README row must name ${blockingFinding(entry)} — a backlog row that does not `
        + "say what it waits on is a promise, and this board has recorded four of those",
    );
  }
});

// ## TODO: Test Permutations
// - a README whose block names an id that is not in the registry at all (today the
//   set-equality check catches it only because every id in the block is a registry id)
// - two personas' blocks opened with the same marker in one file
