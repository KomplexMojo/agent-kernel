/**
 * PX.3 — a persona's clock is INJECTED, never defaulted.
 *
 * Every persona controller and state machine used to declare
 * `clock = () => new Date().toISOString()`, so a caller that forgot to inject one
 * still "worked" — and silently read wall-clock time. That is the failure mode this
 * program keeps finding: not a crash, but a quiet degradation of determinism and
 * replay that no output gate can see, because the output is still well-formed.
 *
 * It is the same defect class as CR.1's `DEFAULT_ACTION_COST = 1` in core-ts — a
 * defaulted price and a defaulted clock are one mistake wearing two hats — and the
 * charter's Economy section already states the rule for the other half: "an
 * incomplete price list is a structured error, never a quiet default." The clock
 * gets the same treatment.
 *
 * >>> DECISION D-o: REQUIRED, THROWING — not a sentinel that "fails loud under
 * test". A sentinel has to detect its environment to know when to complain, and
 * implicit environment-dependent behavior is precisely what this program has been
 * removing. A missing clock is a construction error at every call site, so it is
 * reported at construction.
 *
 * Validation lives in each persona's STATE MACHINE rather than its controller:
 * every controller constructs one, and it is where `clock()` is first called, so a
 * single check per persona covers both entry points.
 *
 * core-ts cannot use this helper — `runtime` must never be imported by `core-ts`
 * (dependency direction is non-negotiable) — so it enforces the same rule with its
 * own code. "One guard" in the WP-1 sense is the architectural test asserting
 * neither default has come back, not a shared function.
 *
 * ⚠️ PLAIN JS ON PURPOSE. The neighbouring `.mts` files in this directory are also
 * plain JavaScript — `.mts` here means "ESM module", not "TypeScript" — and they are
 * loaded by plain Node through the CLI's execution path, which does not strip types.
 * An earlier version of this file used real TS annotations and broke 100+ test files
 * with "SyntaxError: Unexpected reserved word". Do not add type annotations here.
 */

/** Raised when a persona is constructed without an injected clock. */
export class PersonaClockError extends Error {
  constructor(persona) {
    super(
      `${persona} requires an injected clock: pass { clock } returning an ISO-8601 UTC string. `
        + "Personas never read the wall clock — a defaulted clock degrades determinism and replay "
        + "silently (finding PX.3).",
    );
    this.name = "PersonaClockError";
    this.code = "persona_clock_required";
    this.persona = persona;
  }
}

/**
 * Validate an injected clock, returning it unchanged.
 *
 * @param {unknown} clock the injected clock function
 * @param {string} persona the persona name, for the error message
 * @returns {() => string}
 */
export function requireClock(clock, persona) {
  if (typeof clock !== "function") {
    throw new PersonaClockError(persona);
  }
  return clock;
}

/**
 * A clock for constructions that exist ONLY to reach a pure function — mostly
 * `createAllocatorPersona().pricing.priceMap()` and friends, where the persona is
 * being used as a namespace and no round is ever run.
 *
 * **This is a marker, not a convenience.** It exists so those sites are greppable
 * rather than hidden behind an inline literal, because they are a smell in their own
 * right: a persona constructed to call a pure function is not a persona, and
 * `budget-fulfillment.js` already says as much in a comment ("only the items matter
 * for the map, so the default's meta/clock is irrelevant"). The proper fix is to
 * expose that pricing surface without constructing a persona; until then this makes
 * the count visible — `rg UNUSED_CLOCK` is the census.
 *
 * Safe by construction: goldens are byte-identical run-to-run *while* personas
 * defaulted to a real wall clock, which proves the persona clock never reaches a
 * persisted artifact. If that ever stops being true, these sites surface as a golden
 * diff rather than drifting silently.
 */
export const UNUSED_CLOCK = () => "1970-01-01T00:00:00.000Z";
