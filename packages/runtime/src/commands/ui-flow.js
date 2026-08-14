// CR.7 / WP-5 — the vocabulary comes from CONTRACTS, not from the Orchestrator's alias of
// it. `prompt-contract.js` only renamed these (P5.1 D1: one value, three names), so the
// boundary crossing died with the hop rather than being republished. Aliased on import so
// the call sites below are untouched.
// Genuinely Orchestrator law — the prompt contract itself — so taken from its barrel.
import { deriveAllowedOptionsFromCatalog } from "../personas/orchestrator/persona.js";
import { beginDirectorRound } from "./director-round.js";
import { createConfiguratorPersona } from "../personas/configurator/persona.js";
import { UNUSED_CLOCK } from "../personas/_shared/require-clock.js";
import {
  BUDGET_ARTIFACT_SCHEMA,
  PRICE_LIST_SCHEMA,
} from "../contracts/artifacts.ts";

// D8.3 — the Director refuses to derive level geometry from room cards; it asks the
// Configurator. The PUBLIC persona barrel, so this glue crosses no boundary. UNUSED_CLOCK
// because neither method stamps a timestamp: they read a card set and return geometry.
const configurator = createConfiguratorPersona({ clock: UNUSED_CLOCK });
const configuratorRoomGeometry = Object.freeze({
  deriveRoomLayout: configurator.deriveRoomLayout,
  buildRoomDesign: configurator.buildRoomDesign,
});

