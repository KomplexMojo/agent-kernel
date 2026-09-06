/**
 * Spend proposal + card pricing — the Allocator's costing surface.
 *
 * ⚠️ RELOCATED 2026-08-04 from `personas/configurator/spend-proposal.js` (CR.9 M1).
 * It was never Configurator work: every export here prices or itemizes spend
 * (`buildSpendItems`, `buildSpendProposal`, `buildDesignSpendLedger`,
 * `evaluateConfiguratorSpend`, `calculateActorConfigurationUnitCost`,
 * `calculateRoomCardUnitCost`), it already imported FOUR Allocator modules, and
 * `calculateRoomCardUnitCost` is a 22-line wrapper over `allocator/layout-spend.js`.
 * Decisively: **no Configurator file imported it** — its consumers were this persona
 * and glue. Charter law is "the Allocator alone owns pricing"; the file's address was
 * the only thing that disagreed.
 *
 * This is the M1 half of CR.9's inversion: pricing comes home BEFORE the
 * propose/judge protocol lands, so the protocol is not built across a cycle.
 * Behavior-preserving — goldens are the parity gate.
 *
 * ✅ THE LAST CROSSING IS GONE (CR.9 M3). This module no longer imports
 * `configurator/motivation-loadouts.js`. Two things replaced it:
 *   1. Candidates from the Configurator's authoring surface arrive with
 *      `normalizedMotivations` already published, so the maximizer path prices only
 *      published fields — the property the finding is actually about.
 *   2. The paths that still receive RAW actor data from glue (spend ledgers,
 *      selection spend, `commands/card-authoring.js`) take the Configurator's
 *      `normalizeMotivations` INJECTED, and refuse without it.
 * `MOTIVATION_KIND_IDS` needed no crossing: it is a re-export of the contracts
 * vocabulary, so it is read from contracts directly.
 *
 * ⚠️ RESIDUE, recorded rather than closed. Decision (c) was settled as "the author
 * refuses; the pricer does not coerce": a card with contradictory motivations never
 * becomes a ConfigurationCandidate, so the maximizer will not grow it. But on these
 * raw-data paths `normalizeMotivations`'s `ok`/`errors` are still discarded and the
 * coerced `value` is still priced. Conflicting motivations therefore remain silently
 * costed outside the candidate path. That is a deliberate scope line for M3 — closing
 * it changes prices and is benchmark-relevant — not an oversight.
 *
 * ✅ THE DIRECTOR CROSSING IS GONE TOO (D8 follow-up, 2026-08-08). CR.9 M3's headline
 * ("the last crossing") was true of the Configurator and blind to the Director: this
 * module still imported `director/summary-selections.js` for `extractSummaryFromCardSet`,
 * pointing backwards along the order D8 settled (orchestrator → director → configurator
 * → allocator). It is now the injected `resolveSummary`, required-and-throwing on the
 * paths that actually carry cards — the same treatment `normalizeMotivations` got, for
 * the same reason. ⇒ *"The last crossing" is a claim about the crossings someone
 * enumerated, not about the file.*
 */
import { UNUSED_CLOCK } from "../_shared/require-clock.js";
import { buildPriceMap, normalizePriceItems, validateSpendProposal, calculatePriceTotal } from "./validate-spend.js";
// CR.9 M4: this module used to `import { createAllocatorPersona } from "./persona.js"`
// and construct a whole Allocator just to reach the default price map. That closed a
// real import CYCLE — persona → controller → allocator-services → budget-fulfillment →
// spend-proposal → persona — in which a leaf pricing module depended on its own
// persona's composition root. Node tolerates it (function bindings hoist), so nothing
// failed; under Vitest's module runner, two concurrent dynamic imports entering the
// cycle at different nodes DEADLOCK, which is how it was finally found: M4's gate imports
// `budget-fulfillment.js` and `persona.js` in one `Promise.all` and every test in the
// file timed out at 60s. Same shape as the recurring instrument problem on this branch —
// the defect was live for three milestones and no gate could see it.
//
// `buildDefaultPriceList` is what `pricing.priceMap()` resolves to when no list is
// injected, and `normalizePriceItems` reads only `items`, so the map is byte-identical.
// UNUSED_CLOCK is kept for the `rg UNUSED_CLOCK` census: still no wall-clock read here.
import { buildDefaultPriceList } from "./default-price-list.js";
import { evaluateLayoutSpend, evaluateRoomCardLayoutSpend } from "./layout-spend.js";
import { GAME_MOTIVATION_KIND_IDS as MOTIVATION_KIND_IDS } from "../../contracts/game-elements.js";
import { VITAL_KEYS, normalizeCardType } from "../../contracts/domain-constants.js";
// M8 relocated the two subject types this module names four times between them —
// `LayoutArtifact` and `ActorArtifact`, which are not artifacts anything writes but the
// type half of a spend line's `subjectRef`, naming what a charge is about. M9 finished the
// file: the `HazardArtifact` / `ResourceArtifact` / `SpendProposal` literals it left as
// tree-wide backlog now read from the same place.
import {
  ACTOR_ARTIFACT_SCHEMA,
  HAZARD_ARTIFACT_SCHEMA,
  LAYOUT_ARTIFACT_SCHEMA,
  RESOURCE_ARTIFACT_SCHEMA,
  SPEND_PROPOSAL_SCHEMA,
} from "../../contracts/artifacts.ts";
import { calculateMotivationStackCost } from "./motivation-price-policy.js";


function isInteger(value) {
  return Number.isInteger(value);
}

function readLayoutData(layout) {
  if (!layout) return {};
  return layout.data && typeof layout.data === "object" ? layout.data : layout;
}


const RESOURCE_PRICE_IDS = Object.freeze({
  consumable: "resource_base",
  level: "resource_level",
  permanent: "resource_permanent",
});

const AFFINITY_EXPRESSION_IDS = Object.freeze({
  push: "affinity_expression_externalize",
  pull: "affinity_expression_internalize",
  emit: "affinity_expression_localized",
  draw: "affinity_expression_sustain",
});
const VITAL_POINT_IDS = Object.freeze({
  health: "vital_health_point",
  mana: "vital_mana_point",
  stamina: "vital_stamina_point",
  durability: "vital_durability_point",
});
const VITAL_REGEN_IDS = Object.freeze({
  health: "vital_health_regen_tick",
  mana: "vital_mana_regen_tick",
  stamina: "vital_stamina_regen_tick",
  durability: "vital_durability_regen_tick",
});

