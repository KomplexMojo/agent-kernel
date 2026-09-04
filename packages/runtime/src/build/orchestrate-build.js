import { UNUSED_CLOCK } from "../personas/_shared/require-clock.js";
import { mapBuildSpecToArtifacts } from "./map-build-spec.js";
import { solveWithAdapter } from "../ports/solver.js";
// CR.7 / WP-5 — design spend is the Allocator's, taken from its PUBLIC barrel.
import { evaluateConfiguratorSpend } from "../personas/allocator/persona.js";
import { createConfiguratorPersona } from "../personas/configurator/persona.js";
import { createAllocatorPersona } from "../personas/allocator/persona.js";
import { createDefaultResourceBundleArtifact } from "../render/resource-bundle.js";
// M9: every value in SCHEMAS below now comes from contracts/artifacts.ts. M8 relocated the
// two rules schemas here; the other five were the tree-wide retype backlog it deferred.
import {
  ACTOR_LOADOUT_SCHEMA,
  AFFINITY_PRESET_SCHEMA,
  AFFINITY_RULES_ARTIFACT_SCHEMA,
  AFFINITY_SUMMARY_SCHEMA,
  MOTIVATION_RULES_ARTIFACT_SCHEMA,
  SOLVER_REQUEST_SCHEMA,
  SOLVER_RESULT_SCHEMA,
} from "../contracts/artifacts.ts";

// CR.7 / WP-5 — the build-geometry helpers this file used to import out of seven Configurator
// internals now come off the persona's PUBLIC surface, which retired seven allowlist rows. The
// local names are unchanged, so every call site below reads exactly as it did.
const configuratorBuild = createConfiguratorPersona({ clock: UNUSED_CLOCK });
const {
  generateGridLayoutFromInput,
  buildSimConfigArtifact,
  buildInitialStateArtifact,
  resolveAffinityEffects,
  normalizeAffinityRulesArtifact,
  resolveAffinityRules,
  buildAmbientAffinityPressure,
  composeMixedRooms,
  normalizeMotivationRulesArtifact,
  resolveMotivationRules,
} = configuratorBuild;

// CR.9 M3: spend proposals price raw actor motivations, and motivation vocabulary is
// Configurator law. The Allocator no longer owns a copy of it, so this composition
// root hands over the Configurator's own function.
const configuratorMotivations = configuratorBuild.normalizeMotivations;

// WP-5/D10: same pattern for budget maximization. Scaling authored actors to fill an
// unspent budget is Configurator work, so it comes off the Configurator's public
// surface rather than out of `configurator/budget-maximizer.js` directly — the prices
// it scales against are supplied separately, by the Allocator.
const configuratorMaximizeActorBudget = createConfiguratorPersona({ clock: UNUSED_CLOCK })
  .authorCandidates.maximizeActorBudget;

// AM.2b — what an actor's motivation REQUIRES of its vitals is configuration
// validity, so it comes off the same public surface for the same reason.
const configuratorApplyMotivationVitalRequirements = createConfiguratorPersona({ clock: UNUSED_CLOCK })
  .authorCandidates.applyMotivationDerivedVitalRequirements;

// AM.5/F14 — and what an actor's AFFINITIES require of its mana, for the same
// reason and at the same point: before anything prices the actor list.
const configuratorApplyAffinityVitalRequirements = createConfiguratorPersona({ clock: UNUSED_CLOCK })
  .authorCandidates.applyAffinityDerivedVitalRequirements;

// The viability floor, off the same surface for the same reason. Unlike the two above it is
// unconditional: a stationary actor with no affinities still has to survive being hit.
const configuratorApplyViabilityVitalRequirements = createConfiguratorPersona({ clock: UNUSED_CLOCK })
  .authorCandidates.applyViabilityDerivedVitalRequirements;

const SCHEMAS = Object.freeze({
  solverRequest: SOLVER_REQUEST_SCHEMA,
  solverResult: SOLVER_RESULT_SCHEMA,
  affinityPreset: AFFINITY_PRESET_SCHEMA,
  actorLoadout: ACTOR_LOADOUT_SCHEMA,
  affinityRules: AFFINITY_RULES_ARTIFACT_SCHEMA,
  motivationRules: MOTIVATION_RULES_ARTIFACT_SCHEMA,
  affinitySummary: AFFINITY_SUMMARY_SCHEMA,
});

