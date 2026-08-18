/**
 * G1.C — is every CHARTERED responsibility claimed by a registry entry?
 *
 * 🔴 THE GAP THIS CLOSES. The strongest coverage assertion the project had was
 * `persona-authority.test.js`'s *"every charter persona has at least one registered
 * behavior"* — **one entry per PERSONA, not one per RESPONSIBILITY**. A chartered
 * responsibility with no G1 entry was therefore invisible, and the suite stayed green.
 *
 * That is not a hypothetical. `orchestrator/deferred-side-effects` and
 * `allocator/reconciliation` sat in the charter's persona table, and in three READMEs,
 * while **neither existed in the tree at all** — through every green run — until P5.5 read
 * that table by hand. This file is that hand-read, made mechanical.
 *
 * ── WHY THE ROSTER IS WRITTEN OUT AND NOT PARSED ──────────────────────────────
 * Deriving responsibilities by regex over the persona table would be a guard matching a
 * SPELLING, which is the failure class this repo has recorded six times. Three rows break
 * it outright: the Annotator's carries NEGATIVE clauses ("spend auditing is **not**
 * Annotator work") that a naive split turns into phantom responsibilities the registry
 * would then be required to prove; the Director's is an arrow chain; the Moderator's
 * embeds a clarification.
 *
 * So the roster is enumerated in the charter, and this file instead FINGERPRINTS each
 * persona row. Reword a row and `the persona table has not changed under the roster`
 * fails — the roster cannot silently fall behind the prose it mirrors. A guard that
 * cannot read prose should say so by failing on any change, not by guessing which
 * changes matter.
 *
 * ── WHAT THIS DOES NOT CLAIM ──────────────────────────────────────────────────
 * That a responsibility is CLAIMED, not that the claim is TRUE. Ownership is A1–A5's
 * question and every entry still needs its own G1 proof. Registration coverage is not
 * ownership coverage, and conflating them would make this read like far more than it is.
 */
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { createHash } = require("node:crypto");
const { resolve } = require("node:path");

const { REGISTRY } = require("./persona-authority-registry.js");

const CHARTER = resolve(__dirname, "../../docs/architecture-charter.md");

/**
 * Roster ids with NO registry entry — the backlog this guard exists to expose.
 *
 * ⚠️ **This list is an inventory of debt, not a silencer**, and it is the same device as
 * `OPEN_FINDINGS` and the schema guard's `KNOWN_OUTSTANDING`. It may only SHRINK: adding
 * an id here to make the suite green is the failure the registry's own premise
 * ("assumed NOT owned until an entry says otherwise") was written against.
 *
 * Every one of these was found by writing the roster. None was known before.
 */
/**
 * ⚠️ Empty as of 2026-08-18. `configurator/pools`, the only remaining entry, was removed
 * from the roster itself rather than closed here — decision D8-V (2026-08-08) had already
 * ruled the adjacent mechanism (pool-catalog validation) shared vocabulary, not persona
 * authority, months before this list called its absence a gap. See the charter's own note
 * at the `configurator/pools` removal site for the full reasoning. An empty object here
 * means the roster and the registry currently partition cleanly with nothing outstanding —
 * not that nothing will ever need this list again.
 */
const KNOWN_UNREGISTERED = Object.freeze({});

/**
 * Normalized fingerprints of each persona table row, recorded 2026-08-14.
 *
 * Regenerate ONLY when the roster above has been reconciled with the new prose — that
 * reconciliation is the entire point, and updating these to make the suite green without
 * re-reading the roster reintroduces exactly the drift this guard exists to catch.
 */
const PERSONA_ROW_FINGERPRINTS = Object.freeze({
  orchestrator: "f6592f7057d2671a",
  director: "bd007e8f08544c3b",
  configurator: "815ec79abb301c91",
  allocator: "4e0c673af359ccbf",
  actor: "b96b3a6e3bbde10d",
  moderator: "bfc2b7133a019501",
  annotator: "d3206efbd004e5e5",
});

function charterSource() {
  return readFileSync(CHARTER, "utf8");
}