const DELVER_KEYWORDS = Object.freeze(["delver", "attack", "attacking", "player", "assault", "intruder", "raider", "runner"]);
const WARDEN_KEYWORDS = Object.freeze(["warden", "defend", "defending", "stationary", "guard", "patrol", "patrolling", "sentry"]);

function buildSubjectRef(id, schema) {
  return {
    id: String(id || "unknown"),
    schema,
    schemaVersion: 1,
  };
}

function accumulateItem(counts, id, kind, quantity, { category, subjectRef, detail } = {}) {
  if (!Number.isInteger(quantity) || quantity <= 0) return;
  const subjectId = subjectRef?.id || "";
  const detailKey = detail === undefined ? "" : JSON.stringify(detail);
  const key = `${category || ""}:${subjectId}:${kind}:${id}:${detailKey}`;
  const existing = counts.get(key);
  if (existing) {
    existing.quantity += quantity;
    return;
  }
  counts.set(key, {
    id,
    kind,
    quantity,
    ...(category ? { category } : {}),
    ...(subjectRef ? { subjectRef } : {}),
    ...(detail !== undefined ? { detail } : {}),
  });
}

function countFloorTiles(layoutData) {
  if (Number.isInteger(layoutData?.floorTiles) && layoutData.floorTiles > 0) {
    return layoutData.floorTiles;
  }
  if (!Array.isArray(layoutData?.tiles)) {
    if (isInteger(layoutData?.width) && isInteger(layoutData?.height)) {
      return layoutData.width * layoutData.height;
    }
    return 0;
  }
  let count = 0;
  layoutData.tiles.forEach((rowValue) => {
    const row = String(rowValue || "");
    for (let i = 0; i < row.length; i += 1) {
      // Wall portals (S/E) are perimeter markers, not billable floor.
      if (row[i] !== "#" && row[i] !== "S" && row[i] !== "E") count += 1;
    }
  });
  if (count > 0) return count;
  if (isInteger(layoutData?.width) && isInteger(layoutData?.height)) {
    return layoutData.width * layoutData.height;
  }
  return 0;
}

function textBag(entry) {
  const values = [];
  ["id", "archetype", "actorType", "type", "kind", "role", "motivation", "source"].forEach((field) => {
    if (typeof entry?.[field] === "string") values.push(entry[field]);
  });
  if (Array.isArray(entry?.motivations)) {
    entry.motivations.forEach((motivation) => {
      if (typeof motivation === "string") values.push(motivation);
      if (motivation && typeof motivation === "object" && typeof motivation.kind === "string") values.push(motivation.kind);
    });
  }
  return values.join(" ").toLowerCase();
}

function inferActorCategory(actor) {
  const explicit = String(actor?.archetype || actor?.actorType || actor?.type || actor?.kind || "").toLowerCase();
  if (explicit === "delver") return "delvers";
  if (explicit === "warden") return "wardens";
  const bag = textBag(actor);
  if (DELVER_KEYWORDS.some((token) => bag.includes(token))) return "delvers";
  if (WARDEN_KEYWORDS.some((token) => bag.includes(token))) return "wardens";
  return undefined;
}

function extractAffinities(actor) {
  const entries = [];
  const affinityMap = actor?.traits?.affinities;
  if (affinityMap && typeof affinityMap === "object") {
    Object.entries(affinityMap).forEach(([key, stacks]) => {
      if (!Number.isInteger(stacks) || stacks <= 0) return;
      const [kind, expression] = key.split(":");
      if (!expression) return;
      entries.push({ kind, expression, stacks });
    });
  }
  const affinityList = Array.isArray(actor?.affinities) ? actor.affinities : [];
  affinityList.forEach((entry) => {
    if (!entry) return;
    const stacks = Number.isInteger(entry.stacks) ? entry.stacks : 1;
    if (stacks <= 0) return;
    const expression = entry.expression || entry.type;
    if (!expression) return;
    entries.push({ kind: entry.kind, expression, stacks });
  });
  return entries;
}

/**
 * Raised when the Allocator is asked to price raw motivations with no normalizer.
 *
 * CR.9 M3, decision D-o shape: REQUIRED AND THROWING, never a quiet fallback — the
 * same rule `AllocatorRoomGeometryError` enforces for room geometry. Motivation
 * vocabulary (which kinds exist, which are mutually exclusive, how intensity clamps)
 * is Configurator law. An Allocator-side default would be a second, silently-diverging
 * author of it, and the divergence would be invisible because the price stays a
 * well-formed number. That is the CR.1 defect class exactly.
 */
export class AllocatorMotivationVocabularyError extends Error {
  constructor() {
    super(
      "Allocator cannot price raw motivations without the Configurator's vocabulary: "
      + "pass { normalizeMotivations } from createConfiguratorPersona(), or supply a "
      + "candidate carrying `normalizedMotivations`. Motivation kinds and their "
      + "exclusive groups are Configurator rules (motivation-loadouts.js); the "
      + "Allocator prices them, it does not define them (finding CR.9).",
    );
    this.name = "AllocatorMotivationVocabularyError";
    this.code = "allocator_motivation_vocabulary_required";
  }
}

/**
 * Raised when the Allocator is handed a card set and no way to read it as a summary.
 *
 * D8 follow-up (2026-08-08). This module used to `import { extractSummaryFromCardSet }
 * from "../director/summary-selections.js"` — a persona importing another persona's
 * internals, and pointing the WRONG WAY along the order D8 settled
 * (orchestrator → director → configurator → allocator). Reading a card set as rooms,
 * hazards, resources and actors is intent translation: Director work. The Allocator
 * prices the result.
 *
 * Same shape as `AllocatorMotivationVocabularyError` and `AllocatorRoomGeometryError`:
 * REQUIRED AND THROWING, never a quiet fallback. An Allocator-side reimplementation
 * would be a second, silently-diverging author of the card vocabulary, and the
 * divergence would be invisible because the ledger stays a well-formed number.
 */