function createBuildMeta(spec, producedBy, suffix) {
  return {
    id: `${spec.meta.id}_${suffix}`,
    runId: spec.meta.runId,
    createdAt: spec.meta.createdAt,
    producedBy,
    correlationId: spec.meta.correlationId,
    note: spec.meta.note,
  };
}

function toRef(artifact) {
  if (!artifact || typeof artifact !== "object") {
    return null;
  }
  if (!artifact.schema || !artifact.schemaVersion) {
    return null;
  }
  const id = artifact.meta?.id;
  if (!id) {
    return null;
  }
  return {
    id,
    schema: artifact.schema,
    schemaVersion: artifact.schemaVersion,
  };
}

function formatBudgetReceiptDenial(receipt) {
  const parts = [
    `status=${receipt?.status}`,
    `remaining=${receipt?.remaining}`,
  ];
  const allDeniedItems = Array.isArray(receipt?.lineItems)
    ? receipt.lineItems.filter((item) => item?.status !== "approved")
    : [];
  const deniedLines = allDeniedItems
    .slice(0, 5)
    .map((item) => `${item.kind}:${item.id}${item.category ? `:${item.category}` : ""}`);
  if (deniedLines.length > 0) {
    const omitted = allDeniedItems.length - deniedLines.length;
    parts.push(`deniedLines=${deniedLines.join(",")}${omitted > 0 ? ` (+${omitted} more)` : ""}`);
  }
  // #145 — the denial reported what was denied (id, spent, cap) but not the shortfall, so a
  // caller had no way to compute the minimum budget that would clear it without trial and error.
  // `short N` is the extra capacity this one pool alone needed; the total budgetTokens that would
  // resolve it isn't computable from the receipt (capTokens' relationship to the overall budget
  // isn't a simple proportion — see #145's own investigation), so this reports the one thing that
  // is always correct: how far over this pool's own cap the spend landed.
  const deniedPools = Array.isArray(receipt?.poolStatuses)
    ? receipt.poolStatuses
      .filter((pool) => pool?.status !== "approved")
      .map((pool) => {
        const shortfall = Number(pool.spentTokens) - Number(pool.capTokens);
        const shortfallText = Number.isFinite(shortfall) && shortfall > 0 ? ` (short ${shortfall})` : "";
        return `${pool.id}:${pool.spentTokens}/${pool.capTokens}${shortfallText}`;
      })
    : [];
  if (deniedPools.length > 0) {
    parts.push(`deniedPools=${deniedPools.join(",")}`);
  }
  return `Budget receipt denied: ${parts.join("; ")}`;
}

// #148 — level-layout.js raises five distinct error codes, each with its own detail shape. This
// used to be one hardcoded template (`requested X, need at least Y for Z rooms`) applied to every
// code; only floor_tile_budget_insufficient's detail actually has {target, required, roomCount}, so
// the other four silently formatted as "(requested undefined, need at least undefined for undefined
// rooms)" — a real rejection with a broken message. Code-aware now: each code formats its own known
// shape, and an error code with no formatter here (or a detail object missing the fields it expects)
// falls back to no parenthetical rather than guessing wrong.
const LEVEL_GEN_ERROR_DETAIL_FORMATTERS = {
  floor_tile_budget_insufficient: (detail) => {
    if (!Number.isFinite(detail?.target) || !Number.isFinite(detail?.required) || !Number.isFinite(detail?.roomCount)) {
      return "";
    }
    return ` (requested ${detail.target}, need at least ${detail.required} for `
      + `${detail.roomCount} room${detail.roomCount === 1 ? "" : "s"})`;
  },
  hazard_outside_room: (detail) => {
    if (!Number.isFinite(detail?.x) || !Number.isFinite(detail?.y)) return "";
    const bounds = Number.isFinite(detail?.roomWidth) && Number.isFinite(detail?.roomHeight)
      ? ` — room ${detail.roomId ?? "?"}'s interior is ${detail.roomWidth}x${detail.roomHeight}`
      : "";
    return ` (position ${detail.x},${detail.y} is outside the target room${bounds})`;
  },
  hazard_on_wall: (detail) => {
    if (!Number.isFinite(detail?.x) || !Number.isFinite(detail?.y)) return "";
    const affinity = detail?.affinity ? ` (affinity ${detail.affinity})` : "";
    return ` (position ${detail.x},${detail.y} is a wall tile${affinity})`;
  },
  element_on_wall: (detail) => {
    if (!Number.isFinite(detail?.x) || !Number.isFinite(detail?.y)) return "";
    const id = detail?.id ? ` (id ${detail.id})` : "";
    return ` (position ${detail.x},${detail.y} is a wall tile${id})`;
  },
  target_mismatch: (detail) => {
    if (!Number.isFinite(detail?.target) || !Number.isFinite(detail?.walkableTiles)) return "";
    return ` (expected ${detail.target} walkable tiles, computed ${detail.walkableTiles})`;
  },
};

