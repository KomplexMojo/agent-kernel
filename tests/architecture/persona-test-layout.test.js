/**
 * P2.6 / P5.2 — persona tests live under their persona, and this is CHECKED.
 *
 * Charter §6 (rule "Tests align to personas"): persona behavior tests live in
 * `tests/personas/<persona>/` and are named `<persona>-<behavior>.test.*`.
 *
 * WHY A GUARD AND NOT JUST A MIGRATION. 47 files were moved out of a flat
 * `tests/personas/` on 2026-08-13. Nothing stopped them being written flat in the
 * first place, and nothing would stop the 48th — a convention that lives only in a
 * charter sentence is a convention that decays one hurried file at a time. This
 * branch has now watched every instrument it owns go stale while a green suite said
 * otherwise (the `.mts` READMEs, the orphaned allowlist dispositions, the registry's
 * two-day-stale CR.4 entry). The lesson each time was the same: the rule has to be
 * runnable, or it is a hope.
 *
 * WHAT IT FORBIDS — the CAPABILITY, not one spelling of it. Any test file directly
 * under `tests/personas/` fails, whatever it is called, and any test nested under
 * `tests/personas/<persona>/` whose name does not start with `<persona>-` fails.
 * Checking instead for the specific 47 names that were moved would pass the moment
 * someone adds the 48th, which is the only failure that matters.
 *
 * THE CROSS-PERSONA EXCEPTIONS ARE NAMED, NOT PATTERNED. Four files assert behavior
 * that spans the whole roster and so have no single persona home: the tick FSM, the
 * tick orchestrator, tick inspection, and the dual-surface (build-plane vs
 * tick-plane) shadowing test. They stay flat DELIBERATELY. They are listed by name
 * below rather than matched by a prefix rule so that adding a fifth is an edit to
 * this list — a decision someone makes on purpose — instead of a filename that
 * happens to slip through a pattern.
 *
 * WHAT THIS DELIBERATELY DOES NOT CHECK: whether the test inside is a behavior test
 * or a label-only one. That is charter §6's other half, and it is a judgement about
 * assertions, not a fact about paths. `persona-authority.test.js` is where ownership
 * is answered; claiming it here would make this guard read like coverage it has not
 * got — the exact failure mode the registry exists to prevent.
 */
const assert = require("node:assert/strict");
const { readdirSync } = require("node:fs");
const { resolve } = require("node:path");

const { CHARTER_PERSONAS } = require("./persona-authority-registry.js");

const ROOT = resolve(__dirname, "../..");
const PERSONA_TESTS = resolve(ROOT, "tests/personas");

/**
 * Files that legitimately sit flat because they span the roster. Named, not
 * patterned — see the header. Each carries why it cannot live under one persona.
 */
const CROSS_PERSONA_FILES = Object.freeze({
  "tick-state-machine.test.js":
    "the shared tick FSM itself — every persona advances through it, none owns it",
  "tick-orchestrator.test.js":
    "phase dispatch ACROSS the roster; keyed by no single persona",
  "tick-inspect.test.js":
    "reads the personaViews of all seven to build the inspection view",
  "dual-surface-shadowing.test.js":
    "PX.5 — the build plane vs tick plane split, which is a claim about two planes "
    + "rather than about one persona",
});

const isTestFile = (name) => /\.test\.[a-z]+$/.test(name);

test("no persona test sits flat in tests/personas/ unless it is a named cross-persona file", () => {
  const flat = readdirSync(PERSONA_TESTS, { withFileTypes: true })
    .filter((entry) => entry.isFile() && isTestFile(entry.name))
    .map((entry) => entry.name);

  const unexpected = flat.filter((name) => !(name in CROSS_PERSONA_FILES));

  assert.deepEqual(
    unexpected,
    [],
    `charter §6: persona behavior tests live in tests/personas/<persona>/. These sit `
      + `flat and belong to a persona: ${unexpected.join(", ")}. If one genuinely spans `
      + `the roster, add it to CROSS_PERSONA_FILES with the reason it has no home.`,
  );
});

test("every named cross-persona exception still exists", () => {
  const flat = new Set(
    readdirSync(PERSONA_TESTS, { withFileTypes: true })
      .filter((entry) => entry.isFile() && isTestFile(entry.name))
      .map((entry) => entry.name),
  );

  // An exception list that outlives the file it excuses is the orphaned-disposition
  // failure this repo has recorded four times: the entry keeps describing a state
  // that ended, and nothing re-reads it. A stale allowance is how a rule quietly
  // widens, so the list has to shrink when its subject does.
  const orphaned = Object.keys(CROSS_PERSONA_FILES).filter((name) => !flat.has(name));

  assert.deepEqual(
    orphaned,
    [],
    `CROSS_PERSONA_FILES excuses files that are no longer there: ${orphaned.join(", ")}. `
      + `Remove the entry in the same diff that moved or deleted the file.`,
  );
});

test("a test under tests/personas/<persona>/ is named <persona>-<behavior>.test.*", () => {
  const misnamed = [];

  for (const persona of CHARTER_PERSONAS) {
    const dir = resolve(PERSONA_TESTS, persona);
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue; // a persona with no behavior tests yet is the registry's problem, not this guard's
    }
    for (const entry of entries) {
      if (!entry.isFile() || !isTestFile(entry.name)) continue;
      if (!entry.name.startsWith(`${persona}-`)) {
        misnamed.push(`tests/personas/${persona}/${entry.name}`);
      }
    }
  }

  assert.deepEqual(
    misnamed,
    [],
    `charter §6: persona behavior tests are named <persona>-<behavior>.test.*. `
      + `Misnamed: ${misnamed.join(", ")}.`,
  );
});

test("no directory under tests/personas/ is named for something that is not a chartered persona", () => {
  // A stray directory is how the convention gets a second, undeclared home: a
  // `tests/personas/budget/` would satisfy "not flat" while belonging to no persona,
  // and the roster check above would never look inside it.
  const roster = new Set(CHARTER_PERSONAS);
  const strays = readdirSync(PERSONA_TESTS, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => !roster.has(name));

  assert.deepEqual(
    strays,
    [],
    `tests/personas/ subdirectories must be chartered personas (${[...roster].join(", ")}). `
      + `Found: ${strays.join(", ")}.`,
  );
});