export class AllocatorSummaryResolutionError extends Error {
  constructor() {
    super(
      "Allocator cannot price a card set without the Director's translation: pass "
      + "{ resolveSummary } — `extractSummaryFromCardSet` from the Director — or supply "
      + "a summary that already carries resolved rooms/actors instead of cards. Reading "
      + "cards as picks is intent translation (summary-selections.js); the Allocator "
      + "prices them, it does not derive them (finding D8).",
    );
    this.name = "AllocatorSummaryResolutionError";
    this.code = "allocator_summary_resolution_required";
  }
}

/**
 * The summary to price.
 *
 * A summary that carries no card set needs no translation — the ledger reads its
 * `layout`/`rooms`/`actors` directly, which is the shape the Director already hands
 * back. A summary that DOES carry cards is unresolved, and resolving it is the
 * Director's job, injected by the composition root exactly as `normalizeMotivations`
 * is (CR.9 M3).
 */
function resolveLedgerSummary(summary, resolveSummary) {
  if (!summary || typeof summary !== "object" || Array.isArray(summary)) {
    return summary;
  }
  // Mirrors the Director's own `readCardSet`: `cardSet` wins when it is an array (even
  // an empty one), `cards` is the fallback spelling, and an empty set is nothing to
  // translate. An approximation here would refuse on inputs the Director accepts.
  const cards = Array.isArray(summary.cardSet)
    ? summary.cardSet
    : Array.isArray(summary.cards) ? summary.cards : null;
  if (!cards || cards.length === 0) {
    return { ...summary };
  }
  if (typeof resolveSummary !== "function") {
    throw new AllocatorSummaryResolutionError();
  }
  return resolveSummary(summary);
}

/**
 * The motivations to charge for.
 *
 * A candidate authored by the Configurator publishes `normalizedMotivations`, and
 * that field is taken as-is: it is the whole point of the propose/judge protocol that
 * the Allocator reads published fields rather than re-deriving them. Everything else
 * is raw glue data and needs the injected normalizer.
 */
function extractMotivations(actor, normalizeMotivations) {
  if (Array.isArray(actor?.normalizedMotivations)) {
    return actor.normalizedMotivations;
  }
  const rawList = actor?.motivations || actor?.traits?.motivations;
  if (typeof normalizeMotivations !== "function") {
    throw new AllocatorMotivationVocabularyError();
  }
  const { value } = normalizeMotivations(rawList);
  return value || [];
}

const RESOURCE_AFFINITY_EXPRESSION_IDS = Object.freeze({
  push: "resource_affinity_expression_externalize",
  pull: "resource_affinity_expression_internalize",
  emit: "resource_affinity_expression_localized",
  draw: "resource_affinity_expression_sustain",
});

/**
 * Prices the payloads a resource hands to whoever walks over it.
 *
 * These are the resource_* price ids, which carry the free-floating premium — a
 * resource grants power to any taker, unlike a hazard, which only threatens.
 *
 * The vital DELTA is deliberately absent here: it is already charged by
 * resource_base/level/permanent below, and charging it again would double-bill.
 * What was previously charged NOTHING, and is charged here, is the affinity payload
 * and the vital regen.
 */
function extractResourceGrantPriceEntries(resource) {
  const entries = [];

  const affinity = resource?.affinity;
  if (affinity && typeof affinity === "object") {
    const stacks = Number.isInteger(affinity.stacks) && affinity.stacks > 0 ? affinity.stacks : 1;
    entries.push({ priceId: "resource_affinity_base", quantity: 1 });
    entries.push({ priceId: "resource_affinity_stack", quantity: stacks });
    const expressionId = RESOURCE_AFFINITY_EXPRESSION_IDS[affinity.expression];
    if (expressionId) entries.push({ priceId: expressionId, quantity: 1 });
    const mana = Number.isFinite(affinity.mana) ? Math.abs(affinity.mana) : 0;
    if (mana > 0) entries.push({ priceId: "resource_vital_mana_point", quantity: mana });
    // Quadratic at the price list — this is what makes permanence expensive, and
    // therefore what makes permanent resources naturally scarce within a budget.
    const manaRegen = Number.isFinite(affinity.manaRegen) ? affinity.manaRegen : 0;
    if (manaRegen > 0) {
      entries.push({ priceId: "resource_vital_mana_regen_tick", quantity: manaRegen });
    }
  }

  const vitals = Array.isArray(resource?.vitals) ? resource.vitals : [];
  vitals.forEach((vital) => {
    const regen = Number.isFinite(vital?.regen) ? vital.regen : 0;
    if (regen > 0 && typeof vital?.key === "string") {
      entries.push({ priceId: `resource_vital_${vital.key}_regen_tick`, quantity: regen });
    }
  });

  return entries;
}

function extractResourcePriceEntries(resource) {
  // V3: { permanenceMode, vitals: [{ key, delta }] }
  if (resource?.permanenceMode && Array.isArray(resource.vitals)) {
    const priceId = RESOURCE_PRICE_IDS[resource.permanenceMode];
    if (!priceId) return [];
    return resource.vitals.map((v) => ({
      priceId,
      quantity: Math.abs(Number.isFinite(v?.delta) ? v.delta : 0),
    }));
  }
  if (resource?.resourceVitals && typeof resource.resourceVitals === "object") {
    const permanenceMode = resource.permanenceMode || (resource.permanent ? "permanent" : resource.tier) || "consumable";
    const priceId = RESOURCE_PRICE_IDS[permanenceMode] || RESOURCE_PRICE_IDS.consumable;
    return Object.values(resource.resourceVitals)
      .map((v) => Math.abs(Number.isFinite(v?.delta) ? v.delta : 0) + Math.abs(Number.isFinite(v?.regen) ? v.regen : 0))
      .filter((quantity) => quantity > 0)
      .map((quantity) => ({ priceId, quantity }));
  }
  // V1: { tier, delta }
  if (resource?.tier) {
    const priceId = RESOURCE_PRICE_IDS[resource.tier];
    if (!priceId) return [];
    return [{ priceId, quantity: Math.abs(Number.isFinite(resource.delta) ? resource.delta : 0) }];
  }
  if (Number.isInteger(resource?.budgetCeiling) && resource.budgetCeiling > 0) {
    return [{ priceId: RESOURCE_PRICE_IDS.consumable, quantity: resource.budgetCeiling }];
  }
  return [];
}