function formatLevelGenErrorDetail(err) {
  if (!err?.detail || typeof err.detail !== "object") return "";
  const formatter = LEVEL_GEN_ERROR_DETAIL_FORMATTERS[err.code];
  return formatter ? formatter(err.detail) : "";
}

function assertSchema(artifact, expectedSchema) {
  if (!artifact || typeof artifact !== "object") {
    throw new Error(`Expected ${expectedSchema} artifact.`);
  }
  if (artifact.schema !== expectedSchema) {
    throw new Error(`Expected schema ${expectedSchema}, got ${artifact.schema || "missing"}.`);
  }
  if (artifact.schemaVersion !== 1) {
    throw new Error(`Expected schemaVersion 1 for ${expectedSchema}.`);
  }
}

function normalizeResolvedRulesArtifact({
  artifact,
  schema,
  normalizeArtifact,
  resolveDefaultArtifact,
  label,
} = {}) {
  if (!artifact) {
    return resolveDefaultArtifact();
  }
  assertSchema(artifact, schema);
  const normalized = normalizeArtifact(artifact);
  if (!normalized.ok) {
    const details = normalized.errors.map((entry) => `${entry.field}:${entry.code}`).join(", ");
    throw new Error(`${label} invalid: ${details}`);
  }
  return normalized.value;
}