function cloneJson(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function normalizeArrayField(container, key) {
  if (!container || typeof container !== "object") return { changed: false };
  const value = container[key];
  if (value === undefined) return { changed: false };
  if (Array.isArray(value)) return { changed: false };
  if (value && typeof value === "object") {
    container[key] = [value];
    return { changed: true };
  }
  return { changed: false };
}

function normalizeRepeatableField(container, key) {
  if (!container || typeof container !== "object") return { changed: false };
  const value = container[key];
  if (value === undefined || Array.isArray(value)) return { changed: false };
  container[key] = [value];
  return { changed: true };
}

function normalizeAgentHints(hints) {
  if (!hints || typeof hints !== "object" || Array.isArray(hints)) return { changed: false };
  let changed = false;
  if (normalizeArrayField(hints, "rooms").changed) changed = true;
  if (normalizeArrayField(hints, "actors").changed) changed = true;
  if (normalizeArrayField(hints, "actorGroups").changed) changed = true;
  return { changed };
}

function normalizeArtifactRef(ref, schema) {
  if (ref === undefined || ref === null) return { value: ref, changed: false };
  if (typeof ref === "string" || typeof ref === "number") {
    return { value: { id: String(ref), schema, schemaVersion: 1 }, changed: true };
  }
  if (ref && typeof ref === "object" && !Array.isArray(ref)) {
    let changed = false;
    if (!ref.schema) {
      ref.schema = schema;
      changed = true;
    }
    if (!Number.isInteger(ref.schemaVersion)) {
      ref.schemaVersion = 1;
      changed = true;
    }
    return { value: ref, changed };
  }
  return { value: ref, changed: false };
}

export function normalizeBuildSpecForUi(specInput) {
  if (!specInput || typeof specInput !== "object") {
    return { spec: specInput, changed: false };
  }

  const spec = cloneJson(specInput);
  let changed = false;

  if (spec.intent?.hints) {
    if (normalizeAgentHints(spec.intent.hints).changed) changed = true;
  }
  if (spec.configurator?.inputs) {
    if (normalizeAgentHints(spec.configurator.inputs).changed) changed = true;
  }
  if (spec.authoring && typeof spec.authoring === "object" && !Array.isArray(spec.authoring)) {
    if (normalizeRepeatableField(spec.authoring, "objectKinds").changed) changed = true;
    const request = spec.authoring.request;
    if (request && typeof request === "object" && !Array.isArray(request)) {
      if (normalizeArrayField(request, "objects").changed) changed = true;
      if (request.compilation && typeof request.compilation === "object" && !Array.isArray(request.compilation)) {
        if (normalizeArrayField(request.compilation, "rules").changed) changed = true;
        const rules = Array.isArray(request.compilation.rules) ? request.compilation.rules : [];
        rules.forEach((rule) => {
          if (normalizeArrayField(rule, "compileTo").changed) changed = true;
        });
      }
    }
  }

  if (spec.budget && typeof spec.budget === "object" && !Array.isArray(spec.budget)) {
    const budgetRef = normalizeArtifactRef(spec.budget.budgetRef, BUDGET_ARTIFACT_SCHEMA);
    if (budgetRef.changed) {
      spec.budget.budgetRef = budgetRef.value;
      changed = true;
    }
    const priceListRef = normalizeArtifactRef(spec.budget.priceListRef, PRICE_LIST_SCHEMA);
    if (priceListRef.changed) {
      spec.budget.priceListRef = priceListRef.value;
      changed = true;
    }
  }

  return { spec, changed };
}

/**
 * CR.7 / WP-5 (2026-08-12) — assembly runs through the Director, not around it.
 *
 * This imported `buildspec-assembler.js` directly and was one of the last two allowlist
 * rows. `assembleBuildSpec` is FSM-gated and COMPLETES the build round, so closing the row
 * means the UI/worker path now opens a real Director round — the "artifact produced with no
 * round" fix (CR.3/P2) reaching the last surface that lacked it.
 *
 * ⚠️ `director` IS THREADED IN WHEN THE CALLER ALREADY HAS ONE. `runPoolFlow` below opens a
 * round for `mapPool`/`enforceBudget` and hands it here; opening a second round for the same
 * build is the defect the gate exists to catch, not a convenience. Callers with no round —
 * `ui-web/card-builder-controller.js` and the cli-worker — get one opened for them.
 *
 * ⚠️ `roomGeometry` STAYS EXPLICIT. `beginDirectorRound` builds a Director with no
 * Configurator injected, so the persona's own `roomGeometry()` answers `undefined`, and a
 * summary carrying room cards would be REFUSED where it builds today. This is a behavioural
 * seam, not a style choice: `configuratorRoomGeometry` here is the same
 * `{ deriveRoomLayout, buildRoomDesign }` pair the persona would supply, taken from the
 * Configurator's public barrel.
 */
export function buildSpecFromSummaryFlow({
  summary,
  catalog,
  selections,
  runId,
  source = "ui",
  createdAt,
  clock,
  director: openRound,
} = {}) {
  if (!summary || typeof summary !== "object") {
    return { ok: false, reason: "missing_summary", errors: ["Summary is required."] };
  }
  // Maintainer decision 1: derive the instant from the clock, refuse only when the caller
  // has neither. Checked here rather than caught from the round because every refusal in
  // this flow is REPORTED as `{ ok, reason, errors }` — the browser reads that shape, and a
  // throw would surface as an unhandled rejection instead of a status message.
  const hasInstant = (typeof createdAt === "string" && createdAt.trim())
    || typeof clock === "function";
  if (!openRound && !hasInstant) {
    return {
      ok: false,
      reason: "missing_created_at",
      errors: [
        "createdAt (ISO-8601) or a clock is required: the Director stamps the round's "
        + "instant into the BuildSpec, and a persona never reads the wall clock.",
      ],
    };
  }

  const director = openRound
    ?? beginDirectorRound({ runId, createdAt, clock, goal: summary?.goal, producedBy: source });
  const built = director.assembleBuildSpec({
    summary,
    catalog,
    roomGeometry: configuratorRoomGeometry,
    selections,
    runId,
    source,
    createdAt,
    clock,
  });

  if (!built.ok || !built.spec) {
    return {
      ok: false,
      reason: "invalid_spec",
      errors: built.errors || [],
    };
  }

  return {
    ok: true,
    runId: built.spec.meta?.runId || runId || "",
    spec: built.spec,
    specText: JSON.stringify(built.spec, null, 2),
  };
}

export function runPoolFlow({
  summary,
  catalog,
  runId = "pool_ui_run",
  source = "pool-ui",
  createdAt,
} = {}) {
  if (!summary || typeof summary !== "object") {
    return { ok: false, reason: "missing_summary", errors: ["No summary loaded or provided."] };
  }
  if (!catalog || typeof catalog !== "object") {
    return { ok: false, reason: "missing_catalog", errors: ["No catalog loaded or provided."] };
  }
  // D8 follow-up 2026-08-08 — `createdAt` was optional while this flow mapped the pool by
  // importing `director/pool-mapper.js` directly. `director.mapPool` needs a build round,
  // and a round stamps a real timestamp into the plan it drafts, so a persona would have
  // to read the wall clock to make one up (PX.3). Reported rather than thrown because
  // every other refusal in this flow is `{ ok, reason, errors }` and its callers read that.
  if (typeof createdAt !== "string" || !createdAt.trim()) {
    return {
      ok: false,
      reason: "missing_created_at",
      errors: ["createdAt (ISO-8601) is required: the Director stamps it into the build round."],
    };
  }

  // The pool mapping is the Director's decision, and `mapPool` is FSM-gated behind an open
  // round. Until now this glue mapped summaries with no Director existing at all — the
  // "artifact produced with no round" defect, same as M5b.2a′ found in the budget loop.
  const director = beginDirectorRound({ runId, createdAt, producedBy: source });
  const mapped = director.mapPool({ summary, catalog });
  if (!mapped.ok) {
    return {
      ok: false,
      reason: "mapping_failed",
      errors: mapped.errors || [],
      allowed: deriveAllowedOptionsFromCatalog(catalog),
    };
  }

  // CR.7 / WP-5 — asked of the round already open two lines above, rather than imported out
  // of `director/budget-enforcer.js`. Trimming selections to a budget decides what reaches the
  // BuildSpec, so the published method is gated — and this caller is what exercises the gate.
  const enforced = director.enforceBudget({
    selections: mapped.selections,
    budgetTokens: summary.budgetTokens,
  });
  const built = buildSpecFromSummaryFlow({
    summary,
    catalog,
    selections: enforced.selections,
    runId,
    source,
    createdAt,
    // The round opened above, not a second one: mapPool → enforceBudget → assembleBuildSpec
    // is ONE Director round, and assembleBuildSpec is what closes it.
    director,
  });

  if (!built.ok) {
    return {
      ok: false,
      reason: built.reason || "invalid_spec",
      errors: built.errors || [],
      allowed: deriveAllowedOptionsFromCatalog(catalog),
      selections: enforced.selections,
      receipts: enforced.actions,
      spec: built.spec || null,
      specText: built.specText || "",
    };
  }

  return {
    ok: true,
    allowed: deriveAllowedOptionsFromCatalog(catalog),
    selections: enforced.selections,
    receipts: enforced.actions,
    spec: built.spec,
    specText: built.specText,
    runId: built.runId,
  };
}