/**
 * A hazard's affinity payload, in whichever shape it arrives.
 *
 * ⚠️ CR.9 M5 — THIS IS WHY HAZARD AFFINITIES WERE FREE ON THE REAL BUILD PATH. The pricer
 * tested `typeof hazard.affinity === "object"`, but `ak create --hazard
 * "affinity=fire;expression=emit"` records `{ affinity: "fire", expression: "emit",
 * affinityStacks: [{ kind, expression, stacks, targetType }] }` — the kind as a STRING
 * beside a stacks array. The object branch never matched, so the whole payload cost
 * nothing: the g1 golden charged a delver 46 tokens for a fire/emit affinity and the
 * hazard beside it 0 for the same one.
 *
 * A charging path that matches one SHAPE of a payload is not a charging path for the
 * payload — the guard-spelling lesson, arriving in the economy. Both shapes are read here,
 * in one place, so a third shape has one obvious home rather than a second charging site.
 */
function readHazardAffinityStacks(hazard) {
  const stackList = Array.isArray(hazard?.affinityStacks) ? hazard.affinityStacks : [];
  if (stackList.length > 0) {
    return stackList
      .map((entry) => ({
        expression: entry?.expression || hazard?.expression,
        stacks: Number.isInteger(entry?.stacks) && entry.stacks > 0 ? entry.stacks : 1,
      }))
      .filter((entry) => entry.expression || entry.stacks > 0);
  }
  const affinity = hazard?.affinity;
  if (affinity && typeof affinity === "object") {
    return [{
      expression: affinity.expression,
      stacks: Number.isInteger(affinity.stacks) && affinity.stacks > 0 ? affinity.stacks : 1,
    }];
  }
  if (typeof affinity === "string" && affinity.length > 0) {
    return [{
      expression: hazard?.expression,
      stacks: Number.isInteger(hazard?.stacks) && hazard.stacks > 0 ? hazard.stacks : 1,
    }];
  }
  return [];
}

/**
 * A hazard's vitals, in whichever shape they arrive.
 *
 * Same mismatch as the affinity above: the pricer read `{ max, current, regen }` while the
 * CLI writes `{ kind: "one-time", amount: N }`, so a hazard's durability and mana grants
 * were free on the build path.
 */
function readHazardVitalCharges(hazard) {
  const vitals = hazard?.vitals;
  // V1/V2 HazardArtifact put the grants at the TOP LEVEL (`mana`, plus `durability` in
  // V1); only V3 nests them under `vitals`. `validateHazardArtifact` still accepts all
  // three, so a schema-valid V1/V2 hazard from any producer other than the CLI would get
  // its vitals free — the same shape mismatch this function exists to end, one version
  // back. The CLI itself always stamps `_schemaVersion: 3`, so this is unreachable through
  // `ak create`; it is fixed anyway because "unreachable today" is how the V3 gap survived.
  if (!vitals || typeof vitals !== "object") {
    return ["mana", "durability"]
      .map((key) => ({ key, points: Number.isInteger(hazard?.[key]) ? hazard[key] : 0, regen: 0 }))
      .filter((entry) => entry.points > 0);
  }
  return Object.keys(vitals)
    .map((key) => {
      const vital = vitals[key];
      if (!vital || typeof vital !== "object") return null;
      const points = Number.isInteger(vital.max)
        ? vital.max
        : Number.isInteger(vital.current)
          ? vital.current
          : Number.isInteger(vital.amount)
            ? vital.amount
            : 0;
      const regen = Number.isInteger(vital.regen) ? vital.regen : 0;
      if (points <= 0 && regen <= 0) return null;
      return { key, points, regen };
    })
    .filter(Boolean);
}