export async function orchestrateBuild({
  spec,
  producedBy = "runtime-build",
  solver,
  placeObjects,
  capturedInputs,
  // CR.3: `{intent, plan}` from the Director round that produced this spec, when
  // the caller ran one. Without it map-build-spec reconstructs a plan from the
  // finished spec, which is a lineage derived from the product rather than the
  // cause. Callers that never ran a Director (sandbox bridge, fixture-driven
  // tests) legitimately omit it.
  directorRound,
} = {}) {
  if (!spec) {
    throw new Error("orchestrateBuild requires spec");
  }

  const mapped = mapBuildSpecToArtifacts(spec, { producedBy, directorRound });

  let solverRequest = null;
  let solverResult = null;
  if (solver?.adapter) {
    const solverClock = solver.clock || (() => spec.meta.createdAt);
    solverRequest = {
      schema: SCHEMAS.solverRequest,
      schemaVersion: 1,
      meta: createBuildMeta(spec, producedBy, "solver_request"),
      intentRef: toRef(mapped.intent),
      planRef: toRef(mapped.plan),
      problem: {
        language: "custom",
        data: solver.scenario ?? { planRef: toRef(mapped.plan) },
      },
      options: solver.options || undefined,
    };

    solverResult = await solveWithAdapter(solver.adapter, solverRequest, { clock: solverClock });
    solverResult.schema = solverResult.schema || SCHEMAS.solverResult;
    solverResult.schemaVersion = solverResult.schemaVersion || 1;
    solverResult.requestRef = solverResult.requestRef || toRef(solverRequest);
  }

  const configuratorInputs = mapped.configuratorInputs;
  const levelGenInput = configuratorInputs?.levelGen;
  const actorsInputRaw = configuratorInputs?.actors;
  const hasLevelGen = levelGenInput && typeof levelGenInput === "object" && !Array.isArray(levelGenInput);
  const hasActors = Array.isArray(actorsInputRaw) || (actorsInputRaw && typeof actorsInputRaw === "object");

  let simConfig = null;
  let initialState = null;
  let budgetReceipt = mapped.budget?.receipt || null;
  let spendProposal = null;
  let affinitySummary = null;
  let affinityRules = null;
  let motivationRules = null;
  // PX.6: the actors the build actually resolved (budget-maximized, then position-
  // normalized). Function-scoped because `actorsInput` is block-scoped inside the layout
  // branch, and this is published as build OUTPUT at the end rather than written back over
  // the Configurator's locked inputs.
  let resolvedActors = null;
  let resourceBundle = null;
  let resolvedPriceList = null;
  let budgetAllocation = null;

  if (hasLevelGen) {
    if (!hasActors) {
      const receivedKind = actorsInputRaw === undefined
        ? "undefined"
        : actorsInputRaw === null ? "null" : typeof actorsInputRaw;
      throw new Error(
        `configurator inputs require actors when levelGen is provided (received ${receivedKind}, `
        + `expected an array or object).`,
      );
    }

    const authoredHazards = Array.isArray(levelGenInput.hazards) ? levelGenInput.hazards : [];
    const positionedHazards = authoredHazards.filter(
      (hazard) => Number.isFinite(hazard?.x) && Number.isFinite(hazard?.y),
    );
    const unpositionedHazards = authoredHazards.filter(
      (hazard) => !Number.isFinite(hazard?.x) || !Number.isFinite(hazard?.y),
    );
    const layoutResult = generateGridLayoutFromInput({
      ...levelGenInput,
      hazards: positionedHazards,
    });
    if (!layoutResult.ok) {
      const details = layoutResult.errors.map((err) => {
        return `${err.field}:${err.code}${formatLevelGenErrorDetail(err)}`;
      }).join(", ");
      throw new Error(`level-gen input invalid: ${details}`);
    }

    const actorsInput = Array.isArray(actorsInputRaw) ? { actors: actorsInputRaw } : actorsInputRaw;
    if (!actorsInput || !Array.isArray(actorsInput.actors)) {
      const receivedKind = actorsInput?.actors === undefined ? "undefined" : typeof actorsInput.actors;
      throw new Error(`configurator inputs must include an actors array (received ${receivedKind}).`);
    }

    // AM.2b — raise each actor's vitals to what its motivation requires BEFORE
    // anything prices them.
    //
    // An actor whose motivation implies movement needs a stamina POOL, not just
    // stamina regen: core clamps regen to max, so the {0,0,0} default made every
    // move it ever proposed fail InsufficientStamina (F12). Applying the floor
    // here rather than after the build is what keeps the Allocator whole — the
    // spend proposal below is built from `actorsInput.actors`, so the stamina
    // appears as priced line items instead of a vital the actor was handed for
    // free. An unpriced grant is exactly the silent fallback the charter forbids.
    // COPY, never mutate in place. `actorsInput.actors` may be the Configurator's
    // LOCKED input — deep-frozen, and recorded as this build's causal input. An
    // earlier draft of this called the two helpers on the actors directly and
    // `build-locked-input-immutability.test.js` caught it twice over: a
    // TypeError on the frozen vital, and the byte-identity check that exists
    // precisely because affinityRules/motivationRules/actors used to be written
    // back over the locked artifact after the Configurator's round had closed.
    actorsInput.actors = actorsInput.actors.map((actor) => {
      const draft = {
        ...actor,
        vitals: actor?.vitals
          ? Object.fromEntries(
            Object.entries(actor.vitals).map(([key, vital]) => [key, { ...vital }]),
          )
          : actor?.vitals,
      };
      configuratorApplyMotivationVitalRequirements(draft);
      configuratorApplyAffinityVitalRequirements(draft);
      configuratorApplyViabilityVitalRequirements(draft);
      return draft;
    });

    const affinityPresets = configuratorInputs?.affinityPresets || null;
    const affinityLoadouts = configuratorInputs?.affinityLoadouts || null;
    affinityRules = normalizeResolvedRulesArtifact({
      artifact: configuratorInputs?.affinityRules || null,
      schema: SCHEMAS.affinityRules,
      normalizeArtifact: normalizeAffinityRulesArtifact,
      resolveDefaultArtifact: () => resolveAffinityRules(),
      label: "affinity rules",
    });
    motivationRules = normalizeResolvedRulesArtifact({
      artifact: configuratorInputs?.motivationRules || null,
      schema: SCHEMAS.motivationRules,
      normalizeArtifact: normalizeMotivationRulesArtifact,
      resolveDefaultArtifact: () => resolveMotivationRules(),
      label: "motivation rules",
    });
    if ((affinityPresets && !affinityLoadouts) || (!affinityPresets && affinityLoadouts)) {
      const missing = affinityPresets ? "affinityLoadouts" : "affinityPresets";
      throw new Error(`configurator inputs require both affinityPresets and affinityLoadouts (missing ${missing}).`);
    }
    if (affinityPresets) {
      assertSchema(affinityPresets, SCHEMAS.affinityPreset);
    }
    if (affinityLoadouts) {
      assertSchema(affinityLoadouts, SCHEMAS.actorLoadout);
    }
    // PX.6: these used to be written INTO spec.configurator.inputs — the artifact recorded
    // as the build's causal input — after the Configurator's round had closed. Both are
    // already returned as top-level build results, and both are now republished on the spec
    // under `configurator.resolved` instead. See the publish site near the return.

    let layout = layoutResult.value;
    if (levelGenInput?.budgetScaffold === true) {
      layout.budgetScaffold = true;
    }
    const seed = Number.isFinite(levelGenInput.seed) ? levelGenInput.seed : 0;
    layout = composeMixedRooms({
      layout,
      cardSet: configuratorInputs?.cardSet,
      seed,
    }).layout;
    const objectPlacement = await (typeof placeObjects === "function"
      ? placeObjects
      : configuratorBuild.completeObjectPlacement)({
      layout,
      hazards: unpositionedHazards,
      resources: Array.isArray(configuratorInputs?.resources) ? configuratorInputs.resources : [],
      actors: actorsInput.actors,
      meta: createBuildMeta(spec, producedBy, "object_placement"),
    });
    if (!objectPlacement?.ok) {
      const error = new Error(`configurator object placement ${objectPlacement?.status || "failed"}: ${objectPlacement?.reason || "unknown"}`);
      error.code = objectPlacement?.reason || "configurator_object_placement_failed";
      error.status = objectPlacement?.status || "error";
      throw error;
    }
    layout = objectPlacement.layout;
    const baseVitalsByActorId = Object.fromEntries(
      actorsInput.actors
        .filter((actor) => actor?.id && actor.vitals)
        .map((actor) => [actor.id, actor.vitals]),
    );
    let resolvedEffects = {};
    if (affinityPresets && affinityLoadouts) {
      resolvedEffects = resolveAffinityEffects({
        presets: affinityPresets.presets,
        loadouts: affinityLoadouts.loadouts,
        baseVitalsByActorId,
        rooms: Array.isArray(layout.rooms) ? layout.rooms : [],
        hazards: Array.isArray(layout.hazards) ? layout.hazards : [],
        affinityRules,
      });
    }

    const buildAllocator = createAllocatorPersona({
      priceListMeta: createBuildMeta(spec, producedBy, "default_price_list"),
      clock: UNUSED_CLOCK,
    });
    resolvedPriceList = mapped.budget?.budget
      ? buildAllocator.resolvePriceList(mapped.budget?.priceList)
      : null;
    const mixedRoomPriceList = resolvedPriceList || buildAllocator.resolvePriceList();
    if (Array.isArray(layout.rooms)) {
      layout.rooms = layout.rooms.map((room) => {
        if (!room?.mixedRoomComposition) return room;
        const designTokenSpend = buildAllocator.priceMixedRoomDesignSpend({
          room,
          composition: room.mixedRoomComposition,
          priceList: mixedRoomPriceList,
        });
        return {
          ...room,
          mixedRoomComposition: { ...room.mixedRoomComposition, designTokenSpend },
        };
      });
    }
    if (mapped.budget?.budget && resolvedPriceList) {
      // CR.7 / WP-5 — asked of the Allocator's public surface rather than by importing
      // `budget-allocation.js`. `allocateBudget` IS `buildBudgetAllocation`, wrapped only to
      // default an absent `priceList` from the persona's own — and this call site supplies one
      // explicitly, so the wrapper is a no-op here and the allocation is byte-identical.
      // Constructed inline with `UNUSED_CLOCK` because that is this file's existing idiom for
      // asking the Allocator a stateless question (see `scenarioSpendReport` below).
      const allocationResult = buildAllocator.allocateBudget({
        budget: mapped.budget.budget,
        priceList: resolvedPriceList,
        meta: createBuildMeta(spec, producedBy, "budget_allocation"),
        poolWeights: spec.intent?.hints?.poolWeights,
      });
      if (!allocationResult.ok) {
        const details = allocationResult.errors.map((entry) => `${entry.field || "poolWeights"}:${entry.code}`).join(", ");
        throw new Error(`Budget allocation invalid: ${details}`);
      }
      budgetAllocation = allocationResult.allocation;
    }

    const configuratorResources = Array.isArray(configuratorInputs?.resources) ? configuratorInputs.resources : [];

    if (configuratorInputs?.maximizeBudget && !budgetReceipt && mapped.budget?.budget && resolvedPriceList) {
      const probeResult = evaluateConfiguratorSpend({
        budget: mapped.budget.budget,
        priceList: resolvedPriceList,
        allocation: budgetAllocation,
        layout,
        actors: actorsInput.actors,
        resources: configuratorResources,
        proposalMeta: createBuildMeta(spec, producedBy, "spend_proposal_probe"),
        receiptMeta: createBuildMeta(spec, producedBy, "budget_receipt_probe"),
        normalizeMotivations: configuratorMotivations,
      });
      const maximizeRemaining = buildAllocator.resolveActorExpansionAvailability({
        receipt: probeResult.receipt,
      });
      if (maximizeRemaining > 0) {
        // The prices are the Allocator's, read off its published surface against
        // the very price list this build resolved — not derived here, and not
        // derived inside the Configurator from the Allocator's own tools.
        const { pricing } = createAllocatorPersona({
          priceList: resolvedPriceList,
          clock: UNUSED_CLOCK,
        });
        actorsInput.actors = configuratorMaximizeActorBudget({
          actors: actorsInput.actors,
          remaining: maximizeRemaining,
          unitCosts: pricing.unitCosts(),
          priceItems: pricing.priceMap(),
        });
        resolvedActors = actorsInput.actors;
      }
    }

    if (!budgetReceipt && mapped.budget?.budget && resolvedPriceList) {
      const spendResult = evaluateConfiguratorSpend({
        budget: mapped.budget.budget,
        priceList: resolvedPriceList,
        allocation: budgetAllocation,
        layout,
        actors: actorsInput.actors,
        resources: configuratorResources,
        motivationRules,
        affinityRules,
        proposalMeta: createBuildMeta(spec, producedBy, "spend_proposal"),
        receiptMeta: createBuildMeta(spec, producedBy, "budget_receipt"),
        normalizeMotivations: configuratorMotivations,
      });
      spendProposal = spendResult.proposal;
      budgetReceipt = spendResult.receipt;
      budgetReceipt.scenarioSpendReport = buildAllocator.scenarioSpendReport({
        lineItems: budgetReceipt.lineItems,
        allocation: budgetAllocation,
        budgetTokens: mapped.budget.budget?.budget?.tokens,
      });
      if (budgetReceipt.status !== "approved") {
        throw new Error(formatBudgetReceiptDenial(budgetReceipt));
      }
    }
    if (budgetReceipt && budgetReceipt.status !== "approved") {
      throw new Error(formatBudgetReceiptDenial(budgetReceipt));
    }

    resolvedActors = resolvedActors || actorsInput.actors;
    const normalizedActors = configuratorBuild.placeActors({
      actors: actorsInput.actors,
      layout,
      delverCount: configuratorInputs?.delverCount,
    });
    if (normalizedActors.changed) {
      actorsInput.actors = normalizedActors.actors;
      resolvedActors = normalizedActors.actors;
    }

    simConfig = buildSimConfigArtifact({
      meta: createBuildMeta(spec, producedBy, "sim_config"),
      planRef: toRef(mapped.plan),
      budgetReceiptRef: budgetReceipt ? toRef(budgetReceipt) : undefined,
      affinityRulesRef: affinityRules ? toRef(affinityRules) : undefined,
      motivationRulesRef: motivationRules ? toRef(motivationRules) : undefined,
      seed,
      layout,
    });
    initialState = buildInitialStateArtifact({
      meta: createBuildMeta(spec, producedBy, "initial_state"),
      simConfigRef: toRef(simConfig),
      affinityRulesRef: affinityRules ? toRef(affinityRules) : undefined,
      motivationRulesRef: motivationRules ? toRef(motivationRules) : undefined,
      actors: actorsInput.actors,
      resolvedEffects,
    });

    if (affinityPresets && affinityLoadouts) {
      const ambientPressure = buildAmbientAffinityPressure({
        rooms: Array.isArray(layout.rooms) ? layout.rooms : [],
        hazards: Array.isArray(layout.hazards) ? layout.hazards : [],
      });
      affinitySummary = {
        schema: SCHEMAS.affinitySummary,
        schemaVersion: 1,
        // Builds run NO tick, and the Annotator subscribes only to the EMIT/SUMMARIZE tick
        // phases — so it cannot have produced this. Stamp the real caller, as every sibling
        // artifact here does; glue must not claim persona provenance it did not earn (P3.4).
        meta: createBuildMeta(spec, producedBy, "affinity_summary"),
        presetsRef: toRef(affinityPresets),
        loadoutsRef: toRef(affinityLoadouts),
        affinityRulesRef: affinityRules ? toRef(affinityRules) : undefined,
        simConfigRef: toRef(simConfig),
        initialStateRef: toRef(initialState),
        actors: resolvedEffects.actors || [],
        hazards: resolvedEffects.hazards || [],
        ambientPressure,
      };
    }

    resourceBundle = createDefaultResourceBundleArtifact({
      createMeta: (metaOverrides) => createBuildMeta(spec, metaOverrides.producedBy, "resource_bundle"),
      runId: spec.meta.runId,
      producedBy: "cli-build",
      emitVisualAssets: true,
    });
  }

  const resolvedBudget = mapped.budget
    ? {
      ...mapped.budget,
      ...(resolvedPriceList && !mapped.budget.priceList ? { priceList: resolvedPriceList } : {}),
      ...(budgetAllocation ? { allocation: budgetAllocation } : {}),
    }
    : mapped.budget;

  if (spendProposal && budgetReceipt) {
    const runCostContext = {
      runTotalTokens: budgetReceipt.totalCost,
      budgetTokens: budgetReceipt.totalCost + (budgetReceipt.remaining ?? 0),
      receiptRef: toRef(budgetReceipt),
      proposalRef: toRef(spendProposal),
    };
    for (const artifact of [spec, mapped.intent, mapped.plan, simConfig, initialState, resourceBundle, affinitySummary]) {
      if (artifact?.meta) {
        artifact.meta.cost = runCostContext;
      }
    }
  }

  // ── PX.6: what the build RESOLVED, published as output ──────────────────────────
  //
  // The Configurator's `inputs` are the causal record: what it was asked to build from,
  // locked when its round closed. The build then resolves them further — affinity and
  // motivation rules get expanded, actors get budget-maximized and normalized — and those
  // results USED to be written back on top of `inputs`, which made the artifact recorded as
  // the cause partly a product of the effect. Nothing failed, because the mutated shape is
  // still well-formed; you simply could not tell afterwards what the Configurator had
  // actually approved.
  //
  // Same data, honest location. `inputs` is now immutable after the round, and a consumer
  // that wants "what the build used" reads `resolved`. A spec with no `resolved` has not
  // been built yet, which is a fact worth being able to observe.
  if (spec?.configurator && typeof spec.configurator === "object") {
    spec.configurator.resolved = {
      affinityRules,
      motivationRules,
      ...(Array.isArray(resolvedActors) ? { actors: resolvedActors } : {}),
    };
  }

  return {
    spec,
    intent: mapped.intent,
    plan: mapped.plan,
    budget: resolvedBudget,
    solverRequest,
    solverResult,
    spendProposal,
    budgetReceipt,
    affinityRules,
    motivationRules,
    affinitySummary,
    simConfig,
    initialState,
    resourceBundle,
    capturedInputs: Array.isArray(capturedInputs) ? capturedInputs : undefined,
  };
}
