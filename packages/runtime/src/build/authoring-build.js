/**
 * Authoring build pipeline — the runtime-owned domain build behind the CLI's
 * create/configure commands (P2.3.2).
 *
 * ak_create / ak_configure previously reimplemented the runtime build pipeline
 * inline in the adapter (ak-impl.mjs agentAuthoringCommand): assemble the
 * BuildSpec → Configurator input prep → orchestrateBuild → post-process. That
 * is the same pipeline the kernel already owns for llm-plan. This module hosts
 * it so the CLI keeps only arg parsing, maximize, summary/request assembly, and
 * host IO; the domain build runs here.
 *
 * Translation runs through the Director controller (never its buildspec-assembler
 * internal): the IntentEnvelope is synthesized at this boundary and the build
 * round opened with beginBuild before assembleBuildSpec, exactly as the kernel's
 * llm-plan path does (P2.1b). No persona-internal import, so no new boundary
 * violation.
 *
 * The three post-processors moved here from the adapter. applyAuthoringSection
 * and attachMixedRoomAssembliesToBuildResult are still called by the CLI's
 * *-plan commands, so they are exported for the adapter to import until P2.3.3
 * threads those commands too; applyMotivationToInitialStateActors was
 * authoring-only and is now internal to this pipeline.
 */
import { validateBuildSpec } from "../contracts/build-spec.js";
import { summarizeMixedRoomAssemblies } from "./mixed-room-summary.js";
import { orchestrateBuild } from "./orchestrate-build.js";
import { createDirectorPersona } from "../personas/director/persona.js";
import { createConfiguratorPersona } from "../personas/configurator/persona.js";

// Matches the kernel's local SCHEMAS.intent (commands/kernel.js); the Director's
// beginBuild only needs a well-formed envelope object, and the plan it drafts is
// discarded here (the persisted plan comes from orchestrateBuild's map-build-spec,
// P2.1c), so the literal is sufficient and avoids a .js -> .ts import.
const INTENT_ENVELOPE_SCHEMA = "agent-kernel/IntentEnvelope";

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

export function applyAuthoringSection(spec, authoring, commandName) {
  if (!authoring) {
    return;
  }
  spec.authoring = authoring;
  const validation = validateBuildSpec(spec);
  if (!validation.ok) {
    throw new Error(`${commandName} build spec failed: ${validation.errors.join("; ")}`);
  }
}

export function attachMixedRoomAssembliesToBuildResult(buildResult) {
  const assemblies = summarizeMixedRoomAssemblies(buildResult?.simConfig?.layout?.data?.rooms);
  if (buildResult?.affinitySummary && typeof buildResult.affinitySummary === "object") {
    buildResult.affinitySummary = {
      ...buildResult.affinitySummary,
      mixedRoomAssemblies: assemblies,
    };
  }
  return assemblies;
}

// Extract the primary motivation string from a parsed delver/warden card's
// `motivations` array. Delver cards append a synthetic "user_controlled" tag
// (see parseDelverSpec) alongside the actual requested motivation, so that
// tag must be excluded when resolving the single motivation.kind value the
// runtime persona layer reads (resolveActorMotivationKind expects
// actor.motivation.kind — see packages/runtime/src/personas/actor/controller.js).
function resolvePrimaryCardMotivation(card) {
  const motivations = Array.isArray(card?.motivations) ? card.motivations : [];
  return motivations.find((entry) => entry && entry !== "user_controlled") || null;
}