function buildSpendItems({ layoutData, actors, hazards, resources, normalizeMotivations }) {
  const counts = new Map();
  const hazardArray = Array.isArray(hazards) && hazards.length > 0
    ? hazards
    : Array.isArray(layoutData?.hazards) ? layoutData.hazards : [];
  const resourceArray = [
    ...(Array.isArray(resources) ? resources : []),
    ...(Array.isArray(layoutData?.resources) ? layoutData.resources : []),
  ];

  const isScaffold = layoutData?.budgetScaffold === true;
  const floorTiles = isScaffold ? 0 : countFloorTiles(layoutData);
  if (floorTiles > 0) {
    accumulateItem(counts, "tile_floor", "tile", floorTiles, {
      category: "floor_tiles",
      subjectRef: buildSubjectRef("layout", LAYOUT_ARTIFACT_SCHEMA),
    });
  }
  // CR.9 M5: the RECEIPT path charged floor tiles only, so an explicit
  // `{ floorTiles, hallwayTiles }` layout was billed for half of itself. This is the
  // second charging site for tiles — `layout-spend.js` is the other — and fixing one
  // without the other is how a payload comes to have two prices (CR.1's defect class).
  //
  // ⚠️ ONLY when the floor count is NOT derived. `countFloorTiles` has three modes: an
  // explicit `floorTiles` field, a `tiles` grid, or `width × height`. The last two count
  // every walkable cell — hallways INCLUDED — so adding an explicit `hallwayTiles` on top
  // of them bills the same tiles twice. The guard cannot simply be "floorTiles must be
  // explicit" either: a hallway-ONLY layout has no floor count at all and must still be
  // charged, which is exactly what this milestone stopped being free.
  const hasExplicitFloorCount = Number.isInteger(layoutData?.floorTiles) && layoutData.floorTiles > 0;
  const floorCountIncludesHallways = !hasExplicitFloorCount && floorTiles > 0;
  const hallwayTiles = isScaffold || floorCountIncludesHallways || !Number.isInteger(layoutData?.hallwayTiles)
    ? 0
    : Math.max(0, layoutData.hallwayTiles);
  if (hallwayTiles > 0) {
    accumulateItem(counts, "tile_hallway", "tile", hallwayTiles, {
      category: "floor_tiles",
      subjectRef: buildSubjectRef("layout", LAYOUT_ARTIFACT_SCHEMA),
    });
  }

  if (Array.isArray(actors) && actors.length > 0) {
    actors.forEach((actor, index) => {
      const category = inferActorCategory(actor);
      accumulateItem(counts, "actor_spawn", "actor", 1, {
        category,
        subjectRef: buildSubjectRef(actor?.id || `actor_${index + 1}`, ACTOR_ARTIFACT_SCHEMA),
      });
    });
  }

  if (hazardArray.length > 0) {
    hazardArray.forEach((hazard, index) => {
      accumulateItem(counts, "hazard_basic", "hazard", 1, {
        category: "hazards",
        subjectRef: buildSubjectRef(hazard?.id || `hazard_${index + 1}`, HAZARD_ARTIFACT_SCHEMA),
      });
    });
  }

  hazardArray.forEach((hazard, index) => {
    const subjectRef = buildSubjectRef(hazard?.id || `hazard_${index + 1}`, HAZARD_ARTIFACT_SCHEMA);
    readHazardVitalCharges(hazard).forEach(({ key, points, regen }) => {
      accumulateItem(counts, `vital_${key}_point`, "vital", points, { category: "hazards", subjectRef });
      accumulateItem(counts, `vital_${key}_regen_tick`, "vital", regen, { category: "hazards", subjectRef });
    });

    const affinityEntries = readHazardAffinityStacks(hazard);
    if (affinityEntries.length > 0) {
      // CR.9 M5: the base was MISSING here while the identical payload on an actor pays it
      // (see the actor branch below, and `calculateActorConfigurationUnitCost`). Every
      // hazard in every level carried its affinity base for free. Nothing failed, because a
      // missing charge produces a smaller well-formed receipt.
      affinityEntries.forEach(({ expression, stacks }) => {
        // Base is PER AFFINITY ENTRY, matching the actor branch below. Charging it once
        // per hazard was a second, subtler divergence in the same payload: a hazard with
        // two affinities paid one base where an actor pays two. Found by the Codex
        // adversarial review, which also noted the census test could not see it —
        // comparing ID *sets* between the two sites hides every quantity difference.
        accumulateItem(counts, "affinity_base", "affinity", 1, { category: "hazards", subjectRef });
        const expressionId = AFFINITY_EXPRESSION_IDS[expression];
        if (expressionId) {
          // ⚠️ QUANTITY 1, NOT `stacks` — CR.9 M5, and the benchmark is what found it.
          // An expression is a property of the affinity, not of each stack, and both other
          // charging sites already price it once: the actor branch below (`quantity: 1`) and
          // the canonical `calculateActorConfigurationUnitCost`
          // (`calculatePriceTotal(exprItem, 1)`). This site alone multiplied by stacks, so a
          // 3-stack push cost a hazard 105 tokens of expression where an actor pays 35 — one
          // payload with two prices, which is the P0.1/CR.1 divergent-charging-sites defect
          // this milestone exists to close. It surfaced only when M5 added the missing base
          // on top: content-gen scenario 51 then failed all three runs on
          // `deniedPools=hazards:262/156`.
          accumulateItem(counts, expressionId, "affinity", 1, { category: "hazards", subjectRef });
        }
        accumulateItem(counts, "affinity_stack", "affinity", stacks, { category: "hazards", subjectRef });
      });
    }
  });

  if (resourceArray.length > 0) {
    resourceArray.forEach((resource, index) => {
      const subjectRef = buildSubjectRef(resource?.id || `resource_${index + 1}`, RESOURCE_ARTIFACT_SCHEMA);
      extractResourcePriceEntries(resource).forEach(({ priceId, quantity }) => {
        accumulateItem(counts, priceId, "resource", Math.floor(quantity), { category: "resources", subjectRef });
      });
      // Affinity payload + vital regen: previously charged nothing at all.
      extractResourceGrantPriceEntries(resource).forEach(({ priceId, quantity }) => {
        accumulateItem(counts, priceId, "resource", Math.floor(quantity), { category: "resources", subjectRef });
      });
    });
  }

  if (Array.isArray(actors)) {
    actors.forEach((actor, index) => {
      const category = inferActorCategory(actor);
      const subjectRef = buildSubjectRef(actor?.id || `actor_${index + 1}`, ACTOR_ARTIFACT_SCHEMA);
      const vitals = actor?.vitals;
      if (vitals && typeof vitals === "object") {
        VITAL_KEYS.forEach((key) => {
          const vital = vitals[key];
          if (!vital || typeof vital !== "object") return;
          const max = Number.isInteger(vital.max)
            ? vital.max
            : Number.isInteger(vital.current)
              ? vital.current
              : 0;
          accumulateItem(counts, `vital_${key}_point`, "vital", max, { category, subjectRef });
          const regen = Number.isInteger(vital.regen) ? vital.regen : 0;
          accumulateItem(counts, `vital_${key}_regen_tick`, "vital", regen, { category, subjectRef });
        });
      }

      const affinities = extractAffinities(actor);
      if (affinities.length > 0) {
        // P1.4 unified model, mirroring the resource branch: base ×1 +
        // stacks (quadratic via the list formula) + expression ×1, per
        // affinity entry. The old itemization omitted the base and charged
        // the expression ×stacks — a fourth divergent affinity model, caught
        // by Codex's rulebook derivation during the P1.4 sweep.
        // Caveat: accumulateItem merges quantities per (id, subject), so a
        // multi-affinity actor quadratics on summed stacks; single-affinity
        // actors (the norm) price identically to
        // calculateActorConfigurationUnitCost.
        affinities.forEach((entry) => {
          accumulateItem(counts, "affinity_base", "affinity", 1, { category, subjectRef });
          accumulateItem(counts, "affinity_stack", "affinity", entry.stacks, { category, subjectRef });
          const expressionId = AFFINITY_EXPRESSION_IDS[entry.expression];
          if (!expressionId) return;
          accumulateItem(counts, expressionId, "affinity", 1, { category, subjectRef });
        });
      }

      const motivations = extractMotivations(actor, normalizeMotivations);
      motivations.forEach((entry) => {
        const motivationId = MOTIVATION_KIND_IDS[entry.kind];
        if (!motivationId) return;
        const quantity = Number.isInteger(entry.intensity) && entry.intensity > 0 ? entry.intensity : 1;
        accumulateItem(counts, motivationId, "motivation", quantity, { category, subjectRef });
      });
    });
  }

  return Array.from(counts.values()).sort((a, b) => {
    const categoryOrder = String(a.category || "").localeCompare(String(b.category || ""));
    if (categoryOrder !== 0) return categoryOrder;
    const subjectOrder = String(a.subjectRef?.id || "").localeCompare(String(b.subjectRef?.id || ""));
    if (subjectOrder !== 0) return subjectOrder;
    const kindOrder = a.kind.localeCompare(b.kind);
    if (kindOrder !== 0) return kindOrder;
    return a.id.localeCompare(b.id);
  });
}