/** The roster ids, read from the delimited block in the charter. */
function rosterIds(src = charterSource()) {
  const block = src.match(/<!-- CHARTER-ROSTER:BEGIN -->([\s\S]*?)<!-- CHARTER-ROSTER:END -->/);
  assert.ok(block, "the charter's CHARTER-ROSTER block is missing — the roster is the origin here");
  return [...block[1].matchAll(/^\| `([^`]+)` \|/gm)].map((m) => m[1]);
}

function personaRowFingerprints(src = charterSource()) {
  const out = {};
  for (const m of src.matchAll(/^\| \*\*([A-Z][a-z]+)\*\* \| (.+?) \| (.+?) \|$/gm)) {
    const normalized = `${m[2]} | ${m[3]}`.replace(/\s+/g, " ").trim();
    out[m[1].toLowerCase()] = createHash("sha256").update(normalized).digest("hex").slice(0, 16);
  }
  return out;
}

/** Entries that discharge a persona-table responsibility (not the numbered rules). */
const PERSONA_ENTRIES = REGISTRY.filter((entry) => !entry.id.startsWith("all/"));

test("the roster is non-empty and every id is well-formed", () => {
  const ids = rosterIds();
  assert.ok(ids.length > 0, "precondition: an empty roster would make every assertion below vacuous");
  for (const id of ids) {
    assert.match(id, /^[a-z]+\/[a-z-]+$/, `roster id "${id}" is not <persona>/<responsibility>`);
  }
  assert.equal(new Set(ids).size, ids.length, "roster ids must be unique");
});

test("every chartered responsibility is claimed by a registry entry, or declared unregistered", () => {
  const ids = rosterIds();
  const claimed = new Set(PERSONA_ENTRIES.map((entry) => entry.chartered).filter(Boolean));

  const silentlyUnclaimed = ids.filter((id) => !claimed.has(id) && !(id in KNOWN_UNREGISTERED));
  assert.deepEqual(
    silentlyUnclaimed,
    [],
    "chartered responsibilities with no registry entry and no declared reason. This is the exact "
      + "state that let two chartered behaviors sit unbuilt through every green run: add an entry, "
      + "or record WHY there is none — but it must not be silent",
  );
});

test("the unregistered backlog only names real roster ids", () => {
  const ids = new Set(rosterIds());
  const orphans = Object.keys(KNOWN_UNREGISTERED).filter((id) => !ids.has(id));
  assert.deepEqual(
    orphans,
    [],
    "backlog entries for responsibilities the charter no longer names. A row that outlives its "
      + "subject reads as tracked work that does not exist — the orphaned-disposition failure this "
      + "repo has recorded five times, and it always fails in the safe-looking direction",
  );

  const claimed = new Set(PERSONA_ENTRIES.map((entry) => entry.chartered).filter(Boolean));
  const stale = Object.keys(KNOWN_UNREGISTERED).filter((id) => claimed.has(id));
  assert.deepEqual(
    stale,
    [],
    "backlog entries for responsibilities that now HAVE a registry entry. The list may only "
      + "shrink, and it does not shrink itself",
  );
});

test("every persona registry entry names a chartered responsibility that exists", () => {
  const ids = new Set(rosterIds());

  const missing = PERSONA_ENTRIES.filter((entry) => !entry.chartered).map((entry) => entry.id);
  assert.deepEqual(
    missing,
    [],
    "registry entries with no `chartered` field. An entry that names no charter responsibility "
      + "cannot be counted toward coverage, so it would be ownership nobody asked for",
  );

  const dangling = PERSONA_ENTRIES
    .filter((entry) => entry.chartered && !ids.has(entry.chartered))
    .map((entry) => `${entry.id} -> ${entry.chartered}`);
  assert.deepEqual(dangling, [], "registry entries citing a roster id the charter does not declare");
});

test("the persona table has not changed under the roster", () => {
  const live = personaRowFingerprints();

  assert.deepEqual(
    Object.keys(live).sort(),
    Object.keys(PERSONA_ROW_FINGERPRINTS).sort(),
    "the set of persona rows changed — a persona was added or removed from the charter table",
  );

  const drifted = Object.keys(live).filter((persona) => live[persona] !== PERSONA_ROW_FINGERPRINTS[persona]);
  assert.deepEqual(
    drifted,
    [],
    "a persona table row was reworded without the roster being revisited. This guard cannot read "
      + "prose, so it fails on ANY change rather than guessing which changes matter: re-read the "
      + "row, reconcile the roster below it, then update the fingerprint in the same diff",
  );
});

test("the coverage is measured: report claimed vs unregistered", () => {
  const ids = rosterIds();
  const claimed = new Set(PERSONA_ENTRIES.map((entry) => entry.chartered).filter(Boolean));
  const covered = ids.filter((id) => claimed.has(id));

  // Not pinned to an exact number — that would fail on every legitimate addition and teach
  // people to edit the test. What is pinned is that the two sets PARTITION the roster, so
  // nothing can fall out of both and be counted as neither.
  assert.equal(
    covered.length + Object.keys(KNOWN_UNREGISTERED).length,
    ids.length,
    "every chartered responsibility must be either claimed or declared unregistered, never neither",
  );
  assert.ok(covered.length > 0, "precondition: a roster nothing claims would make this vacuous");
});

// ## TODO: Test Permutations
// - a roster id added to the charter with no entry and no backlog reason
// - a registry entry whose `chartered` names a deleted roster id
// - a persona row reworded by whitespace only (must still fail — the fingerprint is normalized,
//   so this one specifically should NOT fail, and that is worth pinning)
// - a persona removed from the charter table entirely
// - two entries claiming the same roster id (legal — director/plan-to-buildspec has three)