// ak_create/ak_configure accept --delver/--warden "motivation=<kind>" but
// orchestrateBuild (packages/runtime) does not carry that value through onto
// the actor records it writes into InitialStateArtifact — it is only used
// authoring-side for cost calculation (hasNonStationaryMobilityMotivation /
// requiresMovementStamina). Patch `motivation: { kind }` onto each actor here,
// matched by archetype + base-id prefix back to the parsed CLI card that
// produced it. InitialStateArtifactV1.actors entries are not a closed/enumerated
// key set (packages/runtime/src/contracts/artifacts.ts), so adding this field
// does not require a schemaVersion bump.
export function applyMotivationToInitialStateActors(initialState, { parsedDelvers = [], parsedWardens = [] } = {}) {
  const actors = Array.isArray(initialState?.actors) ? initialState.actors : [];
  if (actors.length === 0) {
    return;
  }

  const cardsByArchetype = {
    delver: parsedDelvers.map((entry) => ({
      baseId: entry?.value?.id,
      motivation: resolvePrimaryCardMotivation(entry?.value),
    })).filter((entry) => isNonEmptyString(entry.baseId) && isNonEmptyString(entry.motivation)),
    warden: parsedWardens.map((entry) => ({
      baseId: entry?.value?.id,
      motivation: resolvePrimaryCardMotivation(entry?.value),
    })).filter((entry) => isNonEmptyString(entry.baseId) && isNonEmptyString(entry.motivation)),
  };

  if (cardsByArchetype.delver.length === 0 && cardsByArchetype.warden.length === 0) {
    return;
  }

  actors.forEach((actor) => {
    const cards = cardsByArchetype[actor?.archetype];
    if (!cards || cards.length === 0) {
      return;
    }
    const match = cards.find((card) => actor.id === card.baseId || actor.id.startsWith(`${card.baseId}-`));
    if (match) {
      actor.motivation = { kind: match.motivation };
    }
  });
}

/**
 * The authoring domain build. Input is the CLI's assembled, wide bag; the CLI
 * retains parse/maximize/summary+request construction and all writing (plus the
 * dry-run branch — "don't write, emit summary" is a decision on the returned
 * buildResult, so no dryRun flag is needed here).
 *
 * @returns {{ spec: object, buildResult: object, requestArtifact: (object|null) }}
 */
export async function runAuthoringBuild(input = {}) {
  const {
    summary,
    authoring,
    requestArtifact = null,
    commandName,
    runId,
    createdAt,
    budgetArtifact = null,
    priceListArtifact = null,
    rooms = [],
    floorTiles = [],
    hazards = [],
    resources = [],
    maximizeBudget = false,
    parsedDelvers = [],
    parsedWardens = [],
  } = input;

  const source = `cli-${commandName}`;

  // Open the Director's build round: synthesize the IntentEnvelope at this
  // boundary, then assemble the BuildSpec through the controller (assembleBuildSpec
  // fronts buildspec-assembler; the spec is identical to a direct call, the FSM
  // advance is the only added effect). Mirrors the kernel's llm-plan path (P2.1b).
  const director = createDirectorPersona({ clock: () => createdAt });
  const intentEnvelope = {
    schema: INTENT_ENVELOPE_SCHEMA,
    schemaVersion: 1,
    meta: { id: `intent_${runId}`, runId, createdAt, producedBy: "cli" },
    source,
    intent: { goal: isNonEmptyString(summary?.goal) ? summary.goal : `author ${runId}` },
  };
  director.beginBuild(intentEnvelope, { runId });
  const built = director.assembleBuildSpec({
    summary,
    runId,
    createdAt,
    source,
    budgetArtifact: budgetArtifact || undefined,
    priceListArtifact: priceListArtifact || undefined,
  });
  if (!built.ok || !built.spec) {
    throw new Error(`${commandName} build spec failed: ${built.errors.join("; ")}`);
  }

  // Configurator owns input preparation (P2.2/P2.3.1): grid sizing, hazard
  // placement, and resource mapping run behind the persona's CONFIG-plane surface.
  const configurator = createConfiguratorPersona();
  configurator.provideConfig(built.spec.configurator?.inputs || {});
  built.spec.configurator.inputs.levelGen = configurator.prepareLevelGen({
    existingLevelGen: built.spec.configurator?.inputs?.levelGen || {},
    rooms,
    floorTiles,
    hazards,
  });
  if (maximizeBudget) {
    built.spec.configurator.inputs.maximizeBudget = true;
  }
  if (Array.isArray(resources) && resources.length > 0) {
    built.spec.configurator.inputs.resources = configurator.mapResources(resources);
  }

  applyAuthoringSection(built.spec, authoring, commandName);

  const buildResult = await orchestrateBuild({
    spec: built.spec,
    producedBy: source,
  });
  attachMixedRoomAssembliesToBuildResult(buildResult);
  applyMotivationToInitialStateActors(buildResult.initialState, { parsedDelvers, parsedWardens });

  return { spec: buildResult.spec, buildResult, requestArtifact };
}