export function buildSpendProposal({ meta, layout, actors, hazards, resources, normalizeMotivations } = {}) {
  const layoutData = readLayoutData(layout);
  const hazardArray = Array.isArray(hazards) ? hazards
    : Array.isArray(layoutData?.hazards) ? layoutData.hazards
    : [];
  const resourceArray = Array.isArray(resources) && resources.length > 0
    ? resources
    : Array.isArray(layoutData?.resources) ? layoutData.resources : [];
  const items = buildSpendItems({
    layoutData,
    actors,
    hazards: hazardArray,
    resources: resourceArray,
    normalizeMotivations,
  });

  return {
    schema: SPEND_PROPOSAL_SCHEMA,
    schemaVersion: 1,
    meta,
    items,
  };
}

export function evaluateConfiguratorSpend({
  budget,
  priceList,
  layout,
  actors,
  hazards,
  resources,
  allocation,
  proposalMeta,
  receiptMeta,
  normalizeMotivations,
} = {}) {
  const proposal = buildSpendProposal({
    meta: proposalMeta,
    layout,
    actors,
    hazards,
    resources,
    normalizeMotivations,
  });
  const proposalRef = proposal?.meta?.id
    ? { id: proposal.meta.id, schema: proposal.schema, schemaVersion: proposal.schemaVersion }
    : undefined;
  const result = validateSpendProposal({
    budget,
    priceList,
    proposal,
    allocation,
    meta: receiptMeta,
    proposalRef,
  });
  return {
    proposal,
    receipt: result.receipt,
    errors: result.errors,
    allowed: result.receipt?.status === "approved",
  };
}

function normalizePositiveInt(value, fallback = 0) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  const floored = Math.floor(parsed);
  return floored >= 0 ? floored : fallback;
}

function normalizeActorVitalsForCost(entry) {
  const vitalsSource = entry?.vitals && typeof entry.vitals === "object" ? entry.vitals : {};
  const vitals = {};
  const regen = {};
  VITAL_KEYS.forEach((key) => {
    const record = vitalsSource[key];
    const rawMax = typeof record === "object" ? record?.max : record;
    const rawRegen = typeof record === "object" ? record?.regen : undefined;
    const max = normalizePositiveInt(rawMax, 0);
    const regenValue = normalizePositiveInt(rawRegen, 0);
    vitals[key] = max;
    regen[key] = regenValue;
  });
  return { vitals, regen };
}

function normalizeBudget(value) {
  return Number.isInteger(value) && value >= 0 ? value : null;
}

function normalizeCostScale(value, fallback = 1) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function scaleTokenCost(value, scale = 1) {
  const base = normalizePositiveInt(value, 0);
  if (base <= 0) return 0;
  if (scale === 1) return base;
  const scaled = Math.round(base * scale);
  return scaled > 0 ? scaled : 1;
}

function normalizeAffinityEntriesForCost(entry) {
  if (!Array.isArray(entry?.affinities)) return [];
  return entry.affinities
    .map((affinity) => {
      if (!affinity || typeof affinity !== "object") return null;
      const kind = typeof affinity.kind === "string" ? affinity.kind : "";
      const expression = typeof affinity.expression === "string" ? affinity.expression : "";
      const stacks = normalizePositiveInt(affinity.stacks, 1);
      if (!expression || stacks <= 0) return null;
      return { kind, expression, stacks };
    })
    .filter(Boolean);
}

// P1.4: read a price entry from either map shape — an item object
// (normalizePriceItems) or a bare unitCost number (buildPriceMap). Items are
// canonical because they carry the formula; numbers are treated as linear.
function readPriceEntry(priceMap, kind, id) {
  const raw = priceMap?.get?.(`${kind}:${id}`);
  if (raw && typeof raw === "object" && Number.isFinite(raw.unitCost) && raw.unitCost >= 0) {
    return raw;
  }
  if (Number.isFinite(raw) && raw >= 0) {
    return { id, kind, unitCost: raw, formula: "linear" };
  }
  return null;
}

export function calculateActorConfigurationUnitCost({
  entry,
  priceMap,
  pricing = {},
  normalizeMotivations,
} = {}) {
  const { vitals, regen } = normalizeActorVitalsForCost(entry);
  const affinities = normalizeAffinityEntriesForCost(entry);
  const affinityCostScale = normalizeCostScale(pricing?.affinityCostScale, 1);
  const lineItems = [];
  const errors = [];

  const requireEntry = (kind, id) => {
    const item = readPriceEntry(priceMap, kind, id);
    if (!item) errors.push(`"${id}" has no price list entry (expected ${kind}:${id})`);
    return item;
  };

  // Vital max points — linear per the price list.
  let vitalPoints = 0;
  let vitalCost = 0;
  VITAL_KEYS.forEach((key) => {
    const quantity = normalizePositiveInt(vitals[key], 0);
    if (quantity <= 0) return;
    vitalPoints += quantity;
    const item = requireEntry("vital", VITAL_POINT_IDS[key]);
    if (!item) return;
    const spendTokens = calculatePriceTotal(item, quantity);
    vitalCost += spendTokens;
    lineItems.push({
      category: "vital",
      id: item.id,
      label: `${key} max`,
      quantity,
      unitCostTokens: item.unitCost,
      spendTokens,
    });
  });

  // Regen — the price list's formula applies (quadratic on the default list).
  let regenPoints = 0;
  let regenCost = 0;
  VITAL_KEYS.forEach((key) => {
    const quantity = normalizePositiveInt(regen[key], 0);
    if (quantity <= 0) return;
    regenPoints += quantity;
    const item = requireEntry("vital", VITAL_REGEN_IDS[key]);
    if (!item) return;
    const spendTokens = calculatePriceTotal(item, quantity);
    regenCost += spendTokens;
    lineItems.push({
      category: "vital",
      id: item.id,
      label: `${key} regen`,
      quantity,
      unitCostTokens: item.unitCost,
      spendTokens,
    });
  });

  // Affinity — base + stacks (list formula, quadratic) + expression, all from
  // the price list. affinityCostScale (room cards) applies to base+stacks and
  // to the expression, mirroring the pre-P1.4 scaling seams.
  let affinityStacks = 0;
  let affinityCost = 0;
  affinities.forEach((affinity) => {
    const stacks = affinity.stacks;
    affinityStacks += stacks;

    const baseItem = requireEntry("affinity", "affinity_base");
    const stackItem = requireEntry("affinity", "affinity_stack");
    const expressionId = AFFINITY_EXPRESSION_IDS[affinity.expression];
    const exprItem = expressionId ? requireEntry("affinity", expressionId) : null;
    if (!baseItem || !stackItem || (expressionId && !exprItem)) return;

    const basePlusStack =
      calculatePriceTotal(baseItem, 1) + calculatePriceTotal(stackItem, stacks);
    const scaledBasePlusStack = scaleTokenCost(basePlusStack, affinityCostScale);
    const expressionCost = exprItem
      ? scaleTokenCost(calculatePriceTotal(exprItem, 1), affinityCostScale)
      : 0;

    affinityCost += scaledBasePlusStack + expressionCost;
    lineItems.push({
      category: "affinity",
      id: `${affinity.kind || "affinity"}:${affinity.expression}`,
      label: `${affinity.kind || "affinity"}+${stacks}+${affinity.expression}`,
      quantity: 1,
      unitCostTokens: scaledBasePlusStack + expressionCost,
      spendTokens: scaledBasePlusStack + expressionCost,
    });
  });

  const motivations = extractMotivations(entry, normalizeMotivations);
  const motivationResult = calculateMotivationStackCost(motivations, priceMap);
  const motivationCost = motivationResult.cost;
  lineItems.push(...motivationResult.lineItems);
  if (Array.isArray(motivationResult.errors)) errors.push(...motivationResult.errors);

  const cost = vitalCost + regenCost + affinityCost + motivationCost;
  return {
    cost,
    detail: {
      vitalPoints,
      regenPoints,
      affinityStacks,
      motivationCost,
      affinityCostScale,
      pricingSource: "price-list",
      lineItems,
    },
    ...(errors.length ? { errors } : {}),
  };
}

export function calculateRoomCardUnitCost({
  card,
  priceList,
  tileCosts,
  deriveRoomLayout,
} = {}) {
  const roomCard = card && typeof card === "object"
    ? { ...card, type: "room", source: "room", count: 1 }
    : { type: "room", source: "room", count: 1 };
  const layoutSpend = evaluateRoomCardLayoutSpend({
    cardSet: [roomCard],
    budgetTokens: undefined,
    priceList,
    tileCosts,
    deriveRoomLayout,
  });
  return {
    cost: normalizePositiveInt(layoutSpend?.spentTokens, 0),
    detail: {
      layoutSpend: normalizePositiveInt(layoutSpend?.spentTokens, 0),
      layoutLineItems: Array.isArray(layoutSpend?.lineItems) ? layoutSpend.lineItems : [],
    },
  };
}

function asActorEntries({ actorSet, summary } = {}) {
  if (Array.isArray(actorSet) && actorSet.length > 0) {
    return actorSet.map((entry) => ({
      source: entry?.source === "room" ? "room" : "actor",
      id: entry?.id || "",
      motivation: entry?.role || entry?.motivation || "stationary",
      affinity: entry?.affinity || summary?.dungeonAffinity || "fire",
      count: normalizePositiveInt(entry?.count, 1) || 1,
      tokenHint: normalizePositiveInt(entry?.tokenHint, 0),
      vitals: entry?.vitals,
      affinities: entry?.affinities,
    }));
  }

  const cardSet = Array.isArray(summary?.cardSet)
    ? summary.cardSet
    : Array.isArray(summary?.cards)
      ? summary.cards
      : null;
  if (Array.isArray(cardSet) && cardSet.length > 0) {
    return cardSet
      .map((entry, index) => {
        const type = normalizeCardType(entry?.type) || (entry?.source === "room" ? "room" : "warden");
        const source = type === "room" ? "room" : "actor";
        const fallbackMotivation = type === "delver" ? "attacking" : type === "room" ? "stationary" : "defending";
        return {
          source,
          id: entry?.id || `${type}_${index + 1}`,
          motivation: entry?.motivations?.[0] || entry?.motivation || fallbackMotivation,
          affinity: entry?.affinity || summary?.dungeonAffinity || "fire",
          count: normalizePositiveInt(entry?.count, 1) || 1,
          tokenHint: source === "room" ? 0 : normalizePositiveInt(entry?.tokenHint, 0),
          vitals: entry?.vitals,
          affinities: entry?.affinities,
        };
      })
      .filter(Boolean);
  }

  const rooms = Array.isArray(summary?.rooms) ? summary.rooms : [];
  const actors = Array.isArray(summary?.actors) ? summary.actors : [];
  const normalizedRooms = rooms.map((entry, index) => ({
    source: "room",
    id: entry?.id || `room_${index + 1}`,
    motivation: entry?.motivation || "stationary",
    affinity: entry?.affinity || summary?.dungeonAffinity || "fire",
    count: normalizePositiveInt(entry?.count, 1) || 1,
    tokenHint: normalizePositiveInt(entry?.tokenHint, 0),
    vitals: null,
    affinities: entry?.affinities,
  }));
  const normalizedActors = actors.map((entry, index) => ({
    source: "actor",
    id: entry?.id || `actor_${index + 1}`,
    motivation: entry?.motivation || entry?.role || "stationary",
    affinity: entry?.affinity || summary?.dungeonAffinity || "fire",
    count: normalizePositiveInt(entry?.count, 1) || 1,
    tokenHint: normalizePositiveInt(entry?.tokenHint, 0),
    vitals: entry?.vitals,
    affinities: entry?.affinities,
  }));
  return [...normalizedRooms, ...normalizedActors];
}

function buildCategory(category, spentTokens, budgetTokens) {
  const spent = normalizePositiveInt(spentTokens, 0);
  const budget = normalizeBudget(budgetTokens);
  const remainingTokens = Number.isInteger(budget) ? Math.max(0, budget - spent) : null;
  const overBudgetBy = Number.isInteger(budget) ? Math.max(0, spent - budget) : 0;
  return {
    category,
    spentTokens: spent,
    budgetTokens: budget,
    remainingTokens,
    overBudgetBy,
    overBudget: overBudgetBy > 0,
  };
}

export function buildDesignSpendLedger({
  summary,
  actorSet,
  budgeting,
  tileCosts,
  priceList,
  pricing = {},
  deriveRoomLayout,
  normalizeMotivations,
  resolveSummary,
} = {}) {
  const resolvedSummary = resolveLedgerSummary(summary || {}, resolveSummary);
  const warnings = [];
  // CR.1/M5: tile prices have exactly one origin — a PriceList. An absent caller list
  // means the Allocator's OWN default list (P1.4's rule, already applied to `priceMap`
  // below), never the contracts table that used to complete missing prices silently.
  const resolvedPriceList = priceList || buildDefaultPriceList({ createdAt: UNUSED_CLOCK() });
  const budgetTokens = normalizeBudget(resolvedSummary?.budgetTokens);
  const cardSet = Array.isArray(resolvedSummary?.cardSet)
    ? resolvedSummary.cardSet
    : Array.isArray(resolvedSummary?.cards)
      ? resolvedSummary.cards
      : null;
  const layoutResult = Array.isArray(cardSet) && cardSet.length > 0
    ? evaluateRoomCardLayoutSpend({
      cardSet,
      budgetTokens: Number.isInteger(budgetTokens) ? budgetTokens : undefined,
      priceList: resolvedPriceList,
      tileCosts,
      deriveRoomLayout,
    })
    : evaluateLayoutSpend({
      layout: resolvedSummary?.layout,
      budgetTokens: Number.isInteger(budgetTokens) ? budgetTokens : undefined,
      priceList: resolvedPriceList,
      tileCosts,
    });
  if (Array.isArray(layoutResult?.warnings)) {
    warnings.push(...layoutResult.warnings);
  }
  const entries = asActorEntries({ actorSet, summary: resolvedSummary });
  // P1.4: an absent price list means the DEFAULT list (item map, so the
  // list's quadratic formulas apply) — an empty map would zero every config
  // charge under the fail-loud contract. Caller-provided lists are
  // normalized to items; entries without a formula price linearly.
  const priceMap = normalizePriceItems(resolvedPriceList);
  const lineItems = [];

  let levelConfigSpent = normalizePositiveInt(layoutResult?.spentTokens, 0);
  let actorBaseSpent = 0;
  let actorConfigSpent = 0;

  entries.forEach((entry) => {
    const count = normalizePositiveInt(entry?.count, 1) || 1;
    const tokenHint = normalizePositiveInt(entry?.tokenHint, 0);
    const entryId = entry.id || `${entry.source}_${entry.motivation}_${entry.affinity}`;
    if (entry.source !== "actor") {
      const roomPricing = pricing;
      const levelConfig = calculateActorConfigurationUnitCost({
        entry,
        priceMap,
        pricing: roomPricing,
        normalizeMotivations,
      });
      const baseSpend = tokenHint * count;
      if (baseSpend > 0) {
        lineItems.push({
          category: "levelConfig",
          id: entryId,
          source: entry.source,
          label: `${entry.source}:${entry.motivation}/${entry.affinity}`,
          count,
          unitCostTokens: tokenHint,
          spendTokens: baseSpend,
        });
        levelConfigSpent += baseSpend;
      }
      const configUnitSpend = normalizePositiveInt(levelConfig.cost, 0);
      if (configUnitSpend > 0) {
        const configSpend = configUnitSpend * count;
        lineItems.push({
          category: "levelConfig",
          id: `${entryId}_config`,
          source: entry.source,
          label: `${entry.source}-config:${entry.motivation}/${entry.affinity}`,
          count,
          unitCostTokens: configUnitSpend,
          spendTokens: configSpend,
          detail: levelConfig.detail,
        });
        levelConfigSpent += configSpend;
      }
      return;
    }

    const actorConfig = calculateActorConfigurationUnitCost({
      entry,
      priceMap,
      pricing,
      normalizeMotivations,
    });
    if (tokenHint > 0) {
      const actorBaseSpend = tokenHint * count;
      actorBaseSpent += actorBaseSpend;
      lineItems.push({
        category: "actorBase",
        id: entryId,
        source: entry.source,
        label: `actor-base:${entry.motivation}/${entry.affinity}`,
        count,
        unitCostTokens: tokenHint,
        spendTokens: actorBaseSpend,
      });
    }

    const configUnitSpend = normalizePositiveInt(actorConfig.cost, 0);
    if (configUnitSpend > 0) {
      const configSpend = configUnitSpend * count;
      actorConfigSpent += configSpend;
      lineItems.push({
        category: "actorConfiguration",
        id: entryId,
        source: entry.source,
        label: `actor-config:${entry.motivation}/${entry.affinity}`,
        count,
        unitCostTokens: configUnitSpend,
        spendTokens: configSpend,
        detail: actorConfig.detail,
      });
    }
  });

  const totalSpentTokens = levelConfigSpent + actorBaseSpent + actorConfigSpent;
  const remainingTokens = Number.isInteger(budgetTokens) ? Math.max(0, budgetTokens - totalSpentTokens) : null;
  const totalOverBudgetBy = Number.isInteger(budgetTokens) ? Math.max(0, totalSpentTokens - budgetTokens) : 0;

  const categories = {
    levelConfig: buildCategory(
      "levelConfig",
      levelConfigSpent,
      normalizeBudget(budgeting?.levelBudgetTokens),
    ),
    actorBase: buildCategory(
      "actorBase",
      actorBaseSpent,
      normalizeBudget(budgeting?.actorBudgetTokens),
    ),
    actorConfiguration: buildCategory(
      "actorConfiguration",
      actorConfigSpent,
      normalizeBudget(budgeting?.actorBudgetTokens),
    ),
  };

  return {
    budgetTokens,
    totalSpentTokens,
    remainingTokens,
    totalOverBudgetBy,
    overBudget: totalOverBudgetBy > 0 || Object.values(categories).some((category) => category.overBudget),
    categories,
    lineItems,
    warnings: warnings.length > 0 ? warnings : [],
  };
}
