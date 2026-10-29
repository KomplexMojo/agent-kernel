import { UNUSED_CLOCK } from "../../../runtime/src/personas/_shared/require-clock.js";
import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { copyFileSync, existsSync, readFileSync, rmSync } from "node:fs";
import { resolve, dirname, isAbsolute, join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { randomInt } from "node:crypto";
import {
  launchCommand,
  playAsciiInteractive,
  playAsciiScripted,
  playSessionScripted,
  watchAsciiInteractive,
  watchAsciiScripted,
} from "./play-ascii.mjs";
import { createIpfsAdapter } from "../adapters/ipfs/index.js";
import { createBlockchainAdapter } from "../adapters/blockchain/index.js";
import { createLlmAdapter } from "../adapters/llm/index.js";
import { createFilesystemWorkflowStore } from "../adapters/adaptive-workflow/filesystem-store.js";
import { createRuntimeProfileAdapter } from "../adapters/adaptive-workflow/runtime-profile.js";
import { createControlledExecutionAdapter } from "../adapters/adaptive-workflow/controlled-execution.js";
import { createGameplayBridgeOperation } from "../adapters/adaptive-workflow/gameplay-bridge.js";
import { runAdaptiveWorkflow } from "../../../runtime/src/adaptive-workflow/runner.js";
import { createReplayEnvelope, createReplayModelAdapter } from "../../../runtime/src/adaptive-workflow/replay.js";
import { createStrategyPolicyV1 } from "../../../runtime/src/adaptive-workflow/strategy-policy.js";
import { createDeclaredModelCapabilityV1 } from "../../../runtime/src/adaptive-workflow/profiles.js";
import {
  buildBuildArtifacts,
  buildBuildManifestEntries,
  collectBuildOutputArtifactRecords,
  createCommandKernel,
  normalizeWorldStateCheckpoints,
} from "../../../runtime/src/commands/kernel.js";
import { orchestrateBuild } from "../../../runtime/src/build/orchestrate-build.js";
import { attachMixedRoomAssembliesToBuildResult } from "../../../runtime/src/build/authoring-build.js";
import { formatMixedRoomAssembliesCliLines } from "../../../runtime/src/build/mixed-room-summary.js";
import { buildBuildTelemetryRecord } from "../../../runtime/src/build/telemetry.js";
import { createSchemaCatalog, filterSchemaCatalogEntries } from "../../../runtime/src/contracts/schema-catalog.js";

import { ROOM_CARD_SIZE_IDS } from "../../../runtime/src/contracts/domain-constants.js";
import { createAllocatorPersona } from "../../../runtime/src/personas/allocator/persona.js";
import { readWastedRegen } from "../../../runtime/src/personas/allocator/controller.js";
import { createConfiguratorPersona } from "../../../runtime/src/personas/configurator/persona.js";
import { createDirectorPersona } from "../../../runtime/src/personas/director/persona.js";
// CR.7 / WP-5 — the vocabulary comes from CONTRACTS, not from the Orchestrator's alias of
// it. `prompt-contract.js` only renamed these (P5.1 D1: one value, three names), so the
// boundary crossing died with the hop rather than being republished. Aliased on import so
// the call sites below are untouched.
import {
  AFFINITY_KINDS as ALLOWED_AFFINITIES,
  AFFINITY_EXPRESSIONS as ALLOWED_AFFINITY_EXPRESSIONS,
  DELVER_SETUP_MODES as ALLOWED_DELVER_SETUP_MODES,
  MOTIVATION_KINDS as ALLOWED_MOTIVATIONS,
} from "../../../runtime/src/contracts/domain-constants.js";
// Genuinely Orchestrator law — the prompt contract itself — so taken from its barrel.
import { deriveAllowedOptionsFromCatalog, normalizeSummary, buildTacticPlanPrompt, readTacticPlanResponse } from "../../../runtime/src/personas/orchestrator/persona.js";
// CR.4 M5: the LLM session runs as an Orchestrator round; this host dispatches its
// `llm_request` effects through ports/effects.js so the IO happens in the adapter.
// Drop-in for runLlmSession (differential: tests/runtime/llm-host-loop.test.js).
import { runLlmSessionHosted } from "../../../runtime/src/commands/llm-host.js";
import { summarizeSolverDecisions } from "../../../runtime/src/commands/solver-host.js";
import { beginDirectorRound, directorBuildCapabilities } from "../../../runtime/src/commands/director-round.js";
import { runLlmBudgetLoop } from "../../../runtime/src/personas/orchestrator/persona.js";
import {
  applyActorOverrides,
  applyTileOverrides,
  barrierSpecsFromTileOverrides,
  normalizeArgList,
  resolveVitalDefaults,
  summarizeFrame,
} from "../../../runtime/src/commands/run-helpers.js";
import {
  resolveRunDir as resolveTickRunDir,
  readMaxTick,
  readCursor,
  writeCursor,
  renderAscii,
  readTickFrame,
  buildVisualizationSnapshot,
  validateVisualizationMode,
} from "../tick-session.mjs";
import { validateBuildSpec } from "../../../runtime/src/contracts/build-spec.js";
import { SANDBOX_SESSION_SCHEMA } from "../../../runtime/src/contracts/sandbox-session.mjs";
import { executeSandboxCreate, executeSandboxPlace, executeSandboxMove } from "../mcp/tools/sandbox.mjs";
import {
  DEFAULT_LLM_BASE_URL,
  DEFAULT_LLM_MODEL,
  DEFAULT_DUNGEON_AFFINITY,
  DEFAULT_ROOM_AFFINITY_EXPRESSION,
  DEFAULT_ROOM_CARD_AFFINITY,
  DEFAULT_VITALS,
  LLM_REPAIR_TEXT,
  HAZARD_VITAL_KEYS,
  VITAL_KEYS,
  appendLlmPromptSuffix,
  buildLlmActorConfigPromptTemplate,
  buildLlmCatalogRepairPromptTemplate,
  buildLlmConstraintSection,
  buildLlmRepairPromptTemplate,
} from "../../../runtime/src/contracts/domain-constants.js";
// M9: this file's whole schema vocabulary — the SCHEMAS alias table below, the four
// AdaptiveWorkflow constants it already imported, and the scattered literals in between —
// now has one origin.
import {
  ACTOR_LOADOUT_SCHEMA,
  ADAPTIVE_WORKFLOW_CLI_REQUEST_SCHEMA,
  ADAPTIVE_WORKFLOW_CLI_RUN_INPUT_SCHEMA,
  ADAPTIVE_WORKFLOW_EXECUTION_RECEIPT_SCHEMA,
  ADAPTIVE_WORKFLOW_STRATEGY_POLICY_SCHEMA,
  AFFINITY_PRESET_SCHEMA,
  AFFINITY_PRESET_SCHEMA_VERSIONS,
  AFFINITY_SUMMARY_SCHEMA,
  AGENT_COMMAND_REQUEST_SCHEMA,
  BUDGET_ARTIFACT_SCHEMA,
  BUDGET_RECEIPT_ARTIFACT_SCHEMA,
  CAPTURED_INPUT_SCHEMA,
  EFFECT_SCHEMA,
  EXECUTION_POLICY_SCHEMA,
  GAMEPLAY_BUNDLE_SCHEMA,
  HAZARD_ARTIFACT_SCHEMA,
  INITIAL_STATE_SCHEMA,
  INTENT_ENVELOPE_SCHEMA,
  NARRATIVE_ARTIFACT_SCHEMA,
  PLAN_ARTIFACT_SCHEMA,
  PRICE_LIST_SCHEMA,
  RESOURCE_ARTIFACT_SCHEMA,
  RUN_SUMMARY_SCHEMA,
  SIM_CONFIG_SCHEMA,
  SOLVER_REQUEST_SCHEMA,
  SOLVER_RESULT_SCHEMA,
  TELEMETRY_RECORD_SCHEMA,
  TICK_FRAME_SCHEMA,
} from "../../../runtime/src/contracts/artifacts.ts";
import { createAuthoringSpecs, parseArgs } from "../../../runtime/src/commands/authoring-specs.js";

// The authoring grammar and request assembly are runtime's (#557), shared with the browser.
const {
  applyBudgetCappedFulfillment,
  assertSchema,
  buildAuthoringSection,
  buildPoolWeightsForAuthoredKinds,
  buildSharedOptimizationGoals,
  configurator,
  dedupeOptimizationGoals,
  ensureBudgetedFulfillmentFeasible,
  extractBudgetTokensFromText,
  gradeAllocator,
  isNonEmptyString,
  parseActorStrategy,
  parseDelverSpecs,
  parseHazardSpecs,
  parsePositiveIntStrict,
  parseResourceSpecs,
  parseRoomSpecs,
  parseWardenSpecs,
  prepareAuthoringBuild,
  resolveAuthoringBudget,
  resolveTextVitalOptimizationGoals,
  tacticDirector,
} = createAuthoringSpecs({ makeId, readStrategyFile: (path) => readFileSync(resolvePath(path), "utf8") });

const SCHEMAS = Object.freeze({
  intent: INTENT_ENVELOPE_SCHEMA,
  plan: PLAN_ARTIFACT_SCHEMA,
  budgetReceipt: BUDGET_RECEIPT_ARTIFACT_SCHEMA,
  budgetArtifact: BUDGET_ARTIFACT_SCHEMA,
  budgetReceiptArtifact: BUDGET_RECEIPT_ARTIFACT_SCHEMA,
  priceList: PRICE_LIST_SCHEMA,
  simConfig: SIM_CONFIG_SCHEMA,
  initialState: INITIAL_STATE_SCHEMA,
  executionPolicy: EXECUTION_POLICY_SCHEMA,
  solverRequest: SOLVER_REQUEST_SCHEMA,
  solverResult: SOLVER_RESULT_SCHEMA,
  tickFrame: TICK_FRAME_SCHEMA,
  effect: EFFECT_SCHEMA,
  telemetry: TELEMETRY_RECORD_SCHEMA,
  runSummary: RUN_SUMMARY_SCHEMA,
  narrative: NARRATIVE_ARTIFACT_SCHEMA,
  agentCommandRequest: AGENT_COMMAND_REQUEST_SCHEMA,
  affinityPreset: AFFINITY_PRESET_SCHEMA,
  actorLoadout: ACTOR_LOADOUT_SCHEMA,
  affinitySummary: AFFINITY_SUMMARY_SCHEMA,
  capturedInput: CAPTURED_INPUT_SCHEMA,
});

const DEFAULT_ARTIFACTS_DIR = "artifacts";
const DEFAULT_RUNS_DIR = "runs";
const DEFAULT_TICKS = 1;
function usage() {
  const filename = fileURLToPath(new URL("./ak.mjs", import.meta.url));
  const base = resolve(dirname(filename), "../../../..");
  const rel = base && filename.startsWith(base)
    ? filename.slice(base.length + 1)
    : filename;
  return `Usage:
  node ${rel} build --spec path [--out-dir dir] [--emit-intermediates]
  node ${rel} schemas [--out-dir dir]
  node ${rel} solve --scenario "..." [--out-dir dir] [--run-id id] [--plan path] [--intent path] [--options path]
  node ${rel} solve --dir dir --question <place-objects|budget-fit> [--budget-tokens N] [--out-dir dir] [--run-id id]
  node ${rel} workflow <run|status|replay|cancel|validate> [--objective text | --input path] [--out-dir dir] [--policy path] [--runtime-profile path] [--dry-run]
  node ${rel} run (--sim-config path --initial-state path | --from-run runId) [--execution-policy path] [--ticks N] [--world-state-checkpoints ticks] [--seed N] [--out-dir dir] [--run-id id] [--actor spec] [--vital spec] [--vital-default spec] [--tile-wall xy] [--tile-barrier xy] [--tile-floor xy] [--actions path] [--affinity-presets path] [--affinity-loadouts path] [--affinity-summary path] [--progress] [--dry-run]
  node ${rel} configurator --level-gen path --actors path [--plan path] [--budget-receipt path] [--budget path --price-list path --receipt-out path] [--affinity-presets path] [--affinity-loadouts path] [--out-dir dir] [--run-id id]
  node ${rel} budget --budget path [--price-list path] [--receipt path] [--out-dir dir] [--out path] [--receipt-out path]
  node ${rel} replay --sim-config path --initial-state path --tick-frames path [--execution-policy path] [--ticks N] [--seed N] [--out-dir dir]
  node ${rel} inspect --tick-frames path [--effects-log path] [--build-dir dir] [--out-dir dir]
  node ${rel} narrate --tick-frames path --initial-state path [--out-dir dir]
  node ${rel} ipfs --cid cid [--path path] [--gateway url] [--json] [--fixture path] [--out path] [--out-dir dir]
  node ${rel} ipfs-publish --artifact-map path [--path root] [--gateway url] [--fixture-cid cid] [--out path] [--out-dir dir]
  node ${rel} ipfs-load --cid cid [--path root] [--file name --file name] [--gateway url] [--fixture-map path] [--out path] [--out-dir dir]
  node ${rel} blockchain --rpc-url url [--address addr] [--fixture-chain-id path] [--fixture-balance path] [--out path] [--out-dir dir]
  node ${rel} blockchain-mint --rpc-url url --card path [--owner addr] [--contract addr] [--token-id id] [--fixture-chain-id path] [--fixture-mint path] [--out path] [--out-dir dir]
  node ${rel} blockchain-load --rpc-url url --token-id id [--owner addr] [--contract addr] [--fixture-chain-id path] [--fixture-load path] [--out path] [--out-dir dir]
  node ${rel} llm [--model model] --prompt text [--base-url url] [--fixture path] [--out path] [--out-dir dir]
  node ${rel} llm-plan [--scenario path | (--text text | --prompt text) --catalog path] [--model model] [--goal text] [--budget-tokens N] [--base-url url] [--fixture path] [--budget-loop] [--budget-pool id=weight --budget-reserve N] [--out-dir dir] [--run-id id] [--created-at iso] [--emit-intermediates]
  node ${rel} scenario (--text text --catalog path [--model model] [--goal text] [--budget-tokens N] [--base-url url] [--fixture path] [--budget-loop] [--budget-pool id=weight --budget-reserve N] [--created-at iso] [--emit-intermediates] | --from-run runId | --sim-config path --initial-state path) [--ticks N] [--seed N] [--out-dir dir] [--run-id id] [--dry-run]
  node ${rel} show --run-id id
  node ${rel} diff --run-a id --run-b id
  node ${rel} create [--text text] [--room "..."] [--floor-tile "..."] [--hazard "..."] [--resource "..."] [--delver "..."] [--warden "..."] [--place "..."] [--tactic "..."] [--fixture path] [--model model] [--base-url url] [--seed N] [--goal text] [--dungeon-affinity affinity] [--budget-tokens N] [--dungeon-budget-tokens N] [--delver-budget-tokens N] [--grade H..S] [--budget path --price-list path] [--out-dir dir] [--run-id id] [--created-at iso] [--emit-intermediates] [--dry-run]
  node ${rel} configure [--text text] [--room "..."] [--floor-tile "..."] [--hazard "..."] [--resource "..."] [--delver "..."] [--warden "..."] [--place "..."] [--tactic "..."] [--seed N] [--goal text] [--dungeon-affinity affinity] [--budget-tokens N] [--dungeon-budget-tokens N] [--delver-budget-tokens N] [--grade H..S] [--budget path --price-list path] [--out-dir dir] [--run-id id] [--created-at iso] [--emit-intermediates]
  node ${rel} room-plan --room "size=small;count=2" [--room "..."] [--goal text] [--dungeon-affinity affinity] [--budget-tokens N] [--budget path --price-list path] [--out-dir dir] [--run-id id] [--created-at iso] [--emit-intermediates]
  node ${rel} hazard-plan --hazard "affinity=fire;expression=emit;proximityRadius=2[;mana=one-time:<amount>|regen:<current>:<max>:<regen>]" [--hazard "..."] [--goal text] [--dungeon-affinity affinity] [--budget-tokens N] [--budget path --price-list path] [--out-dir dir] [--run-id id] [--created-at iso] [--emit-intermediates]
  node ${rel} resource-plan --resource "permanenceMode=<consumable|level|permanent>;vital=<health|mana|stamina>;delta=<n>" [--resource "..."] [--goal text] [--dungeon-affinity affinity] [--budget-tokens N] [--budget path --price-list path] [--out-dir dir] [--run-id id] [--created-at iso] [--emit-intermediates]
  node ${rel} delver-plan --delver "count=2;affinity=fire;motivation=attacking[;goals=max_mana:high,mana_regen:high]" [--delver "..."] [--goal text] [--dungeon-affinity affinity] [--budget-tokens N] [--budget path --price-list path] [--out-dir dir] [--run-id id] [--created-at iso] [--emit-intermediates]
  node ${rel} warden-plan --warden "count=2;affinity=dark;motivation=defending" [--warden "..."] [--goal text] [--dungeon-affinity affinity] [--budget-tokens N] [--budget path --price-list path] [--out-dir dir] [--run-id id] [--created-at iso] [--emit-intermediates]
  node ${rel} runs list
  node ${rel} play [--dir dir | --from-run id | --sim-config path --initial-state path | --level name] [--keys keys] [--json] [--color | --no-color] [--no-fog] [--realtime ms] [--web [--port n] [--lan] [--debug]] [--record path] [--replay path]
  node ${rel} play --watch (--dir dir | --from-run id) [--tick N] [--keys keys] [--json] [--color | --no-color]
  node ${rel} play-session start [--session id] (--dir dir | --from-run id | --sim-config path --initial-state path | --level name) [--actor id|label] [--commands json] [--keys keys]
  node ${rel} play-session start [--session id] --load path
  node ${rel} play-session act|view|switch|end [--session id] [--actor id|label] [--commands json] [--keys keys] [--save path]
  node ${rel} play-session order [--session id] --actor id|label --strategy goals|json|file.json
  node ${rel} play-session advance [--session id] [--ticks n] [--until orders_done|contact]

Options:
  --out-dir       Output directory (default: ./artifacts/runs/<runId>/<command>)
  --out           Output file path (command-specific default when omitted)
  --ticks         Number of ticks for run/replay (default: ${DEFAULT_TICKS})
  --world-state-checkpoints  Comma-separated ticks to persist as WorldStateArtifact v2 files (run only)
  --seed          Seed for init (default: 0)
  --solver-fixture Fixture path for solve command (no network)
  --question      solve: ask about the built level in --dir (place-objects | budget-fit; budget-fit needs --budget-tokens)
  --actor         Actor spec: id,x,y,category (delver/warden/hazard/resource/barrier)
  --vital         Vital spec: actorId,vital,current,max,regen
  --vital-default Vital default: vital,current,max,regen
  --tile-wall     Terrain wall coordinate: x,y (repeatable)
  --tile-barrier  Barrier actor coordinate: x,y (repeatable)
  --tile-floor    Terrain floor coordinate: x,y (repeatable)
  --actions       Action log (ActionSequence) path for deterministic replay
  --from-run      Resolve sim-config.json and initial-state.json from artifacts/runs/<runId>/*
  --affinity-presets  Affinity preset artifact path (AffinityPresetArtifact)
  --affinity-loadouts Actor loadout artifact path (ActorLoadoutArtifact)
  --affinity-summary  Write affinity summary JSON (default: <out-dir>/affinity-summary.json)
  --level-gen     Level generation input path (Configurator levelGen input)
  --actors        Actors input path (object with actors array)
  --budget-receipt Budget receipt artifact path (BudgetReceiptArtifact)
  --budget        Budget artifact path (BudgetArtifact)
  --price-list    Price list artifact path (PriceList)
  --receipt       Budget receipt artifact path (BudgetReceiptArtifact)
  --receipt-out   Output path for budget receipt JSON
  --spec          Build spec JSON path (build command only)
  --text          Freeform agent authoring text captured in AgentCommandRequestArtifact
  --scenario      Scenario fixture path for llm-plan
  --catalog       Catalog path for text/prompt-only llm-plan runs
  --goal          Goal text override (llm-plan prompt-only)
  --text          Freeform text for llm-plan; when no fixture is provided, CLI falls back to the default stub summary fixture
  --dungeon-affinity Dungeon affinity for plan summary defaults
  --budget-tokens Hard budget cap in tokens. If freeform text also states a budget, they must match.
  --dungeon-budget-tokens Separate hard budget cap for dungeon-side objects (rooms, tiles, placedHazards, hazards).
  --delver-budget-tokens  Separate hard budget cap for delver-side objects (delvers, wardens).
  --grade             Level difficulty grade H (easiest) to S (ultra hard): the Allocator's budget and
                      dungeon/delver split for that grade (#422). --budget-tokens still wins (an override).
  --emit-intermediates Persist non-canonical sidecar artifacts such as request/intent/plan/solver/captured-input files
  --floor-tile    Floor tile spec for create/configure (repeatable): count=<n>[;id=<id>]
  --hazard        Hazard spec for create/configure/hazard-plan (repeatable): affinity=<kind>;expression=<push|pull|emit|draw>;proximityRadius=<n>[;stacks=<range>][;intensity=<n>][;mana=one-time:<amount>|regen:<current>:<max>:<regen>]
  --resource      Resource artifact spec for create/configure/resource-plan (repeatable).
  --tactic        Placement tactic for create/configure (repeatable): <ambush|retinue|minefield|shrine>[;key=value...]. The Director refuses an
                  unknown tactic, naming the known ones. The plan records each tactic and the placementReport says how it was
                  handled. ambush[;guards=<n>][;resources=<n>][;room=<id>][;visible=true] puts that many of the level's resources in
                  a room (room=, else picked from the seed) and seats that many of its wardens there out of sight of the room's
                  doorways (visible=true: in the open, within 2 of the loot); a room that can't hide them all hides what fits and
                  says so. retinue[;leader=<warden id>][;size=<n>] gives the leader (default: the first free warden) that many
                  minions (default 3) within 2 of it, by role from the affinity table: shield (emits the leader's kind),
                  support (the restoring kind for its defeat vital, push), striker (the leader's kind in a harmful expression
                  it lacks); the Allocator prices them as wardens, and a retinue the warden share can't afford shrinks.
                  minefield[;room=<id>][;hazards=<n>][;range=<n>][;kinds=<kind>+<kind>...] fills a room on the spawn-to-exit
                  route (room=, else picked from the seed) with that many emit hazards (default 4, range default 1) seated
                  clear of a safe line from doorway to doorway along the room's edge, plus one free resource as the reward;
                  kinds are drawn from the table's damaging kinds, no two opposite, unless kinds= names them. The Allocator
                  prices them from the hazard share, which shrinks a minefield it can't afford; the row names the room and
                  the safe line (safeLine: length, cells) and the short route's length.
                  shrine[;room=<id>][;count=<n>][;range=<n>][;kinds=<kind>+<kind>...] seats that many emit hazards (default 1,
                  range default 1) whose field restores a vital in a room off the spawn-to-exit route (room=, else picked from
                  the seed; a route room when there is no other), none touching another hazard; kinds are drawn from the
                  table's restoring kinds by the seed unless kinds= names them (restoring kinds only). A health shrine is
                  reported as a healing well. Priced from the hazard share like a minefield's hazards; the row lists shrines
                  (id, kind, restores, name).
                  llm (alone) asks the model (--fixture, or AK_LLM_LIVE=1; --model, --base-url) for the mix; an invalid reply
                  or no model falls back to auto's seeded pick, and the result's tacticPlan says which decided.
                  auto (alone) lets the Director pick a mix of these, with their sizes, from the seed; the result lists the picks.
                  With a tactic and no --seed, a seed is drawn; the result reports it (seed) so --seed rebuilds the level exactly.
  --place         Placement constraint for create/configure (repeatable): <subject>[;near=<target>:<d>][;far=<target>:<d>][;count=<n>][;onRoute|offRoute][;spread|clump][;outOfSight=room:<id>]
                  subject: hazard|resource|delver|warden:<id|n|*>; target: spawn, exit, room:<id> or one hazard|resource|delver|warden:<id|n>.
                  Distances are king moves (a room counts from its nearest cell). count=<n> with near= means at least n of the subjects;
                  onRoute is a cell every spawn-to-exit route passes; outOfSight=room:<id> is a cell no doorway of that room can see. A delver or warden named here is placed by this search, not seated
                  by the usual rules. A constraint that cannot hold refuses the level, naming it; the result's placementReport says how each held.
                  Vital payload:   permanenceMode=<consumable|level|permanent>;vital=<health|mana|stamina>;delta=<n>[;regen=<n>][;id=<id>]
                  permanenceMode governs delta only (consumable raises current, level/permanent raise max).
                  regen is a third, independent grant: the actor permanently gains that regen rate on top
                  of the delta. delta may be omitted when regen is given (a regen-only resource).
                  Affinity payload: affinity=<fire|water|earth|wind|growth|decay|corrode|fortify|light|dark>;expression=<push|pull|emit|draw>;stacks=<n>;mana=<n>[;manaRegen=<n>][;id=<id>]
                  Both payloads may be combined in one spec. manaRegen defaults to 0, which grants the
                  affinity temporarily until its mana is spent; manaRegen>0 refills the pool, making the
                  granted affinity permanent (and costing 5*manaRegen^2 more tokens to author).
                  Slots payload: slots=<n>[;id=<id>] is slot-unlock loot: taking it opens n more affinity
                  slots (an actor is capped at 6). The most valuable loot, priced per slot.
                  Legacy: tier=<level|permanent>;stat=<vitalMax|vitalRegen|affinity|affinityStack|pushExpression>;delta=<n>;dropRate=<n>[;id=<id>]
  --hazard          Hazard spec for create/configure (repeatable): x=<n>;y=<n>;affinity=<kind>[;expression=<push|pull|emit|draw>][;stacks=<range>][;intensity=<n>][;blocking=<true|false>][;id=<id>][;vitals=<vital>:<max>:<regen>|<vital>:<current>:<max>:<regen>,...]
  --room          Room spec for room-plan (repeatable): size=<small|medium|large>;count=<n>  (rooms are generic containers; affinity comes from --hazard placement)
                    where <expression> is push|pull (spatial) or emit|draw (field)
  --delver      Delver spec for delver-plan (repeatable): count=<n>;affinity=<kind>;motivation=<kind>[+<kind>...][;id=<id>][;affinities=<kind>[:<expression>[:<range>[:<intensity>]]],...][;vitals=<vital>:<max>:<regen>,...|<vital>:<current>:<max>:<regen>,...][;setup-mode=<auto|user|hybrid>][;goals=max_mana[:<priority>],mana_regen[:<priority>]][;slots=<n>][;equip=<kind>:<expression>[:<stacks>],...][;strategy=<goals>|<json>|<file.json>][;escort=<id>[:<distance>]]
                    where <expression> is push|pull (spatial) or emit|draw (field)
  --warden      Warden spec for warden-plan (repeatable): count=<n>;affinity=<kind>;motivation=<kind>[+<kind>...][;id=<id>][;affinities=<kind>[:<expression>[:<range>[:<intensity>]]],...][;vitals=<vital>:<max>:<regen>,...|<vital>:<current>:<max>:<regen>,...][;slots=<n>][;equip=<kind>:<expression>[:<stacks>],...][;strategy=<goals>|<json>|<file.json>][;escort=<id>[:<distance>]]
                    where <expression> is push|pull (spatial) or emit|draw (field)
                Delver and warden slots/equip (create too): slots=<n> sets affinity slots (1-6; preset delver 3, warden 2);
                each slot above the preset is charged at the slot-unlock price. equip= lists starting equips in order,
                each held by the actor; :<stacks> runs it at fewer stacks than it holds. Any mix may be equipped.
                Delver and warden strategy (create too): standing orders the actor follows on its own turns, as compact
                goals in order (reach:exit|reach:<x>/<y>, defeat:<id>, take:<id>, guard:<id>[:radius], follow:<id>[:distance],
                lead:<id>[:distance], hold:<x>/<y>:<ticks>, survive[:distance]), JSON { goals, tactics? } or a .json file.
                goal_oriented follows the goals, strategy_focused and user_controlled the tactics too; any other actor
                ignores it. The create result lists ignored parts and unknown targets under strategyReport.
  --prompt        Prompt override (llm-plan)
  --budget-loop   Enable budget loop (layout then actors)
  --budget-pool   Budget pool weight entry (repeatable): id=weight (e.g., player=0.2)
  --budget-reserve Reserve tokens before pooling (llm-plan budget loop)
  --model         LLM model name (default: ${DEFAULT_LLM_MODEL})
  --fixture       Fixture response for adapter commands (no network)
  --artifact-map  Canonical artifact JSON map path for ipfs-publish
  --fixture-cid   Deterministic CID for ipfs-publish fixture mode
  --fixture-map   Fixture JSON map for ipfs-load (keys are artifact paths under CID)
  --card          Card configuration JSON path for blockchain-mint
  --contract      Contract address or alias for blockchain-mint/load
  --token-id      Token identifier for blockchain-mint/load
  --fixture-mint  Fixture JSON-RPC response for blockchain-mint
  --fixture-load  Fixture JSON-RPC response for blockchain-load
  --run-id        Override run id for output artifacts
  --created-at    Override createdAt timestamp (ISO-8601) for llm-plan/room-plan/hazard-plan/resource-plan/delver-plan/warden-plan
  --dry-run       Validate schema/budget inputs without executing run or writing artifacts
  --dir           play: an \`ak create --out-dir\` or run directory holding sim-config.json + initial-state.json
                  solve --question: the same kind of built level directory
  --level         play: a bundled ui-ascii level (default: all bundled levels, in order)
  --keys          play: apply these keys without a terminal and print the final screen (e.g. "ddss.")
  --json          play: print { ok, level, turns, status, screen, launch, warnings? } instead of the screen
  --no-fog        play: debug view of the whole map (play is always under fog of war)
  --realtime      play: a turn passes every <ms> while you wait (interactive only; t toggles)
  --web           play: play in a browser tab on http://localhost:<port> (--port, default 8765; --lan for a phone on the same network; --debug adds the analysis console, evaluation only)
  --record        play: save the played commands to this path (CapturedInputArtifact)
  --replay        play: re-run a saved game on its level, then continue
  --watch         play: watch the run \`ak run\` recorded in --dir (or under artifacts/runs/<--from-run>), tick by tick
  --tick          play --watch: open at this tick (default 0)
  --session       play-session: the game's name (default "game"), kept in artifacts/play-sessions/<name>.json
  --actor         play-session: play this party member (a user_controlled actor, by id or label such as D2); free
  --commands      play-session: a JSON array of commands, each { kind, params?, actorId? } or { kind: "switch", actorId }
  --save          play-session: also copy the game to this path after the call (reopen it with start --load)
  --load          play-session start: begin from a game saved with --save, in place of a level
  --strategy      play-session order: the new strategy for --actor, as compact goals (follow:D1:2,reach:exit),
                  JSON { goals, tactics? } or a .json file. Taking it is that actor's turn and giving it yours.
  --ticks         play-session advance: how many ticks to let run (default 1, or 50 with --until)
  --until         play-session advance: stop early at orders_done (every order done or stalled) or contact
                  (a hostile in a party member's sight). The seated actor follows its own strategy, else waits.
  --help          Show this help

Schema discovery:
  schemas output includes ${SCHEMAS.agentCommandRequest} for the canonical
  agent-friendly authoring taxonomy and compilation contract.
`;
}

// D8.3 — the Director refuses to derive level geometry from room cards; it asks the
// Configurator. Taken from the PUBLIC persona barrel, so no boundary is crossed.
const configuratorRoomGeometry = Object.freeze({
  deriveRoomLayout: configurator.deriveRoomLayout,
  buildRoomDesign: configurator.buildRoomDesign,
});

function resolvePath(input, cwd = process.cwd()) {
  if (!input) {
    return null;
  }
  return isAbsolute(input) ? input : resolve(cwd, input);
}

function sanitizeFileSegment(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "capture";
}

function sanitizeFileName(value) {
  return String(value || "")
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "") || "capture";
}

function buildCapturedInputPath(adapter, index, outputRefId) {
  if (isNonEmptyString(outputRefId)) {
    return `${sanitizeFileName(outputRefId)}.json`;
  }
  return `captured-input-${sanitizeFileSegment(adapter)}-${index + 1}.json`;
}

function makeId(prefix) {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now().toString(36)}_${rand}`;
}

function createMeta({ producedBy, runId, correlationId, note } = {}) {
  return {
    id: makeId("artifact"),
    runId: runId || makeId("run"),
    createdAt: new Date().toISOString(),
    producedBy: producedBy || "cli",
    correlationId,
    note,
  };
}

function toRef(artifact) {
  if (!artifact || typeof artifact !== "object") {
    return null;
  }
  if (!artifact.schema || !artifact.schemaVersion) {
    return null;
  }
  const id = artifact.meta?.id || makeId("artifact");
  return {
    id,
    schema: artifact.schema,
    schemaVersion: artifact.schemaVersion,
  };
}

async function readJson(filePath) {
  const content = await readFile(filePath, "utf8");
  return JSON.parse(content);
}

async function readText(filePath) {
  return readFile(filePath, "utf8");
}

async function writeJson(filePath, value) {
  await mkdir(dirname(filePath), { recursive: true });
  const content = `${JSON.stringify(value, null, 2)}\n`;
  await writeFile(filePath, content, "utf8");
}

async function writeText(filePath, value) {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, value, "utf8");
}

function defaultRunDir(runId) {
  return resolve(process.cwd(), DEFAULT_ARTIFACTS_DIR, DEFAULT_RUNS_DIR, runId);
}

function defaultRunCommandOutDir(command, runId) {
  return resolve(defaultRunDir(runId), command);
}

const FROM_RUN_STAGE_PRIORITY = Object.freeze([
  "llm-plan",
  "build",
  "configurator",
  "create",
  "configure",
  "room-plan",
  "hazard-plan",
  "resource-plan",
  "delver-plan",
  "warden-plan",
  "run",
]);

function compareFromRunStagePriority(left, right) {
  const leftIndex = FROM_RUN_STAGE_PRIORITY.indexOf(left);
  const rightIndex = FROM_RUN_STAGE_PRIORITY.indexOf(right);
  const normalizedLeft = leftIndex === -1 ? Number.MAX_SAFE_INTEGER : leftIndex;
  const normalizedRight = rightIndex === -1 ? Number.MAX_SAFE_INTEGER : rightIndex;
  if (normalizedLeft !== normalizedRight) {
    return normalizedLeft - normalizedRight;
  }
  return left.localeCompare(right);
}

function normalizeCommandOutDirEntries(commandOutDirs) {
  if (commandOutDirs instanceof Map) {
    return Array.from(commandOutDirs.entries()).map(([command, outDir]) => ({ command, outDir }));
  }
  if (Array.isArray(commandOutDirs)) {
    return commandOutDirs
      .map((entry) => ({
        command: entry?.command,
        outDir: entry?.outDir,
      }));
  }
  if (commandOutDirs && typeof commandOutDirs === "object") {
    return Object.entries(commandOutDirs).map(([command, outDir]) => ({ command, outDir }));
  }
  return [];
}

function deriveCommonAncestor(paths) {
  const normalized = paths
    .map((value) => (isNonEmptyString(value) ? resolve(value) : ""))
    .filter(Boolean);
  if (normalized.length === 0) {
    return "";
  }
  const splitPaths = normalized.map((value) => value.split(sep).filter(Boolean));
  const prefix = [];
  const first = splitPaths[0];
  for (let index = 0; index < first.length; index += 1) {
    const segment = first[index];
    if (!splitPaths.every((parts) => parts[index] === segment)) {
      break;
    }
    prefix.push(segment);
  }
  if (prefix.length === 0) {
    return dirname(normalized[0]);
  }
  const absolutePrefix = `${sep}${prefix.join(sep)}`;
  return absolutePrefix || sep;
}

function deriveRememberedRunDir(entries) {
  const outDirs = entries
    .map((entry) => entry?.outDir)
    .filter((value) => isNonEmptyString(value));
  if (outDirs.length === 0) {
    return "";
  }
  if (outDirs.length === 1) {
    return outDirs[0];
  }
  return deriveCommonAncestor(outDirs);
}

export async function resolveFromRunArtifactPathsFromCommandOutDirs({
  runId,
  commandOutDirs,
} = {}) {
  if (!isNonEmptyString(runId)) {
    throw new Error("--from-run requires a non-empty run id.");
  }
  const entries = normalizeCommandOutDirEntries(commandOutDirs)
    .filter((entry) => isNonEmptyString(entry.command) && isNonEmptyString(entry.outDir))
    .sort((left, right) => compareFromRunStagePriority(left.command, right.command));
  if (entries.length === 0) {
    throw new Error(`--from-run could not find remembered artifacts for run ${runId}.`);
  }

  const runDir = deriveRememberedRunDir(entries);
  for (const entry of entries) {
    const simConfigPath = join(entry.outDir, "sim-config.json");
    const initialStatePath = join(entry.outDir, "initial-state.json");
    if (existsSync(simConfigPath) && existsSync(initialStatePath)) {
      return {
        runDir,
        sourceDir: entry.outDir,
        simConfigPath,
        initialStatePath,
      };
    }
  }

  let simConfigPath = null;
  let initialStatePath = null;
  for (const entry of entries) {
    if (!simConfigPath) {
      const candidate = join(entry.outDir, "sim-config.json");
      if (existsSync(candidate)) {
        simConfigPath = candidate;
      }
    }
    if (!initialStatePath) {
      const candidate = join(entry.outDir, "initial-state.json");
      if (existsSync(candidate)) {
        initialStatePath = candidate;
      }
    }
  }

  if (!simConfigPath || !initialStatePath) {
    throw new Error(`--from-run requires sim-config.json and initial-state.json for remembered run ${runId}.`);
  }

  return {
    runDir,
    sourceDir: dirname(simConfigPath) === dirname(initialStatePath) ? dirname(simConfigPath) : runDir,
    simConfigPath,
    initialStatePath,
  };
}

async function resolveFromRunArtifactPaths(runId) {
  if (!isNonEmptyString(runId)) {
    throw new Error("--from-run requires a non-empty run id.");
  }

  const runDir = defaultRunDir(runId);
  if (!existsSync(runDir)) {
    throw new Error(`--from-run could not find artifacts for run ${runId} under ${runDir}.`);
  }

  const dirents = await readdir(runDir, { withFileTypes: true });
  const candidateDirs = [
    runDir,
    ...dirents
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(runDir, entry.name))
      .sort((left, right) => compareFromRunStagePriority(left.slice(runDir.length + 1), right.slice(runDir.length + 1))),
  ];

  for (const candidateDir of candidateDirs) {
    const simConfigPath = join(candidateDir, "sim-config.json");
    const initialStatePath = join(candidateDir, "initial-state.json");
    if (existsSync(simConfigPath) && existsSync(initialStatePath)) {
      return { runDir, sourceDir: candidateDir, simConfigPath, initialStatePath };
    }
  }

  let simConfigPath = null;
  let initialStatePath = null;
  for (const candidateDir of candidateDirs) {
    if (!simConfigPath) {
      const candidate = join(candidateDir, "sim-config.json");
      if (existsSync(candidate)) {
        simConfigPath = candidate;
      }
    }
    if (!initialStatePath) {
      const candidate = join(candidateDir, "initial-state.json");
      if (existsSync(candidate)) {
        initialStatePath = candidate;
      }
    }
  }

  if (!simConfigPath || !initialStatePath) {
    throw new Error(`--from-run requires sim-config.json and initial-state.json under ${runDir}.`);
  }

  return {
    runDir,
    sourceDir: dirname(simConfigPath) === dirname(initialStatePath) ? dirname(simConfigPath) : runDir,
    simConfigPath,
    initialStatePath,
  };
}

async function resolveRunInputArgs(args, { commandName }) {
  const fromRunId = args["from-run"];
  if (!isNonEmptyString(fromRunId)) {
    return { ...args };
  }
  if (args["sim-config"] || args["initial-state"]) {
    throw new Error(`${commandName} does not allow --from-run together with --sim-config or --initial-state.`);
  }
  const resolved = await resolveFromRunArtifactPaths(fromRunId);
  return {
    ...args,
    "sim-config": resolved.simConfigPath,
    "initial-state": resolved.initialStatePath,
  };
}

function defaultOutDir(command, runId) {
  const resolvedRunId = runId || makeId("run");
  return defaultRunCommandOutDir(command, resolvedRunId);
}

function defaultBuildOutDir(spec) {
  return defaultRunCommandOutDir("build", spec.meta.runId);
}

function defaultLlmPlanOutDir(runId) {
  return defaultRunCommandOutDir("llm-plan", runId);
}

const STRUCTURED_STDOUT_COMMANDS = new Set([
  "play",
  "play-session",
  "solve",
  "build",
  "budget",
  "create",
  "configure",
  "room-plan",
  "hazard-plan",
  "resource-plan",
  "delver-plan",
  "warden-plan",
  "run",
  "inspect",
  "narrate",
  "llm-plan",
  "scenario",
  "show",
  "diff",
  "runs",
  "tick",
  "sandbox-create",
  "sandbox-place",
  "sandbox-move",
  "workflow",
]);

const RUN_INDEX_INPUT_FILES = Object.freeze([
  ["request", "request.json"],
  ["spec", "spec.json"],
  ["sim_config", "sim-config.json"],
  ["initial_state", "initial-state.json"],
  ["resolved_sim_config", "resolved-sim-config.json"],
  ["resolved_initial_state", "resolved-initial-state.json"],
  ["action_log", "action-log.json"],
]);

const RUN_INDEX_OUTPUT_FILES = Object.freeze([
  ["intent", "intent.json"],
  ["plan", "plan.json"],
  ["budget", "budget.json"],
  ["price_list", "price-list.json"],
  ["budget_receipt", "budget-receipt.json"],
  ["solver_request", "solver-request.json"],
  ["solver_result", "solver-result.json"],
  ["sim_config", "sim-config.json"],
  ["initial_state", "initial-state.json"],
  ["resource_bundle", "resource-bundle.json"],
  ["bundle", "bundle.json"],
  ["manifest", "manifest.json"],
  ["telemetry", "telemetry.json"],
  ["run_summary", "run-summary.json"],
  ["tick_frames", "tick-frames.json"],
  ["effects_log", "effects-log.json"],
  ["runtime_budget_receipt", "runtime-budget-receipt.json"],
  ["runtime_decision_captures", "runtime-decision-captures.json"],
  ["inspect_summary", "inspect-summary.json"],
  ["narrative", "narrative.json"],
  ["affinity_summary", "affinity-summary.json"],
]);

function emitJsonStdout(payload) {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

function emitJsonStderr(payload) {
  process.stderr.write(`${JSON.stringify(payload)}\n`);
}

async function listDirectoryNames(path) {
  if (!path || !existsSync(path)) {
    return [];
  }
  const entries = await readdir(path, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));
}

function buildArtifactPathMap({ outDir, manifestEntries = [] } = {}) {
  const artifactPaths = {};
  artifactPaths.spec = join(outDir, "spec.json");
  artifactPaths.bundle = join(outDir, "bundle.json");
  artifactPaths.manifest = join(outDir, "manifest.json");
  artifactPaths.telemetry = join(outDir, "telemetry.json");
  manifestEntries.forEach((entry) => {
    if (!entry?.path) {
      return;
    }
    const key = entry.path.replace(/\.json$/i, "").replaceAll(/[^A-Za-z0-9]+/g, "_");
    artifactPaths[key] = join(outDir, entry.path);
  });
  return artifactPaths;
}

function deriveActorIds(initialState) {
  const actors = Array.isArray(initialState?.actors) ? initialState.actors : [];
  return actors
    .map((actor) => actor?.id)
    .filter((id) => typeof id === "string" && id.length > 0);
}

function deriveRoomIds(simConfig) {
  const rooms = Array.isArray(simConfig?.layout?.data?.rooms) ? simConfig.layout.data.rooms : [];
  return rooms
    .map((room) => room?.id)
    .filter((id) => typeof id === "string" && id.length > 0);
}

const REQUIRED_PREVIEW_CARD_TYPES = Object.freeze(["room", "delver", "warden"]);

function stablePreviewCardKey(card, index) {
  const id = typeof card?.id === "string" ? card.id.trim() : "";
  if (id) return `id:${id}`;
  return `index:${index}:${JSON.stringify(card || {})}`;
}

function mergePreviewCardArrays(...sources) {
  const merged = new Map();
  sources.forEach((cards) => {
    if (!Array.isArray(cards)) return;
    cards.forEach((card, index) => {
      if (!card || typeof card !== "object" || Array.isArray(card)) return;
      const key = stablePreviewCardKey(card, index);
      const previous = merged.get(key);
      merged.set(key, previous ? { ...previous, ...card } : { ...card });
    });
  });
  return Array.from(merged.values());
}

function collectPreviewCardSet(spec) {
  return mergePreviewCardArrays(
    spec?.configurator?.inputs?.cardSet,
    spec?.plan?.hints?.cardSet,
  );
}

// Finding #4: `create`/`configure`'s positioned --hazard/--resource land straight in the
// grid (spec.configurator.inputs.levelGen.hazards / .resources) and never produce a
// plan.hints.cardSet entry — cards are structurally unpositioned everywhere in this codebase
// (createDesignCard has no x/y field), so this is intentional, not a gap to close. What was
// missing was any signal in the response itself: a caller authoring a hazard/resource had no
// way to know it landed placed-only instead of as a reviewable Design-tab card. Surfaced only
// when at least one was actually placed, so most create/configure calls stay unaffected.
function buildPlacedObjectsNote(spec) {
  const placedHazards = Array.isArray(spec?.configurator?.inputs?.levelGen?.hazards)
    ? spec.configurator.inputs.levelGen.hazards.length
    : 0;
  const placedResources = Array.isArray(spec?.configurator?.inputs?.resources)
    ? spec.configurator.inputs.resources.length
    : 0;
  if (placedHazards === 0 && placedResources === 0) {
    return undefined;
  }
  const cardSet = collectPreviewCardSet(spec);
  const cardCount = (type) => cardSet.filter((card) => normalizePreviewCardType(card?.type) === type).length;
  const note = {};
  if (placedHazards > 0) {
    note.hazards = { placed: placedHazards, cards: cardCount("hazard") };
  }
  if (placedResources > 0) {
    note.resources = { placed: placedResources, cards: cardCount("resource") };
  }
  return note;
}

function normalizePreviewCardType(type) {
  const normalized = typeof type === "string" ? type.trim().toLowerCase() : "";
  if (normalized === "attacker") return "delver";
  if (normalized === "defender") return "warden";
  return normalized;
}

function readConfiguredPreviewCount(count) {
  const parsed = Number(count);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return Math.floor(parsed);
}

function buildPreviewSummary({
  outDir,
  manifestEntries = [],
  initialState = null,
  simConfig = null,
  spec = null,
} = {}) {
  const resourceBundleEntry = manifestEntries.find((entry) => entry?.path === "resource-bundle.json");
  const cardSet = collectPreviewCardSet(spec);
  const counts = REQUIRED_PREVIEW_CARD_TYPES.reduce((acc, type) => ({ ...acc, [type]: 0 }), {});
  cardSet.forEach((entry) => {
    const type = normalizePreviewCardType(entry?.type);
    if (!REQUIRED_PREVIEW_CARD_TYPES.includes(type)) return;
    counts[type] += readConfiguredPreviewCount(entry?.count ?? 1);
  });
  return {
    ready: Boolean(simConfig && resourceBundleEntry),
    bundlePath: join(outDir, "bundle.json"),
    manifestPath: join(outDir, "manifest.json"),
    resourceBundlePath: join(outDir, "resource-bundle.json"),
    hasActors: deriveActorIds(initialState).length > 0,
    runReady: REQUIRED_PREVIEW_CARD_TYPES.every((type) => counts[type] > 0),
  };
}

function buildStructuredSuccessSummary({
  command,
  outDir,
  runId,
  manifestEntries = [],
  initialState = null,
  simConfig = null,
  spec = null,
  extra = {},
} = {}) {
  const summary = {
    ok: true,
    command,
    runId,
    outDir,
    actorIds: deriveActorIds(initialState),
    roomIds: deriveRoomIds(simConfig),
    artifactPaths: buildArtifactPathMap({ outDir, manifestEntries }),
    preview: buildPreviewSummary({
      outDir,
      manifestEntries,
      initialState,
      simConfig,
      spec,
    }),
  };
  // Strategy parts an actor will not follow, and targets not in the level: reported, never refused.
  const strategyReport = initialState?.strategies ? configurator.authorCandidates.reportActorStrategies(initialState) : [];
  if (strategyReport.length > 0) summary.strategyReport = strategyReport;
  Object.entries(extra).forEach(([key, value]) => {
    if (value !== undefined) {
      summary[key] = value;
    }
  });
  return summary;
}

async function readJsonIfExists(path) {
  if (!path || !existsSync(path)) {
    return null;
  }
  return readJson(path);
}

// A `run` outDir holds no sim-config.json / initial-state.json of its own: the level it
// played is embedded in that run's GameplayBundle. Readers that need the level (show, diff)
// fall back to the bundle so every run made with `run --from-run` stays describable.
async function readEmbeddedBundleArtifact(outDir, schema) {
  const bundle = await readJsonIfExists(join(outDir, "bundle.json"));
  const artifacts = Array.isArray(bundle?.artifacts) ? bundle.artifacts : [];
  return artifacts.find((artifact) => artifact?.schema === schema) || null;
}

async function readLevelArtifactsForOutDir(outDir) {
  const simConfig = await readJsonIfExists(join(outDir, "sim-config.json"))
    || await readEmbeddedBundleArtifact(outDir, SCHEMAS.simConfig);
  const initialState = await readJsonIfExists(join(outDir, "initial-state.json"))
    || await readEmbeddedBundleArtifact(outDir, SCHEMAS.initialState);
  return { simConfig, initialState };
}

async function summarizeBuildLikeOutput({
  command,
  outDir,
  extra = {},
} = {}) {
  const manifest = await readJsonIfExists(join(outDir, "manifest.json"));
  const spec = await readJsonIfExists(join(outDir, "spec.json"));
  const simConfig = await readJsonIfExists(join(outDir, "sim-config.json"));
  const initialState = await readJsonIfExists(join(outDir, "initial-state.json"));
  return buildStructuredSuccessSummary({
    command,
    outDir,
    runId: spec?.meta?.runId || manifest?.correlation?.runId || "",
    manifestEntries: Array.isArray(manifest?.artifacts) ? manifest.artifacts : [],
    initialState,
    simConfig,
    spec,
    extra,
  });
}

// M8: GAMEPLAY_BUNDLE_SCHEMA now comes from contracts/artifacts.ts. It was declared
// here AND in ui-web/src/phaser-surface-ingestion.js — the writer and the reader of the
// same bundle, each with its own origin.

// Assemble a post-run agent-kernel/GameplayBundle by merging the resolved
// SimConfig/InitialState artifacts that `run` writes with the tick frames it
// recorded. Matches the shape produced by
// packages/runtime/src/runner/core-facade.js compileScenarioPlaybackBundle
// ({ schema, schemaVersion, meta, artifacts: [simConfig, initialState], spec, tickFrames })
// so the UI's window.__ak_loadGameplayBundle / sandbox-bridge-client can consume
// it unchanged. Unlike compileScenarioPlaybackBundle (which re-runs the
// simulation itself), this reuses the tick frames already produced by `run`
// rather than re-executing the sim.
function buildGameplayBundleFromRunArtifacts({
  runId,
  createdAt,
  simConfig,
  initialState,
  tickFrames,
  runtimeBudgetReceipt = null,
  spec,
} = {}) {
  if (!simConfig || !initialState || !Array.isArray(tickFrames)) {
    return null;
  }
  return {
    schema: GAMEPLAY_BUNDLE_SCHEMA,
    schemaVersion: 1,
    meta: {
      id: runId || simConfig?.meta?.runId || initialState?.meta?.runId || "run",
      runId: runId || simConfig?.meta?.runId || initialState?.meta?.runId || "run",
      createdAt: createdAt || new Date().toISOString(),
      producedBy: "cli-run",
    },
    artifacts: [simConfig, initialState, ...(runtimeBudgetReceipt ? [runtimeBudgetReceipt] : [])],
    ...(spec ? { spec } : {}),
    tickFrames,
  };
}

async function summarizeRunOutput({ outDir, args, pricingReport } = {}) {
  const runSummary = await readJsonIfExists(join(outDir, "run-summary.json"));
  const resolvedSimConfigPath = join(outDir, "resolved-sim-config.json");
  const resolvedInitialStatePath = join(outDir, "resolved-initial-state.json");
  const simConfig = await readJsonIfExists(
    existsSync(resolvedSimConfigPath) ? resolvedSimConfigPath : resolvePath(args["sim-config"])
  );
  const initialState = await readJsonIfExists(
    existsSync(resolvedInitialStatePath) ? resolvedInitialStatePath : resolvePath(args["initial-state"])
  );
  const artifactPaths = {
    tick_frames: join(outDir, "tick-frames.json"),
    effects_log: join(outDir, "effects-log.json"),
    runtime_budget_receipt: join(outDir, "runtime-budget-receipt.json"),
    runtime_decision_captures: join(outDir, "runtime-decision-captures.json"),
    run_summary: join(outDir, "run-summary.json"),
    action_log: join(outDir, "action-log.json"),
  };
  const affinitySummaryPath = join(outDir, "affinity-summary.json");
  if (existsSync(affinitySummaryPath)) {
    artifactPaths.affinity_summary = affinitySummaryPath;
  }
  if (existsSync(resolvedSimConfigPath)) {
    artifactPaths.resolved_sim_config = resolvedSimConfigPath;
  }
  if (existsSync(resolvedInitialStatePath)) {
    artifactPaths.resolved_initial_state = resolvedInitialStatePath;
  }
  // #278: overrides are re-priced by the Allocator, which writes its receipt with the resolved level.
  if (pricingReport) {
    artifactPaths.price_list = join(outDir, "price-list.json");
    artifactPaths.budget_receipt = join(outDir, "budget-receipt.json");
  }

  // M7 gap 3: stitch a post-run agent-kernel/GameplayBundle from the artifacts
  // this run just (re)wrote so ak_push_to_ui has something to deliver to the UI.
  const runId = runSummary?.meta?.runId || simConfig?.meta?.runId || initialState?.meta?.runId || "";
  const tickFrames = await readJsonIfExists(artifactPaths.tick_frames);
  const runtimeBudgetReceipt = await readJsonIfExists(artifactPaths.runtime_budget_receipt);
  // When the run's inputs came from an ak_create outDir, that directory holds
  // the pre-run preview bundle.json ({ spec, schemas, artifacts } — no
  // schema/schemaVersion/tickFrames). Carry its spec/schemas and any artifacts
  // that the run does not supersede (e.g. ResourceBundleArtifact) into the
  // post-run bundle, and upgrade that sibling bundle.json in place so the
  // create outDir also ends up holding a loadable playback bundle.
  const sourceSimConfigPath = resolvePath(args["sim-config"]);
  const createBundlePath = sourceSimConfigPath ? join(dirname(sourceSimConfigPath), "bundle.json") : null;
  // Only stitch when the run's inputs came from an authored create outDir
  // (identified by its pre-run bundle.json sibling). Fixture-driven runs stay
  // bundle-free so CLI run output remains artifact-for-artifact equivalent to
  // the browser host's run output (tests/integration/ui-cli-equivalence.test.js).
  // Read unconditionally: when --out-dir is run in place (the same directory
  // as --sim-config, a natural choice with nothing in the CLI docs against
  // it), createBundlePath equals the run's own bundle.json path, but the read
  // still happens before that same path is overwritten below — there is no
  // race to guard against, so skipping the read here just as silently dropped
  // every run's tick frames from the bundle the UI loads.
  const createBundle = createBundlePath ? await readJsonIfExists(createBundlePath) : null;
  const bundle = createBundle && typeof createBundle === "object"
    ? buildGameplayBundleFromRunArtifacts({
      runId,
      createdAt: runSummary?.meta?.createdAt,
      simConfig,
      initialState,
      tickFrames: Array.isArray(tickFrames) ? tickFrames : null,
      runtimeBudgetReceipt,
      spec: createBundle.spec,
    })
    : null;
  if (bundle) {
    const SUPERSEDED_BY_RUN = new Set([
      simConfig?.schema,
      initialState?.schema,
    ]);
    const carriedArtifacts = Array.isArray(createBundle.artifacts)
      ? createBundle.artifacts.filter((artifact) => artifact?.schema && !SUPERSEDED_BY_RUN.has(artifact.schema))
      : [];
    if (carriedArtifacts.length > 0) {
      bundle.artifacts = [...bundle.artifacts, ...carriedArtifacts];
    }
    if (createBundle.schemas !== undefined) {
      bundle.schemas = createBundle.schemas;
    }
    const bundlePath = join(outDir, "bundle.json");
    await writeJson(bundlePath, bundle);
    artifactPaths.bundle = bundlePath;
    await writeJson(createBundlePath, bundle);
    artifactPaths.create_bundle = createBundlePath;
  }

  return {
    ok: true,
    command: "run",
    runId,
    outDir,
    actorIds: deriveActorIds(initialState),
    roomIds: deriveRoomIds(simConfig),
    artifactPaths,
    ticks: runSummary?.metrics?.ticks,
    ...(pricingReport ? { pricingReport } : {}),
  };
}

async function summarizeInspectOutput({ outDir, runtimeBudgetReceiptPath = null, buildDir = null } = {}) {
  const inspectSummary = await readJsonIfExists(join(outDir, "inspect-summary.json"));
  const runtimeBudgetReceipt = await readJsonIfExists(runtimeBudgetReceiptPath);
  const runtimeBudget = runtimeBudgetReceipt && typeof runtimeBudgetReceipt === "object"
    ? {
      unit: runtimeBudgetReceipt.unit,
      rows: runtimeBudgetReceipt.rows,
      actorTotals: runtimeBudgetReceipt.actorTotals,
      unattributedUnits: runtimeBudgetReceipt.unattributedUnits,
      totalUnits: runtimeBudgetReceipt.totalUnits,
    }
    : null;
  const summary = {
    ok: true,
    command: "inspect",
    runId: inspectSummary?.meta?.runId || "",
    outDir,
    actorIds: [],
    roomIds: [],
    artifactPaths: {
      inspect_summary: join(outDir, "inspect-summary.json"),
    },
    ticks: inspectSummary?.data?.ticks,
  };
  if (runtimeBudgetReceiptPath && runtimeBudget) {
    summary.artifactPaths.runtime_budget_receipt = runtimeBudgetReceiptPath;
    summary.runtimeBudget = runtimeBudget;
  }
  // #299: the build that made this level, and which of its decisions the solver made.
  const buildTelemetry = buildDir ? await readJsonIfExists(join(buildDir, "telemetry.json")) : null;
  if (buildTelemetry) {
    summary.artifactPaths.build_telemetry = join(buildDir, "telemetry.json");
    summary.solverDecisions = summarizeSolverDecisions(buildTelemetry.data?.solverDecisions) || "none recorded";
  }
  return summary;
}

async function summarizeNarrateOutput({ outDir } = {}) {
  const narrative = await readJsonIfExists(join(outDir, "narrative.json"));
  return {
    ok: true,
    command: "narrate",
    runId: narrative?.meta?.runId || "",
    outDir,
    actorIds: Array.isArray(narrative?.cast) ? narrative.cast.map((entry) => entry.id) : [],
    roomIds: [],
    artifactPaths: {
      narrative: join(outDir, "narrative.json"),
    },
    ticks: narrative?.source?.ticks ?? (Array.isArray(narrative?.turns) ? narrative.turns.length : undefined),
  };
}

function humanizeToken(value) {
  return String(value || "").replaceAll("_", " ").trim();
}

function formatNarrativeValue(value) {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value.map((entry) => formatNarrativeValue(entry)).join(", ");
  }
  if (value && typeof value === "object") {
    return JSON.stringify(value);
  }
  return "";
}

function formatNarrativeDetails(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return "";
  }
  const entries = Object.entries(data)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${humanizeToken(key)}=${formatNarrativeValue(value)}`);
  return entries.length > 0 ? ` (${entries.join(", ")})` : "";
}

function buildNarrativeCast(initialState) {
  return Array.isArray(initialState?.actors)
    ? initialState.actors.map((actor) => ({
      id: actor.id,
      label: isNonEmptyString(actor?.archetype) ? `${actor.archetype} ${actor.id}` : actor.id,
      kind: actor.kind,
      archetype: actor.archetype,
    }))
    : [];
}

function buildNarrativeActorLabelLookup(cast) {
  return new Map(cast.map((entry) => [entry.id, entry.label]));
}

function getNarrativeActorLabel(actorId, actorLabels) {
  return actorLabels.get(actorId) || actorId || "system";
}

function describeNarrativeAction(action, actorLabels) {
  const subject = getNarrativeActorLabel(action?.actorId, actorLabels);
  return `${subject} chose ${humanizeToken(action?.kind || "action")}${formatNarrativeDetails(action?.params)}.`;
}

function describeNarrativePreCoreRejection(record, actorLabels) {
  const action = record?.action || {};
  const subject = getNarrativeActorLabel(action.actorId, actorLabels);
  const reason = isNonEmptyString(record?.reason) ? record.reason.trim() : "rejected before core execution";
  return `${subject} could not ${humanizeToken(action.kind || "act")}: ${reason}.`;
}

function describeNarrativeEvent(event, actorLabels) {
  const subject = getNarrativeActorLabel(event?.actorId, actorLabels);
  if (event?.kind === "action_applied" && isNonEmptyString(event?.data?.action)) {
    return `${subject} completed ${humanizeToken(event.data.action)}.`;
  }
  if (event?.kind === "actor_moved") {
    const destination = event?.data?.to || event?.data?.position;
    if (destination && typeof destination === "object") {
      return `${subject} moved to ${formatNarrativeValue(destination)}.`;
    }
  }
  if (event?.kind === "actor_blocked") {
    return `${subject} was blocked${formatNarrativeDetails(event?.data)}.`;
  }
  if (event?.kind === "state_changed" && isNonEmptyString(event?.data?.state)) {
    return `${subject} changed state to ${event.data.state}.`;
  }
  return `${subject} triggered ${humanizeToken(event?.kind || "event")}${formatNarrativeDetails(event?.data)}.`;
}

function describeNarrativeEffect(effect) {
  const source = isNonEmptyString(effect?.personaRef) ? effect.personaRef : "runtime";
  return `${source} emitted ${humanizeToken(effect?.kind || "effect")}${formatNarrativeDetails(effect?.data)}.`;
}

function describeNarrativeFulfillment(record) {
  const kind = humanizeToken(record?.effect?.kind || "effect");
  const status = record?.status || "processed";
  const reason = isNonEmptyString(record?.reason) ? `: ${record.reason.trim()}` : "";
  const result = record?.result && typeof record.result === "object"
    ? ` ${formatNarrativeDetails(record.result).trim()}`
    : "";
  return `${kind} was ${status}${reason}${result}.`;
}

function buildNarrativeTurns(frames, actorLabels) {
  const grouped = new Map();
  for (const frame of frames) {
    const tick = Number.isFinite(frame?.tick) ? frame.tick : 0;
    if (!grouped.has(tick)) {
      grouped.set(tick, []);
    }
    grouped.get(tick).push(frame);
  }

  return Array.from(grouped.entries())
    .sort((left, right) => left[0] - right[0])
    .map(([tick, tickFrames]) => {
      const lines = [];
      let actions = 0;
      let events = 0;
      let effects = 0;
      const phases = new Set();

      for (const frame of tickFrames) {
        phases.add(frame?.phaseDetail || frame?.phase || "unknown");

        for (const action of Array.isArray(frame?.acceptedActions) ? frame.acceptedActions : []) {
          actions += 1;
          lines.push(describeNarrativeAction(action, actorLabels));
        }
        for (const record of Array.isArray(frame?.preCoreRejections) ? frame.preCoreRejections : []) {
          actions += 1;
          lines.push(describeNarrativePreCoreRejection(record, actorLabels));
        }
        for (const event of Array.isArray(frame?.emittedEvents) ? frame.emittedEvents : []) {
          events += 1;
          lines.push(describeNarrativeEvent(event, actorLabels));
        }
        for (const effect of Array.isArray(frame?.emittedEffects) ? frame.emittedEffects : []) {
          effects += 1;
          lines.push(describeNarrativeEffect(effect));
        }
        for (const record of Array.isArray(frame?.fulfilledEffects) ? frame.fulfilledEffects : []) {
          effects += 1;
          lines.push(describeNarrativeFulfillment(record));
        }
      }

      const phaseSummary = Array.from(phases).join(", ");
      const summary = `Observed ${tickFrames.length} frame${tickFrames.length === 1 ? "" : "s"} during ${phaseSummary}; ${actions} action${actions === 1 ? "" : "s"}, ${events} event${events === 1 ? "" : "s"}, ${effects} effect${effects === 1 ? "" : "s"}.`;
      return {
        tick,
        title: `Turn ${tick}`,
        summary,
        lines: lines.length > 0 ? lines : ["No notable actions were recorded."],
        stats: {
          frames: tickFrames.length,
          actions,
          events,
          effects,
        },
      };
    });
}

function buildNarrativeStory(turns) {
  return turns.map((turn) => [
    `${turn.title}: ${turn.summary}`,
    ...turn.lines.map((line) => `- ${line}`),
  ].join("\n")).join("\n\n");
}

function createNarrativeArtifact({ initialState, frames, runId } = {}) {
  const cast = buildNarrativeCast(initialState);
  const actorLabels = buildNarrativeActorLabelLookup(cast);
  const turns = buildNarrativeTurns(frames, actorLabels);
  const story = buildNarrativeStory(turns);
  return {
    schema: SCHEMAS.narrative,
    schemaVersion: 1,
    meta: createMeta({ producedBy: "cli-narrate", runId }),
    source: {
      initialStateRef: toRef(initialState) || undefined,
      frames: frames.length,
      ticks: turns.length,
    },
    cast,
    summary: `Generated ${turns.length} turn${turns.length === 1 ? "" : "s"} from ${frames.length} tick frame${frames.length === 1 ? "" : "s"}.`,
    story,
    turns,
  };
}

function prefixArtifactPaths(paths, prefix) {
  return Object.fromEntries(
    Object.entries(paths || {}).map(([key, value]) => [`${prefix}${key}`, value])
  );
}

function buildScenarioSummary({
  runId,
  outDir,
  llmPlanSummary,
  sourceArtifactPaths,
  runSummary,
  inspectSummary,
} = {}) {
  return {
    ok: true,
    command: "scenario",
    runId,
    outDir,
    actorIds: Array.isArray(runSummary?.actorIds) ? runSummary.actorIds : [],
    roomIds: Array.isArray(runSummary?.roomIds) ? runSummary.roomIds : [],
    artifactPaths: {
      ...prefixArtifactPaths(llmPlanSummary?.artifactPaths, "llm_plan_"),
      ...(sourceArtifactPaths || {}),
      ...prefixArtifactPaths(runSummary?.artifactPaths, ""),
      ...prefixArtifactPaths(inspectSummary?.artifactPaths, ""),
    },
    ticks: inspectSummary?.ticks ?? runSummary?.ticks,
  };
}

function toRunIndexArtifactRecord({ key, outDir, fileName, payload } = {}) {
  const record = {
    key,
    path: join(outDir, fileName),
  };
  if (payload?.schema) {
    record.schema = payload.schema;
  }
  if (payload?.schemaVersion !== undefined) {
    record.schemaVersion = payload.schemaVersion;
  }
  if (payload?.meta?.id) {
    record.id = payload.meta.id;
  }
  if (payload?.meta?.createdAt) {
    record.createdAt = payload.meta.createdAt;
  }
  return record;
}

async function collectRunIndexArtifactRecords(outDir, entries) {
  const records = [];
  for (const [key, fileName] of entries) {
    const payload = await readJsonIfExists(join(outDir, fileName));
    if (!payload) {
      continue;
    }
    records.push(toRunIndexArtifactRecord({ key, outDir, fileName, payload }));
  }
  return records;
}

function deriveRunIndexStatus({ telemetry, runSummary, outputCount } = {}) {
  if (isNonEmptyString(telemetry?.data?.status)) {
    return telemetry.data.status;
  }
  if (isNonEmptyString(runSummary?.outcome) && runSummary.outcome !== "unknown") {
    return runSummary.outcome;
  }
  if (outputCount > 0) {
    return "success";
  }
  return "incomplete";
}

function deriveRunStatus(commands) {
  const statuses = Array.from(new Set(commands.map((entry) => entry.status).filter(isNonEmptyString)));
  if (statuses.length === 0) {
    return "unknown";
  }
  if (statuses.length === 1) {
    return statuses[0];
  }
  return "mixed";
}

function deriveBudgetSpend(budgetReceipt) {
  if (!budgetReceipt || budgetReceipt.schema !== SCHEMAS.budgetReceiptArtifact) {
    return undefined;
  }
  const summary = {
    status: budgetReceipt.status,
    totalCost: budgetReceipt.totalCost,
    remaining: budgetReceipt.remaining,
  };
  if (budgetReceipt.scenarioSpendReport && typeof budgetReceipt.scenarioSpendReport === "object") {
    summary.scenarioSpendReport = budgetReceipt.scenarioSpendReport;
  }
  return summary;
}

const DIFF_STAGE_PRIORITY = Object.freeze([
  "run",
  "replay",
  "scenario",
  "inspect",
  "build",
  "create",
  "configure",
  "llm-plan",
]);

function compareDiffStagePriority(left, right) {
  const leftIndex = DIFF_STAGE_PRIORITY.indexOf(left);
  const rightIndex = DIFF_STAGE_PRIORITY.indexOf(right);
  const normalizedLeft = leftIndex === -1 ? Number.MAX_SAFE_INTEGER : leftIndex;
  const normalizedRight = rightIndex === -1 ? Number.MAX_SAFE_INTEGER : rightIndex;
  if (normalizedLeft !== normalizedRight) {
    return normalizedLeft - normalizedRight;
  }
  return left.localeCompare(right);
}

function deriveTickCount(runSummary, tickFrames) {
  if (Number.isFinite(runSummary?.metrics?.ticks)) {
    return runSummary.metrics.ticks;
  }
  return Array.isArray(tickFrames)
    ? tickFrames.reduce((maxTick, frame) => Math.max(maxTick, Number.isFinite(frame?.tick) ? frame.tick : 0), 0)
    : 0;
}

function deriveEffectCount(runSummary, tickFrames) {
  if (Number.isFinite(runSummary?.metrics?.effects)) {
    return runSummary.metrics.effects;
  }
  return Array.isArray(tickFrames)
    ? tickFrames.reduce(
      (total, frame) => total + (Array.isArray(frame?.emittedEffects) ? frame.emittedEffects.length : 0),
      0,
    )
    : 0;
}

function buildActorRecordMap(initialState) {
  const actors = Array.isArray(initialState?.actors) ? initialState.actors : [];
  return new Map(
    actors
      .filter((actor) => isNonEmptyString(actor?.id))
      .map((actor) => [actor.id, actor]),
  );
}

function addActorDamage(damageByActorId, actorId, amount) {
  if (!isNonEmptyString(actorId) || !Number.isFinite(amount)) {
    return;
  }
  damageByActorId.set(actorId, (damageByActorId.get(actorId) || 0) + amount);
}

function recordEventDamage(damageByActorId, event) {
  if (!event || typeof event !== "object") {
    return;
  }
  const data = event.data && typeof event.data === "object" ? event.data : {};
  const targetActorId = data.targetActorId || data.targetId || event.targetActorId || event.targetId || event.actorId;
  const damage = Number.isFinite(data.damage)
    ? data.damage
    : Number.isFinite(data.amount) && String(event.kind || "").toLowerCase().includes("damage")
      ? data.amount
      : null;
  if (Number.isFinite(damage)) {
    addActorDamage(damageByActorId, targetActorId, damage);
  }
}

function recordEffectDamage(damageByActorId, effect, result) {
  if ((!effect || typeof effect !== "object") && (!result || typeof result !== "object")) {
    return;
  }
  const effectData = effect?.data && typeof effect.data === "object" ? effect.data : {};
  const resultData = result && typeof result === "object" ? result : {};
  const kind = String(effect?.kind || resultData.kind || "").toLowerCase();
  const targetActorId = (
    effectData.targetActorId
    || effectData.targetId
    || resultData.targetActorId
    || resultData.targetId
    || effect?.actorId
    || resultData.actorId
  );
  const damage = Number.isFinite(effectData.damage)
    ? effectData.damage
    : Number.isFinite(effectData.amount) && kind.includes("damage")
      ? effectData.amount
      : Number.isFinite(resultData.damage)
        ? resultData.damage
        : Number.isFinite(resultData.amount) && kind.includes("damage")
          ? resultData.amount
          : null;
  if (Number.isFinite(damage)) {
    addActorDamage(damageByActorId, targetActorId, damage);
  }
}

function deriveDamageSummary(tickFrames) {
  const damageByActorId = new Map();
  if (!Array.isArray(tickFrames)) {
    return { total: 0, byActorId: damageByActorId };
  }
  tickFrames.forEach((frame) => {
    (Array.isArray(frame?.emittedEvents) ? frame.emittedEvents : []).forEach((event) => {
      recordEventDamage(damageByActorId, event);
    });
    (Array.isArray(frame?.emittedEffects) ? frame.emittedEffects : []).forEach((effect) => {
      recordEffectDamage(damageByActorId, effect, effect?.data);
    });
    (Array.isArray(frame?.fulfilledEffects) ? frame.fulfilledEffects : []).forEach((record) => {
      recordEffectDamage(damageByActorId, record?.effect, record?.result);
      (Array.isArray(record?.result?.events) ? record.result.events : []).forEach((event) => {
        recordEventDamage(damageByActorId, event);
      });
    });
  });
  const total = Array.from(damageByActorId.values()).reduce((sum, value) => sum + value, 0);
  return { total, byActorId: damageByActorId };
}

function normalizeDiffFrameSummary(frame) {
  if (!frame || typeof frame !== "object") {
    return null;
  }
  return summarizeFrame(frame);
}

function findFirstFrameDivergence(tickFramesA, tickFramesB) {
  const normalizedA = Array.isArray(tickFramesA) ? tickFramesA.map(normalizeDiffFrameSummary) : [];
  const normalizedB = Array.isArray(tickFramesB) ? tickFramesB.map(normalizeDiffFrameSummary) : [];
  const max = Math.max(normalizedA.length, normalizedB.length);
  for (let index = 0; index < max; index += 1) {
    const frameA = normalizedA[index] || null;
    const frameB = normalizedB[index] || null;
    if (!frameA || !frameB) {
      return {
        index,
        reason: !frameA ? "missing_run_a_frame" : "missing_run_b_frame",
        tick: frameA?.tick ?? frameB?.tick ?? null,
        frameA,
        frameB,
      };
    }
    if (JSON.stringify(frameA) !== JSON.stringify(frameB)) {
      return {
        index,
        reason: "frame_mismatch",
        tick: frameA.tick ?? frameB.tick ?? null,
        frameA,
        frameB,
      };
    }
  }
  return null;
}

// Resolves a run's directories either from disk (artifacts/runs/<runId>/<command>) or, when
// commandOutDirs is given, from the MCP server's remembered per-command outDirs.
async function resolveDiffRunCommandEntries(runId, commandOutDirs) {
  if (commandOutDirs) {
    const entries = normalizeCommandOutDirEntries(commandOutDirs)
      .filter((entry) => isNonEmptyString(entry.command) && isNonEmptyString(entry.outDir));
    if (entries.length === 0) {
      throw new Error(`Run directory not found for remembered run: ${runId}`);
    }
    return { runDir: deriveRememberedRunDir(entries), entries, remembered: true };
  }
  const runDir = defaultRunDir(runId);
  if (!existsSync(runDir)) {
    throw new Error(`Run directory not found: ${runDir}`);
  }
  const entries = (await listDirectoryNames(runDir)).map((command) => ({ command, outDir: join(runDir, command) }));
  return { runDir, entries, remembered: false };
}

// The level a run played: sim-config.json / initial-state.json files when a stage wrote
// them (create, build, llm-plan ...), else the copies embedded in the compared stage's
// GameplayBundle, which is all a `run --from-run` directory carries.
async function resolveDiffLevelArtifacts({ runId, entries, remembered, compareDir }) {
  let fileLookupError = null;
  try {
    const sourcePaths = remembered
      ? await resolveFromRunArtifactPathsFromCommandOutDirs({ runId, commandOutDirs: entries })
      : await resolveFromRunArtifactPaths(runId);
    return {
      sourceDir: sourcePaths.sourceDir,
      simConfig: await readJson(sourcePaths.simConfigPath),
      initialState: await readJson(sourcePaths.initialStatePath),
    };
  } catch (error) {
    fileLookupError = error;
  }
  const simConfig = await readEmbeddedBundleArtifact(compareDir, SCHEMAS.simConfig);
  const initialState = await readEmbeddedBundleArtifact(compareDir, SCHEMAS.initialState);
  if (!simConfig || !initialState) {
    throw fileLookupError;
  }
  return { sourceDir: compareDir, simConfig, initialState };
}

async function resolveDiffRunArtifacts(runId, commandOutDirs = null) {
  if (!isNonEmptyString(runId)) {
    throw new Error("diff requires non-empty run ids.");
  }
  const { runDir, entries, remembered } = await resolveDiffRunCommandEntries(runId, commandOutDirs);
  const candidateEntries = [...entries].sort((left, right) => compareDiffStagePriority(left.command, right.command));
  let compareDir = null;
  let compareCommand = "";

  for (const entry of candidateEntries) {
    if (existsSync(join(entry.outDir, "tick-frames.json")) || existsSync(join(entry.outDir, "run-summary.json"))) {
      compareDir = entry.outDir;
      compareCommand = entry.command;
      break;
    }
  }

  if (!compareDir) {
    throw new Error(`diff could not find tick-frames.json or run-summary.json for run ${runId} under ${runDir}.`);
  }

  const level = await resolveDiffLevelArtifacts({ runId, entries, remembered, compareDir });
  const { simConfig, initialState } = level;
  const [runSummary, tickFrames] = await Promise.all([
    readJsonIfExists(join(compareDir, "run-summary.json")),
    readJsonIfExists(join(compareDir, "tick-frames.json")),
  ]);
  assertSchema(simConfig, SCHEMAS.simConfig);
  assertSchema(initialState, SCHEMAS.initialState);
  if (runSummary) {
    assertSchema(runSummary, SCHEMAS.runSummary);
  }
  if (tickFrames && !Array.isArray(tickFrames)) {
    throw new Error(`diff expects tick-frames.json for run ${runId} to contain a JSON array.`);
  }
  (Array.isArray(tickFrames) ? tickFrames : []).forEach((frame) => assertSchema(frame, SCHEMAS.tickFrame));

  return {
    runId,
    runDir,
    sourceDir: level.sourceDir,
    compareDir,
    compareCommand,
    simConfig,
    initialState,
    runSummary,
    tickFrames: Array.isArray(tickFrames) ? tickFrames : [],
    ticks: deriveTickCount(runSummary, tickFrames),
    effects: deriveEffectCount(runSummary, tickFrames),
    damage: deriveDamageSummary(tickFrames),
    actorRecords: buildActorRecordMap(initialState),
  };
}

function buildActorDiffRecords(runA, runB) {
  const actorIds = Array.from(new Set([
    ...runA.actorRecords.keys(),
    ...runB.actorRecords.keys(),
    ...runA.damage.byActorId.keys(),
    ...runB.damage.byActorId.keys(),
  ])).sort((left, right) => left.localeCompare(right));

  return actorIds.map((actorId) => {
    const actorA = runA.actorRecords.get(actorId) || null;
    const actorB = runB.actorRecords.get(actorId) || null;
    const damageA = runA.damage.byActorId.get(actorId) || 0;
    const damageB = runB.damage.byActorId.get(actorId) || 0;
    return {
      id: actorId,
      presentInA: Boolean(actorA),
      presentInB: Boolean(actorB),
      kindA: actorA?.kind,
      kindB: actorB?.kind,
      vitalsA: actorA?.vitals || null,
      vitalsB: actorB?.vitals || null,
      damageReceivedA: damageA,
      damageReceivedB: damageB,
      damageDelta: damageB - damageA,
    };
  });
}

// commandOutDirsA/B: the MCP server's remembered outDirs for a run made in its session;
// omitted, a run is read from artifacts/runs/<runId>.
export async function summarizeRunDiff({ runA, runB, commandOutDirsA = null, commandOutDirsB = null } = {}) {
  const [resolvedA, resolvedB] = await Promise.all([
    resolveDiffRunArtifacts(runA, commandOutDirsA),
    resolveDiffRunArtifacts(runB, commandOutDirsB),
  ]);
  const divergence = findFirstFrameDivergence(resolvedA.tickFrames, resolvedB.tickFrames);
  return {
    ok: true,
    command: "diff",
    runA: resolvedA.runId,
    runB: resolvedB.runId,
    sourceA: {
      runDir: resolvedA.runDir,
      sourceDir: resolvedA.sourceDir,
      compareDir: resolvedA.compareDir,
      command: resolvedA.compareCommand,
    },
    sourceB: {
      runDir: resolvedB.runDir,
      sourceDir: resolvedB.sourceDir,
      compareDir: resolvedB.compareDir,
      command: resolvedB.compareCommand,
    },
    ticks: {
      a: resolvedA.ticks,
      b: resolvedB.ticks,
      delta: resolvedB.ticks - resolvedA.ticks,
    },
    effects: {
      a: resolvedA.effects,
      b: resolvedB.effects,
      delta: resolvedB.effects - resolvedA.effects,
    },
    damage: {
      a: resolvedA.damage.total,
      b: resolvedB.damage.total,
      delta: resolvedB.damage.total - resolvedA.damage.total,
    },
    actors: buildActorDiffRecords(resolvedA, resolvedB),
    divergesAtTick: divergence?.tick ?? null,
    divergence,
  };
}

async function summarizeRunIndexCommand({ runId, command, outDir } = {}) {
  const request = await readJsonIfExists(join(outDir, "request.json"));
  const spec = await readJsonIfExists(join(outDir, "spec.json"));
  const { simConfig, initialState } = await readLevelArtifactsForOutDir(outDir);
  const telemetry = await readJsonIfExists(join(outDir, "telemetry.json"));
  const runSummary = await readJsonIfExists(join(outDir, "run-summary.json"));
  const budgetReceipt = await readJsonIfExists(join(outDir, "budget-receipt.json"));
  const inputs = await collectRunIndexArtifactRecords(outDir, RUN_INDEX_INPUT_FILES);
  const outputs = await collectRunIndexArtifactRecords(outDir, RUN_INDEX_OUTPUT_FILES);
  const createdAt = (
    spec?.meta?.createdAt
    || request?.meta?.createdAt
    || telemetry?.meta?.createdAt
    || runSummary?.meta?.createdAt
    || ""
  );
  return {
    command,
    runId,
    status: deriveRunIndexStatus({ telemetry, runSummary, outputCount: outputs.length }),
    outDir,
    createdAt,
    source: (
      spec?.meta?.source
      || telemetry?.data?.source
      || request?.meta?.producedBy
      || runSummary?.meta?.producedBy
      || ""
    ),
    actorIds: deriveActorIds(initialState),
    roomIds: deriveRoomIds(simConfig),
    ticks: runSummary?.metrics?.ticks,
    budgetSpend: deriveBudgetSpend(budgetReceipt),
    ...(Array.isArray(telemetry?.data?.solverDecisions)
      ? { solverDecisions: summarizeSolverDecisions(telemetry.data.solverDecisions) || "none recorded" }
      : {}),
    inputs,
    outputs,
  };
}

async function summarizeRunShow({ runId } = {}) {
  if (!isNonEmptyString(runId)) {
    throw new Error("show requires --run-id <id>.");
  }
  const runDir = defaultRunDir(runId);
  if (!existsSync(runDir)) {
    throw new Error(`Run directory not found: ${runDir}`);
  }

  const commandNames = await listDirectoryNames(runDir);
  const commands = [];
  for (const command of commandNames) {
    commands.push(await summarizeRunIndexCommand({
      runId,
      command,
      outDir: join(runDir, command),
    }));
  }
  commands.sort((a, b) => a.command.localeCompare(b.command));

  const actorIds = Array.from(new Set(commands.flatMap((entry) => entry.actorIds || [])))
    .sort((a, b) => a.localeCompare(b));
  const roomIds = Array.from(new Set(commands.flatMap((entry) => entry.roomIds || [])))
    .sort((a, b) => a.localeCompare(b));
  const artifactPaths = Array.from(new Set(commands.flatMap((entry) => [
    ...(entry.inputs || []).map((record) => record.path),
    ...(entry.outputs || []).map((record) => record.path),
  ]))).sort((a, b) => a.localeCompare(b));
  const budgetSpend = commands.find((entry) => entry.budgetSpend)?.budgetSpend;

  return {
    ok: true,
    command: "show",
    runId,
    runDir,
    status: deriveRunStatus(commands),
    commandCount: commands.length,
    actorIds,
    roomIds,
    actorCount: actorIds.length,
    roomCount: roomIds.length,
    budgetSpend,
    artifactPaths,
    commands,
  };
}

export async function summarizeRunShowFromCommandOutDirs({
  runId,
  commandOutDirs,
} = {}) {
  if (!isNonEmptyString(runId)) {
    throw new Error("show requires --run-id <id>.");
  }
  const entries = normalizeCommandOutDirEntries(commandOutDirs)
    .filter((entry) => isNonEmptyString(entry.command) && isNonEmptyString(entry.outDir));
  if (entries.length === 0) {
    throw new Error(`Run directory not found for remembered run: ${runId}`);
  }

  const commands = [];
  for (const entry of entries) {
    commands.push(await summarizeRunIndexCommand({
      runId,
      command: entry.command,
      outDir: entry.outDir,
    }));
  }
  commands.sort((a, b) => a.command.localeCompare(b.command));

  const actorIds = Array.from(new Set(commands.flatMap((entry) => entry.actorIds || [])))
    .sort((a, b) => a.localeCompare(b));
  const roomIds = Array.from(new Set(commands.flatMap((entry) => entry.roomIds || [])))
    .sort((a, b) => a.localeCompare(b));
  const artifactPaths = Array.from(new Set(commands.flatMap((entry) => [
    ...(entry.inputs || []).map((record) => record.path),
    ...(entry.outputs || []).map((record) => record.path),
  ]))).sort((a, b) => a.localeCompare(b));
  const budgetSpend = commands.find((entry) => entry.budgetSpend)?.budgetSpend;

  return {
    ok: true,
    command: "show",
    runId,
    runDir: deriveRememberedRunDir(entries),
    status: deriveRunStatus(commands),
    commandCount: commands.length,
    actorIds,
    roomIds,
    actorCount: actorIds.length,
    roomCount: roomIds.length,
    budgetSpend,
    artifactPaths,
    commands,
  };
}

async function summarizeRunsIndex({ rootDir } = {}) {
  const runIds = await listDirectoryNames(rootDir);
  const runs = [];
  for (const runId of runIds) {
    const runDir = join(rootDir, runId);
    const commandNames = await listDirectoryNames(runDir);
    const commands = [];
    for (const command of commandNames) {
      commands.push(await summarizeRunIndexCommand({
        runId,
        command,
        outDir: join(runDir, command),
      }));
    }
    commands.sort((a, b) => {
      const aTime = Date.parse(a.createdAt || "");
      const bTime = Date.parse(b.createdAt || "");
      if (Number.isFinite(aTime) && Number.isFinite(bTime) && aTime !== bTime) {
        return bTime - aTime;
      }
      return a.command.localeCompare(b.command);
    });
    runs.push({
      runId,
      status: deriveRunStatus(commands),
      commandCount: commands.length,
      commands,
    });
  }
  runs.sort((a, b) => a.runId.localeCompare(b.runId));
  return {
    ok: true,
    command: "runs",
    action: "list",
    rootDir,
    runs,
  };
}

function allowNetworkRequests() {
  const value = process.env.AK_ALLOW_NETWORK;
  return value === "1" || value === "true";
}

function isLlmLiveEnabled() {
  const value = process.env.AK_LLM_LIVE;
  return value === "1" || value === "true";
}

function isLlmStrictEnabled() {
  const value = process.env.AK_LLM_STRICT;
  return value === "1" || value === "true";
}

function isLlmBudgetLoopEnabled() {
  const value = process.env.AK_LLM_BUDGET_LOOP;
  return value === "1" || value === "true";
}

/**
 * Z10: REAL Z3 IS THE DEFAULT, and the fixture stub is now the opt-out.
 *
 * It used to be the other way round, and the cost of that was measured rather than
 * argued. Without AK_SOLVER_ENGINE=z3-real every hosted solver call got a stub
 * declaring `domains: []`, so the host deferred and each persona took its greedy
 * fallback. Across 2800 Allocator budget-fit decision points that fallback was
 * optimal 40.8% of the time against an exhaustive oracle, while real Z3 was optimal
 * 100% of the time and never worse at any point. It also refused 250 layouts that
 * were affordable and buildable. Shipping the stub by default meant shipping a
 * wrong answer to roughly three of every five real decisions.
 *
 * See ~/vault/decisions/2026-09-04-does-the-solver-actually-win.md. The flip was
 * deliberately NOT made before the context-lifecycle leak was fixed: turning Z3 on
 * by default while every solve leaked ~10MB would have made a correctness win into
 * an availability problem.
 *
 * AN EXPLICIT FIXTURE STILL WINS. `ak solve --solver-fixture` and a build spec's
 * `solver.fixture` hint are requests to REPLAY a recorded answer, not to search for
 * one; honouring the engine default over them would silently ignore the file the
 * caller named. So a supplied fixturePath selects the fixture adapter regardless of
 * engine, which is also what keeps every fixture-driven test meaningful.
 */
function resolveSolverEngine() {
  const value = process.env.AK_SOLVER_ENGINE;
  // "z3-real" stays accepted so existing call sites that set it keep working; it is
  // now a no-op that names the default rather than a switch that enables it.
  if (value === "fixture" || value === "stub") return "fixture";
  return "z3-real";
}

function isLocalBaseUrl(raw) {
  if (!isNonEmptyString(raw)) {
    return false;
  }
  try {
    const url = new URL(raw);
    return url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "::1";
  } catch (error) {
    const lowered = raw.toLowerCase();
    return lowered.startsWith("localhost")
      || lowered.startsWith("127.0.0.1")
      || lowered.startsWith("[::1]")
      || lowered.startsWith("http://localhost")
      || lowered.startsWith("http://127.0.0.1")
      || lowered.startsWith("http://[::1]");
  }
}

function resolveDefaultLlmFixturePath({ resolvePath: resolveCliPath, exists, cwd }) {
  const candidates = [
    resolveCliPath("tests/fixtures/adapters/llm-generate-summary.json"),
    resolveCliPath("tests/fixtures/adapters/llm-generate-summary.json", cwd()),
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (exists(candidate)) {
      return candidate;
    }
  }
  return null;
}

function unwrapCodeFence(text) {
  if (!text) return text;
  const match = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  return match ? match[1].trim() : text;
}

function extractJsonObject(text) {
  if (!text) return null;
  const cleaned = unwrapCodeFence(text).trim();
  if (cleaned.startsWith("{") && cleaned.endsWith("}")) {
    return cleaned;
  }
  const start = cleaned.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < cleaned.length; i += 1) {
    const ch = cleaned[i];
    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === "\\") {
        escaped = true;
        continue;
      }
      if (ch === "\"") {
        inString = false;
      }
      continue;
    }
    if (ch === "\"") {
      inString = true;
      continue;
    }
    if (ch === "{") {
      depth += 1;
    } else if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        return cleaned.slice(start, i + 1);
      }
    }
  }
  return null;
}

function appendJsonOnlyInstruction(promptText) {
  return appendLlmPromptSuffix(promptText);
}

function deriveAllowedPairs(catalog) {
  const entries = Array.isArray(catalog?.entries)
    ? catalog.entries
    : Array.isArray(catalog)
      ? catalog
      : [];
  const pairs = new Map();
  entries.forEach((entry) => {
    if (!entry || typeof entry !== "object") return;
    const { motivation, affinity } = entry;
    if (typeof motivation !== "string" || typeof affinity !== "string") return;
    const key = `${motivation}|${affinity}`;
    if (!pairs.has(key)) {
      pairs.set(key, { motivation, affinity });
    }
  });
  return Array.from(pairs.values()).sort(
    (a, b) => a.motivation.localeCompare(b.motivation) || a.affinity.localeCompare(b.affinity),
  );
}

function formatAllowedPairs(pairs) {
  return pairs.map((pair) => `(${pair.motivation}, ${pair.affinity})`).join(", ");
}

function countInstances(selections, kind) {
  return selections
    .filter((sel) => sel.kind === kind && Array.isArray(sel.instances))
    .reduce((sum, sel) => sum + sel.instances.length, 0);
}

function summarizeMissingSelections(selections) {
  return selections
    .filter((sel) => !sel.applied)
    .map((sel) => `${sel.kind}:${sel.requested?.motivation || "?"}/${sel.requested?.affinity || "?"}`)
    .join(", ");
}

function injectBudgetTokens(prompt, budgetTokens) {
  if (!isNonEmptyString(prompt)) {
    return prompt;
  }
  if (!Number.isInteger(budgetTokens) || budgetTokens <= 0) {
    return prompt;
  }
  if (prompt.includes("Budget tokens:")) {
    return prompt;
  }
  return `Budget tokens: ${budgetTokens}\n${prompt}`;
}

function resolveScenarioAssetPath(rawPath, baseDir) {
  if (!rawPath) {
    return null;
  }
  const primary = resolvePath(rawPath);
  if (primary && existsSync(primary)) {
    return primary;
  }
  if (!baseDir) {
    return primary;
  }
  const fallback = resolvePath(rawPath, baseDir);
  if (fallback && existsSync(fallback)) {
    return fallback;
  }
  return primary || fallback;
}

function buildRepairPrompt({ basePrompt, errors, responseText, allowedOptions, allowedPairsText }) {
  const extracted = extractJsonObject(responseText) || responseText;
  const affinities = allowedOptions?.affinities?.length ? allowedOptions.affinities : ALLOWED_AFFINITIES;
  const motivations = allowedOptions?.motivations?.length ? allowedOptions.motivations : ALLOWED_MOTIVATIONS;
  return buildLlmRepairPromptTemplate({
    basePrompt,
    errors,
    responseText: extracted,
    affinities,
    affinityExpressions: ALLOWED_AFFINITY_EXPRESSIONS,
    motivations,
    allowedPairsText,
    phaseRequirement: LLM_REPAIR_TEXT.phaseActorsRequirement,
    extraLines: [
      LLM_REPAIR_TEXT.tokenHintRule,
      LLM_REPAIR_TEXT.exampleAffinityEntry,
    ],
  });
}

function buildDryRunBudgetEstimate({ budgetReceipt, spendProposal, budgetTokens } = {}) {
  const total = Number.isInteger(budgetReceipt?.budget?.tokens)
    ? budgetReceipt.budget.tokens
    : Number.isInteger(budgetReceipt?.totalBudget)
      ? budgetReceipt.totalBudget
      : Number.isInteger(budgetTokens)
        ? budgetTokens
        : Number.isInteger(spendProposal?.summary?.budgetTokens)
          ? spendProposal.summary.budgetTokens
          : undefined;
  const used = Number.isFinite(budgetReceipt?.totalCost)
    ? budgetReceipt.totalCost
    : Number.isFinite(spendProposal?.summary?.totalSpentTokens)
      ? spendProposal.summary.totalSpentTokens
      : undefined;
  const remaining = Number.isFinite(budgetReceipt?.remaining)
    ? budgetReceipt.remaining
    : Number.isFinite(spendProposal?.summary?.remainingTokens)
      ? spendProposal.summary.remainingTokens
      : Number.isFinite(total) && Number.isFinite(used)
        ? Math.max(0, total - used)
        : undefined;
  if (total === undefined && used === undefined && remaining === undefined) {
    return undefined;
  }
  return { total, used, remaining };
}

function buildDryRunSuccess({
  command,
  runId,
  outDir,
  actorIds = [],
  roomIds = [],
  budgetEstimate,
  warnings = [],
  extra = {},
} = {}) {
  const summary = {
    ok: true,
    command,
    runId,
    valid: true,
    dryRun: true,
    actorIds,
    roomIds,
    warnings,
  };
  if (outDir) {
    summary.outDir = outDir;
  }
  if (budgetEstimate) {
    summary.budgetEstimate = budgetEstimate;
  }
  Object.entries(extra).forEach(([key, value]) => {
    if (value !== undefined) {
      summary[key] = value;
    }
  });
  return summary;
}

function buildDryRunFailure({ command, runId, outDir, error } = {}) {
  const summary = {
    ok: true,
    command,
    runId,
    valid: false,
    dryRun: true,
    errors: [error?.message || String(error)],
    warnings: [],
  };
  if (outDir) {
    summary.outDir = outDir;
  }
  return summary;
}

function assertAllowedBuildArgs(args) {
  const allowed = new Set(["spec", "out-dir", "emit-intermediates"]);
  const unknown = [];
  for (const key of Object.keys(args)) {
    if (key === "_" || key === "help") {
      continue;
    }
    if (!allowed.has(key)) {
      unknown.push(`--${key}`);
    }
  }
  if (Array.isArray(args._) && args._.length > 0) {
    unknown.push(...args._);
  }
  if (unknown.length > 0) {
    throw new Error(`build only accepts --spec, --out-dir, and --emit-intermediates. Unknown: ${unknown.join(", ")}`);
  }
}

function assertAllowedSchemasArgs(args) {
  const allowed = new Set(["out-dir"]);
  const unknown = [];
  for (const key of Object.keys(args)) {
    if (key === "_" || key === "help") {
      continue;
    }
    if (!allowed.has(key)) {
      unknown.push(`--${key}`);
    }
  }
  if (Array.isArray(args._) && args._.length > 0) {
    unknown.push(...args._);
  }
  if (unknown.length > 0) {
    throw new Error(`schemas only accepts --out-dir. Unknown: ${unknown.join(", ")}`);
  }
}

function assertAllowedRoomPlanArgs(args) {
  const allowed = new Set([
    "room",
    "goal",
    "dungeon-affinity",
    "budget-tokens",
    "budget",
    "price-list",
    "out-dir",
    "run-id",
    "created-at",
    "emit-intermediates",
  ]);
  const unknown = [];
  for (const key of Object.keys(args)) {
    if (key === "_" || key === "help") {
      continue;
    }
    if (!allowed.has(key)) {
      unknown.push(`--${key}`);
    }
  }
  if (Array.isArray(args._) && args._.length > 0) {
    unknown.push(...args._);
  }
  if (unknown.length > 0) {
    throw new Error(`room-plan only accepts --room, --goal, --dungeon-affinity, --budget-tokens, --budget, --price-list, --out-dir, --run-id, --created-at, and --emit-intermediates. Unknown: ${unknown.join(", ")}`);
  }
}

function assertAllowedHazardPlanArgs(args) {
  const allowed = new Set([
    "hazard",
    "goal",
    "dungeon-affinity",
    "budget-tokens",
    "budget",
    "price-list",
    "out-dir",
    "run-id",
    "created-at",
    "emit-intermediates",
  ]);
  const unknown = [];
  for (const key of Object.keys(args)) {
    if (key === "_" || key === "help") {
      continue;
    }
    if (!allowed.has(key)) {
      unknown.push(`--${key}`);
    }
  }
  if (Array.isArray(args._) && args._.length > 0) {
    unknown.push(...args._);
  }
  if (unknown.length > 0) {
    throw new Error(`hazard-plan only accepts --hazard, --goal, --dungeon-affinity, --budget-tokens, --budget, --price-list, --out-dir, --run-id, --created-at, and --emit-intermediates. Unknown: ${unknown.join(", ")}`);
  }
}

function assertAllowedResourcePlanArgs(args) {
  const allowed = new Set([
    "resource",
    "goal",
    "dungeon-affinity",
    "budget-tokens",
    "budget",
    "price-list",
    "out-dir",
    "run-id",
    "created-at",
    "emit-intermediates",
  ]);
  const unknown = [];
  for (const key of Object.keys(args)) {
    if (key === "_" || key === "help") {
      continue;
    }
    if (!allowed.has(key)) {
      unknown.push(`--${key}`);
    }
  }
  if (Array.isArray(args._) && args._.length > 0) {
    unknown.push(...args._);
  }
  if (unknown.length > 0) {
    throw new Error(`resource-plan only accepts --resource, --goal, --dungeon-affinity, --budget-tokens, --budget, --price-list, --out-dir, --run-id, --created-at, and --emit-intermediates. Unknown: ${unknown.join(", ")}`);
  }
}

function assertAllowedDelverPlanArgs(args) {
  const allowed = new Set([
    "delver",
    "goal",
    "dungeon-affinity",
    "budget-tokens",
    "budget",
    "price-list",
    "out-dir",
    "run-id",
    "created-at",
    "emit-intermediates",
  ]);
  const unknown = [];
  for (const key of Object.keys(args)) {
    if (key === "_" || key === "help") {
      continue;
    }
    if (!allowed.has(key)) {
      unknown.push(`--${key}`);
    }
  }
  if (Array.isArray(args._) && args._.length > 0) {
    unknown.push(...args._);
  }
  if (unknown.length > 0) {
    throw new Error(`delver-plan only accepts --delver, --goal, --dungeon-affinity, --budget-tokens, --budget, --price-list, --out-dir, --run-id, --created-at, and --emit-intermediates. Unknown: ${unknown.join(", ")}`);
  }
}

function assertAllowedWardenPlanArgs(args) {
  const allowed = new Set([
    "warden",
    "goal",
    "dungeon-affinity",
    "budget-tokens",
    "budget",
    "price-list",
    "out-dir",
    "run-id",
    "created-at",
    "emit-intermediates",
  ]);
  const unknown = [];
  for (const key of Object.keys(args)) {
    if (key === "_" || key === "help") {
      continue;
    }
    if (!allowed.has(key)) {
      unknown.push(`--${key}`);
    }
  }
  if (Array.isArray(args._) && args._.length > 0) {
    unknown.push(...args._);
  }
  if (unknown.length > 0) {
    throw new Error(`warden-plan only accepts --warden, --goal, --dungeon-affinity, --budget-tokens, --budget, --price-list, --out-dir, --run-id, --created-at, and --emit-intermediates. Unknown: ${unknown.join(", ")}`);
  }
}

function assertAllowedScenarioArgs(args) {
  const allowed = new Set([
    "text",
    "from-run",
    "sim-config",
    "initial-state",
    "catalog",
    "model",
    "goal",
    "budget-tokens",
    "base-url",
    "fixture",
    "budget-loop",
    "budget-pool",
    "budget-reserve",
    "ticks",
    "seed",
    "out-dir",
    "run-id",
    "created-at",
    "emit-intermediates",
    "dry-run",
  ]);
  const unknown = [];
  for (const key of Object.keys(args)) {
    if (key === "_" || key === "help") {
      continue;
    }
    if (!allowed.has(key)) {
      unknown.push(`--${key}`);
    }
  }
  if (Array.isArray(args._) && args._.length > 0) {
    unknown.push(...args._);
  }
  if (unknown.length > 0) {
    throw new Error(`scenario only accepts --text, --from-run, --catalog, --model, --goal, --budget-tokens, --base-url, --fixture, --budget-loop, --budget-pool, --budget-reserve, --ticks, --seed, --out-dir, --run-id, --created-at, --emit-intermediates, and --dry-run. Unknown: ${unknown.join(", ")}`);
  }
}

// Configurator input preparation (grid sizing, room-size profiles, hazard
// capacity) moved to personas/configurator/input-preparation.js in P2.2 and is
// consumed here through the Configurator persona surface (P2.3.1).

async function writeBuildOutputs({
  outDir,
  spec,
  buildResult,
  requestArtifact = null,
  emitIntermediates = false,
  commandName,
  producedBy,
  tacticPlan,
} = {}) {
  await writeJson(join(outDir, "spec.json"), spec);

  const capturedInputs = Array.isArray(buildResult.capturedInputs) ? buildResult.capturedInputs : [];
  const capturedArtifacts = capturedInputs.map((entry, index) => {
    const artifact = entry?.artifact || entry;
    return {
      artifact,
      path: entry?.path || buildCapturedInputPath(artifact?.source?.adapter || "llm", index, artifact?.meta?.id),
    };
  });
  const persistedArtifacts = collectBuildOutputArtifactRecords(buildResult, {
    requestArtifact,
    capturedInputs: capturedArtifacts,
    emitIntermediates,
    includeAffinitySummary: true,
  });
  for (const entry of persistedArtifacts) {
    await writeJson(join(outDir, entry.path), entry.artifact);
  }

  const bundleArtifacts = buildBuildArtifacts(buildResult, {
    requestArtifact,
    capturedInputs: capturedArtifacts,
    emitIntermediates,
    includeAffinitySummary: true,
  });

  const manifestEntries = buildBuildManifestEntries(buildResult, {
    requestArtifact,
    capturedInputs: capturedArtifacts,
    emitIntermediates,
    includeAffinitySummary: true,
  });

  const schemaEntries = filterSchemaCatalogEntries({
    schemaRefs: [
      { schema: spec.schema, schemaVersion: spec.schemaVersion },
      ...manifestEntries,
    ],
  });

  const bundle = {
    spec,
    schemas: schemaEntries,
    artifacts: bundleArtifacts,
  };
  await writeJson(join(outDir, "bundle.json"), bundle);

  const manifest = {
    specPath: "spec.json",
    correlation: {
      runId: spec.meta.runId,
      source: spec.meta.source,
      correlationId: spec.meta.correlationId,
    },
    schemas: schemaEntries,
    artifacts: manifestEntries,
  };
  if (!manifest.correlation.correlationId) {
    delete manifest.correlation.correlationId;
  }
  await writeJson(join(outDir, "manifest.json"), manifest);

  const telemetry = buildBuildTelemetryRecord({
    spec,
    status: "success",
    artifactRefs: buildArtifactRefs(manifestEntries),
    producedBy,
    clock: () => spec.meta.createdAt,
    data: { solverDecisions: Array.isArray(buildResult.solverDecisions) ? buildResult.solverDecisions : [] },
  });
  await writeJson(join(outDir, "telemetry.json"), telemetry);

  const costSummary = buildCostSummary(buildResult.budgetReceipt, buildResult.spendProposal, outDir);
  const placedObjects = buildPlacedObjectsNote(spec);
  // #301: how each `--place` constraint came out, from the Configurator's placement decision.
  const constraintReport = (Array.isArray(buildResult.solverDecisions) ? buildResult.solverDecisions : [])
    .find((decision) => Array.isArray(decision?.placementReport))?.placementReport;
  // #396: the Configurator's note on each tactic in the plan follows the constraint rows.
  const tacticReport = Array.isArray(buildResult.tacticReport) ? buildResult.tacticReport : [];
  const placementReport = constraintReport !== undefined || tacticReport.length > 0
    ? [...(constraintReport || []), ...tacticReport]
    : undefined;
  // #396: the tactic plan the build used and its seed, so the level can be rebuilt exactly.
  const tactics = buildResult.plan?.directives?.tactics;
  const buildSeed = spec?.configurator?.inputs?.levelGen?.seed;
  // #422: the grade and its numbers, and the Allocator's word on a --budget-tokens override.
  const gradeId = spec?.intent?.hints?.grade;
  const builtTokens = spec?.intent?.hints?.budgetTokens;
  const grade = typeof gradeId === "string" ? gradeAllocator.pricing.levelGradeReport(gradeId, builtTokens) : undefined;

  return buildStructuredSuccessSummary({
    command: commandName,
    outDir,
    runId: spec.meta.runId,
    manifestEntries,
    initialState: buildResult.initialState,
    simConfig: buildResult.simConfig,
    spec,
    extra: {
      ...(costSummary !== undefined ? { cost: costSummary } : {}),
      ...(placedObjects !== undefined ? { placedObjects } : {}),
      ...(placementReport !== undefined ? { placementReport } : {}),
      ...(Array.isArray(tactics) && tactics.length > 0 ? { tactics } : {}),
      ...(tacticPlan ? { tacticPlan } : {}),
      ...(Number.isSafeInteger(buildSeed) ? { seed: buildSeed } : {}),
      ...(grade ? { grade } : {}),
      // #371: authored vitals a Configurator floor raised, so none changes silently.
      ...(buildResult.vitalsReport?.length > 0 ? { vitalsReport: buildResult.vitalsReport } : {}),
    },
  });
}

function buildCostSummary(budgetReceipt, spendProposal, outDir) {
  if (!budgetReceipt || budgetReceipt.schema !== SCHEMAS.budgetReceiptArtifact) {
    return undefined;
  }
  const totalSpend = budgetReceipt.totalCost ?? 0;
  const remaining = budgetReceipt.remaining ?? 0;
  // The Allocator prices regen above max as asked and flags it; say so, refuse nothing.
  const wastedRegen = readWastedRegen(budgetReceipt);
  for (const { subjectId, vital, regen, usableRegen, wastedTokens } of wastedRegen) {
    console.error(`warning: ${subjectId} buys ${vital} regen ${regen} but its max is ${usableRegen}; `
      + `regen never fills past max, so ${wastedTokens} tokens buy nothing.`);
  }
  return {
    totalSpend,
    budgetTokens: totalSpend + remaining,
    remaining,
    status: budgetReceipt.status,
    ...(wastedRegen.length > 0 ? { wastedRegen } : {}),
    receiptPath: join(outDir, "budget-receipt.json"),
    proposalPath: spendProposal ? join(outDir, "spend-proposal.json") : undefined,
  };
}

async function writeHazardArtifactFiles({ parsedHazards = [], outDir, runId, createdAt, producedBy } = {}) {
  for (let i = 0; i < parsedHazards.length; i += 1) {
    const h = parsedHazards[i].value;
    const hazardVersion = h._schemaVersion ?? 3;
    const hazardArtifact = {
      schema: HAZARD_ARTIFACT_SCHEMA,
      schemaVersion: hazardVersion,
      meta: {
        id: h.id,
        runId,
        createdAt,
        producedBy,
      },
      affinity: h.affinity,
      expression: h.expression,
      ...(hazardVersion === 3
        ? {
          proximityRadius: h.proximityRadius,
          affinityStacks: h.affinityStacks.map((entry) => ({ ...entry })),
          vitals: {
            mana: { ...h.vitals.mana },
            durability: { ...h.vitals.durability },
          },
        }
        : {
          proximityRadius: h.proximityRadius,
          mana: { ...h.mana },
          ...(hazardVersion === 1 && h.durability ? { durability: { ...h.durability } } : {}),
        }),
    };
    await writeJson(join(outDir, `hazard-${i + 1}.json`), hazardArtifact);
  }
}

async function writeResourceArtifactFiles({ parsedResources = [], outDir, runId, createdAt, producedBy } = {}) {
  for (let i = 0; i < parsedResources.length; i += 1) {
    const r = parsedResources[i].value;
    const resourceVersion = r._schemaVersion ?? 1;
    const meta = { id: r.id, runId, createdAt, producedBy };
    let resourceArtifact;
    if (resourceVersion === 3) {
      resourceArtifact = {
        schema: RESOURCE_ARTIFACT_SCHEMA,
        schemaVersion: 3,
        meta,
        vitals: r.vitals,
        permanenceMode: r.permanenceMode,
      };
      if (r.affinity) resourceArtifact.affinity = r.affinity;
      if (r.slotGrant) resourceArtifact.slotGrant = r.slotGrant;
    } else {
      resourceArtifact = {
        schema: RESOURCE_ARTIFACT_SCHEMA,
        schemaVersion: 1,
        meta,
        tier: r.tier,
        stat: r.stat,
        delta: r.delta,
        dropRate: r.dropRate,
      };
    }
    await writeJson(join(outDir, `resource-${i + 1}.json`), resourceArtifact);
  }
}

function buildPoolWeightsForSummary(summary = {}) {
  const cards = Array.isArray(summary.cardSet)
    ? summary.cardSet
    : Array.isArray(summary.cards) ? summary.cards : [];
  const layout = summary.layout && typeof summary.layout === "object" ? summary.layout : null;
  const rooms = [
    ...(Array.isArray(summary.rooms) ? summary.rooms : []),
    ...cards.filter((entry) => entry?.type === "room" || entry?.source === "room"),
  ];
  const floorTiles = layout && Number.isInteger(layout.floorTiles) ? [layout] : [];
  const placedHazards = layout && Array.isArray(layout.placedHazards) ? layout.placedHazards : [];
  const hazards = [
    ...(Array.isArray(summary.hazards) ? summary.hazards : []),
    ...cards.filter((entry) => entry?.type === "hazard" || entry?.source === "hazard"),
  ];
  const resources = [
    ...(Array.isArray(summary.resources) ? summary.resources : []),
    ...cards.filter((entry) => entry?.type === "resource" || entry?.source === "resource"),
  ];
  const actorCards = cards.filter((entry) => entry?.type === "delver" || entry?.type === "warden");
  const actorEntries = Array.isArray(summary.actors) ? summary.actors : [];
  const delvers = [
    ...actorCards.filter((entry) => entry.type === "delver"),
    ...actorEntries.filter((entry) => {
      const role = String(entry?.actorType || entry?.type || entry?.role || entry?.motivation || "").toLowerCase();
      return role.includes("delver") || role.includes("attack");
    }),
  ];
  const wardens = [
    ...actorCards.filter((entry) => entry.type === "warden"),
    ...actorEntries.filter((entry) => {
      const role = String(entry?.actorType || entry?.type || entry?.role || entry?.motivation || "").toLowerCase();
      return role.includes("warden") || role.includes("defend") || role.includes("stationary");
    }),
  ];
  return buildPoolWeightsForAuthoredKinds({ rooms, floorTiles, placedHazards, hazards, resources, delvers, wardens });
}

async function validateRunDryRun(args) {
  const simConfigPath = resolvePath(args["sim-config"]);
  const initialStatePath = resolvePath(args["initial-state"]);
  const executionPolicyPath = resolvePath(args["execution-policy"]);
  const actionsPath = resolvePath(args.actions);
  const affinityPresetsPath = resolvePath(args["affinity-presets"]);
  const affinityLoadoutsPath = resolvePath(args["affinity-loadouts"]);
  const affinitySummaryArg = args["affinity-summary"];
  const ticks = args.ticks !== undefined ? Number(args.ticks) : DEFAULT_TICKS;
  const seed = args.seed !== undefined ? Number(args.seed) : 0;

  if (!simConfigPath || !initialStatePath) {
    throw new Error("run requires --sim-config and --initial-state.");
  }
  if (!Number.isFinite(ticks) || ticks < 0) {
    throw new Error("run requires a valid --ticks value.");
  }
  const worldStateCheckpoints = normalizeWorldStateCheckpoints(args["world-state-checkpoints"], { ticks });
  if (!Number.isFinite(seed)) {
    throw new Error("run requires a valid --seed value.");
  }

  const simConfig = await readJson(simConfigPath);
  assertSchema(simConfig, SCHEMAS.simConfig);
  const initialState = await readJson(initialStatePath);
  assertSchema(initialState, SCHEMAS.initialState);
  const runId = args["run-id"]
    || simConfig?.meta?.runId
    || initialState?.meta?.runId
    || makeId("run");
  const outDir = resolvePath(args["out-dir"]) || defaultRunCommandOutDir("run", runId);

  if (executionPolicyPath) {
    const executionPolicy = await readJson(executionPolicyPath);
    assertSchema(executionPolicy, SCHEMAS.executionPolicy);
  }

  const wantsAffinitySummary = affinitySummaryArg !== undefined || (affinityPresetsPath && affinityLoadoutsPath);
  if (wantsAffinitySummary && (!affinityPresetsPath || !affinityLoadoutsPath)) {
    throw new Error("Affinity summary requires --affinity-presets and --affinity-loadouts.");
  }
  if (affinityPresetsPath) {
    const affinityPresets = await readJson(affinityPresetsPath);
    assertSchema(affinityPresets, SCHEMAS.affinityPreset, AFFINITY_PRESET_SCHEMA_VERSIONS);
  }
  if (affinityLoadoutsPath) {
    const affinityLoadouts = await readJson(affinityLoadoutsPath);
    assertSchema(affinityLoadouts, SCHEMAS.actorLoadout);
  }

  if (actionsPath) {
    const actionLog = await readJson(actionsPath);
    if (!Array.isArray(actionLog.actions)) {
      throw new Error("actions file must include an actions array.");
    }
  }

  const actorSpecs = normalizeArgList(args.actor);
  const vitalSpecs = normalizeArgList(args.vital);
  const vitalDefaultSpecs = normalizeArgList(args["vital-default"]);
  const tileWalls = normalizeArgList(args["tile-wall"]);
  const tileBarriers = normalizeArgList(args["tile-barrier"]);
  const tileFloors = normalizeArgList(args["tile-floor"]);
  const vitalDefaults = resolveVitalDefaults(vitalDefaultSpecs);
  const barrierSpecs = barrierSpecsFromTileOverrides(tileBarriers);

  const resolvedSimConfig = JSON.parse(JSON.stringify(simConfig));
  const resolvedInitialState = JSON.parse(JSON.stringify(initialState));
  applyTileOverrides(resolvedSimConfig, {
    walls: tileWalls,
    floors: tileFloors,
  });
  applyActorOverrides(resolvedInitialState, resolvedSimConfig, {
    actorSpecs: [...actorSpecs, ...barrierSpecs],
    vitalSpecs,
    vitalDefaults,
  });

  return buildDryRunSuccess({
    command: "run",
    runId,
    outDir,
    actorIds: deriveActorIds(resolvedInitialState),
    roomIds: deriveRoomIds(resolvedSimConfig),
    extra: {
      ticks,
      worldStateCheckpoints,
    },
  });
}

// The level a scenario replays instead of planning one from --text: an explicit
// --sim-config/--initial-state pair (what the MCP server passes for a run it remembers),
// or the files `--from-run <runId>` finds under artifacts/runs/<runId>.
async function resolveScenarioLevelSource(args) {
  const hasSimConfig = isNonEmptyString(args["sim-config"]);
  const hasInitialState = isNonEmptyString(args["initial-state"]);
  if (hasSimConfig || hasInitialState) {
    if (!hasSimConfig || !hasInitialState) {
      throw new Error("scenario requires --sim-config and --initial-state together.");
    }
    if (isNonEmptyString(args.text) || isNonEmptyString(args["from-run"])) {
      throw new Error("scenario does not allow --sim-config/--initial-state together with --text or --from-run.");
    }
    return {
      simConfigPath: resolvePath(args["sim-config"]),
      initialStatePath: resolvePath(args["initial-state"]),
    };
  }
  if (isNonEmptyString(args["from-run"])) {
    return resolveFromRunArtifactPaths(args["from-run"]);
  }
  return null;
}

async function validateScenarioDryRun(args) {
  const fromRunId = args["from-run"];
  if (isNonEmptyString(fromRunId) && isNonEmptyString(args.text)) {
    throw new Error("scenario does not allow --text together with --from-run.");
  }
  const resolvedFromRun = await resolveScenarioLevelSource(args);
  if (resolvedFromRun) {
    const runId = args["run-id"] || fromRunId || makeId("run");
    const outDir = resolvePath(args["out-dir"]) || defaultRunDir(runId);
    const runValidation = await validateRunDryRun({
      "sim-config": resolvedFromRun.simConfigPath,
      "initial-state": resolvedFromRun.initialStatePath,
      ticks: args.ticks,
      seed: args.seed,
      "run-id": runId,
      "out-dir": join(outDir, "run"),
      actor: args.actor,
      vital: args.vital,
      "vital-default": args["vital-default"],
      "tile-wall": args["tile-wall"],
      "tile-barrier": args["tile-barrier"],
      "tile-floor": args["tile-floor"],
      actions: args.actions,
      "execution-policy": args["execution-policy"],
      "affinity-presets": args["affinity-presets"],
      "affinity-loadouts": args["affinity-loadouts"],
      "affinity-summary": args["affinity-summary"],
    });
    return {
      ...runValidation,
      command: "scenario",
      outDir,
      artifactPaths: {
        source_sim_config: resolvedFromRun.simConfigPath,
        source_initial_state: resolvedFromRun.initialStatePath,
      },
    };
  }

  const scenarioPath = resolvePath(args.scenario);
  const textRaw = args.text;
  const promptRaw = args.prompt;
  const catalogOverride = resolvePath(args.catalog);
  const goalOverride = args.goal;
  const budgetTokensRaw = args["budget-tokens"];
  const model = args.model || process.env.AK_LLM_MODEL || DEFAULT_LLM_MODEL;
  const baseUrl = args["base-url"] || process.env.AK_LLM_BASE_URL || DEFAULT_LLM_BASE_URL;
  const promptInput = isNonEmptyString(promptRaw)
    ? promptRaw
    : isNonEmptyString(textRaw)
      ? textRaw
      : undefined;
  const fixturePath = resolvePath(args.fixture)
    || (!scenarioPath && isNonEmptyString(textRaw)
      ? resolveDefaultLlmFixturePath({ resolvePath, exists: existsSync, cwd: () => process.cwd() })
      : null);
  const runId = args["run-id"] || makeId("run");
  const createdAt = args["created-at"] || new Date().toISOString();
  const outDir = resolvePath(args["out-dir"]) || defaultRunDir(runId);

  if (!scenarioPath && !catalogOverride) {
    throw new Error("llm-plan requires --scenario or --catalog.");
  }
  if (!scenarioPath && !isNonEmptyString(promptInput)) {
    throw new Error("llm-plan requires --text or --prompt when --scenario is omitted.");
  }

  let budgetTokens;
  if (budgetTokensRaw !== undefined) {
    budgetTokens = Number(budgetTokensRaw);
    if (!Number.isFinite(budgetTokens)) {
      throw new Error("llm-plan requires --budget-tokens to be a number.");
    }
  }

  const budgetReserveRaw = args["budget-reserve"];
  let budgetReserveTokens;
  if (budgetReserveRaw !== undefined) {
    budgetReserveTokens = Number(budgetReserveRaw);
    if (!Number.isFinite(budgetReserveTokens) || budgetReserveTokens < 0) {
      throw new Error("llm-plan requires --budget-reserve to be a non-negative number.");
    }
  }

  const budgetPoolRaw = args["budget-pool"];
  const budgetPools = [];
  if (budgetPoolRaw !== undefined) {
    const entries = Array.isArray(budgetPoolRaw) ? budgetPoolRaw : [budgetPoolRaw];
    entries.forEach((entry) => {
      if (typeof entry !== "string" || !entry.includes("=")) {
        throw new Error("llm-plan --budget-pool must be in id=weight form.");
      }
      const [idRaw, weightRaw] = entry.split("=");
      const id = idRaw.trim();
      const weight = Number(weightRaw);
      if (!id) {
        throw new Error("llm-plan --budget-pool requires a non-empty id.");
      }
      if (!Number.isFinite(weight) || weight < 0) {
        throw new Error(`llm-plan --budget-pool weight must be >= 0 for ${id}.`);
      }
      budgetPools.push({ id, weight });
    });
  }

  const scenario = scenarioPath ? await readJson(scenarioPath) : null;
  const scenarioBaseDir = scenarioPath ? dirname(scenarioPath) : process.cwd();
  const catalogPath = catalogOverride
    || (scenario ? resolveScenarioAssetPath(scenario.catalogPath, scenarioBaseDir) : null);
  if (!catalogPath) {
    if (scenario) {
      throw new Error("llm-plan requires scenario.catalogPath or --catalog.");
    }
    throw new Error("llm-plan requires --catalog when --scenario is omitted.");
  }
  const catalog = await readJson(catalogPath);
  const allowedOptions = deriveAllowedOptionsFromCatalog(catalog);
  const allowedPairs = deriveAllowedPairs(catalog);
  const allowedPairsText = allowedPairs.length > 0 ? formatAllowedPairs(allowedPairs) : "";
  const budgetLoopEnabled = Boolean(args["budget-loop"]) || isLlmBudgetLoopEnabled();

  const goal = isNonEmptyString(goalOverride)
    ? goalOverride
    : scenario?.goal || promptInput || "LLM planning request";
  const resolvedBudgetTokens = budgetTokens !== undefined ? budgetTokens : scenario?.budgetTokens;
  if (!Number.isFinite(resolvedBudgetTokens) || resolvedBudgetTokens <= 0) {
    throw new Error("llm-plan requires --budget-tokens or scenario.budgetTokens > 0.");
  }

  const prompt = injectBudgetTokens(promptInput, resolvedBudgetTokens);
  const notes = [
    scenario?.notes,
    "Include at least one actor; counts must be > 0.",
    allowedPairsText ? `Allowed profiles (motivation, affinity): ${allowedPairsText}.` : null,
  ]
    .filter(Boolean)
    .join(" ");
  const basePrompt = isNonEmptyString(prompt)
    ? prompt
    : buildLlmActorConfigPromptTemplate({
      goal,
      notes,
      budgetTokens: resolvedBudgetTokens,
      affinities: allowedOptions.affinities,
      affinityExpressions: ALLOWED_AFFINITY_EXPRESSIONS,
      motivations: allowedOptions.motivations,
    });
  const constraintLines = buildLlmConstraintSection({ allowedPairsText });
  const finalPrompt = appendJsonOnlyInstruction(`${basePrompt}\n\n${constraintLines}`);
  const llmFormat = process.env.AK_LLM_FORMAT;

  let capture = null;
  let captures = [];
  let summary = null;
  let mappedSelections;
  let budgetPoolWeights = null;

  // CR.7 / WP-5 (2026-08-12) — ONE Director round for the whole llm-plan build.
  //
  // Each branch below used to open its own (the loop branch via
  // beginDirectorBuildCapabilities, the direct branch via beginDirectorRound), and the
  // BuildSpec was then assembled OUTSIDE both by importing `director/buildspec-assembler.js`
  // — this file's last allowlist row, and an artifact produced with no round. Hoisting the
  // round is what lets the assembly be `director.assembleBuildSpec`, which is FSM-gated and
  // CLOSES the round. The third path (a scenario or summary fixture, no LLM at all) reaches
  // the same assembly, so it needs the round too.
  const director = beginDirectorRound({ runId, createdAt, goal, producedBy: "cli" });

  if (isLlmLiveEnabled() || Boolean(fixturePath)) {
    if (!fixturePath && !allowNetworkRequests() && !isLocalBaseUrl(baseUrl)) {
      throw new Error("llm-plan requires --fixture unless AK_ALLOW_NETWORK=1 or base URL is local.");
    }

    let fetchFn;
    if (fixturePath) {
      const fixtureJson = JSON.parse(await readText(fixturePath));
      const responses = Array.isArray(fixtureJson)
        ? fixtureJson
        : Array.isArray(fixtureJson?.responses)
          ? fixtureJson.responses
          : [fixtureJson];
      let fixtureIndex = 0;
      fetchFn = async () => {
        if (responses.length > 1 && fixtureIndex >= responses.length) {
          return { ok: false, status: 500, statusText: "Missing fixture response" };
        }
        const payload = responses[Math.min(fixtureIndex, responses.length - 1)];
        fixtureIndex += 1;
        return { ok: true, json: async () => payload };
      };
    }

    const adapter = createLlmAdapter({ baseUrl, fetchFn });
    const repairPromptBuilder = ({ errors, responseText }) => buildRepairPrompt({
      basePrompt: finalPrompt,
      errors,
      responseText,
      allowedOptions,
      allowedPairsText,
    });

    if (budgetLoopEnabled) {
      const poolPolicy = Number.isFinite(budgetReserveTokens) ? { reserveTokens: budgetReserveTokens } : undefined;
      const loopResult = await runLlmBudgetLoop({
        // CR.4 M5b: the loop no longer performs LLM IO; glue supplies the runner.
        runSession: runLlmSessionHosted,
        // M5b.2a′: pool mapping is the Director's decision, and mapPool is FSM-gated
        // behind an open build round. This root had no Director at all until now.
        // M5b.2b: the same round also answers the three Allocator pricing questions the
        // loop used to compute inline.
        // 2026-08-12: taken from the round opened above rather than opening one here —
        // the BuildSpec assembly below runs on that same round and closes it.
        ...directorBuildCapabilities(director),
        // #296: the budget fit goes to the host's solver, as `ak llm-plan`'s does.
        fitLayout: await commandKernel.hostLayoutBudgetFit(director, createdAt),
        adapter,
        model,
        baseUrl,
        catalog,
        goal,
        notes,
        budgetTokens: resolvedBudgetTokens,
        poolWeights: budgetPools.length > 0 ? budgetPools : undefined,
        poolPolicy,
        strict: isLlmStrictEnabled(),
        format: isNonEmptyString(llmFormat) ? llmFormat : undefined,
        runId,
        clock: () => createdAt,
        producedBy: "orchestrator",
      });
      if (!loopResult.ok) {
        throw new Error(`llm-plan budget loop failed: ${JSON.stringify(loopResult.errors || [])}`);
      }
      captures = loopResult.captures || [];
      summary = loopResult.summary;
      mappedSelections = loopResult.selections;
      budgetPoolWeights = loopResult.poolWeights || null;
    } else {
      // D8 follow-up 2026-08-08 — the non-loop branch mapped summaries onto the catalog by
      // importing `director/pool-mapper.js`, so this file kept an allowlist row that the
      // budget-loop branch three lines above had already retired. Same defect as M5b.2a′:
      // an artifact produced with no round. `mapPool` is FSM-gated, so the round is the
      // substance, not the import. The round itself is now opened once above.
      let session = await runLlmSessionHosted({
        adapter,
        model,
        baseUrl,
        prompt: isNonEmptyString(finalPrompt) ? finalPrompt : undefined,
        // CR.7 / WP-5: a cardSet is the Director's translation, injected rather than
        // imported. Uses the round opened just above.
        buildCardSet: director.buildCardSet,
        goal,
        budgetTokens: resolvedBudgetTokens,
        strict: isLlmStrictEnabled(),
        repairPromptBuilder,
        requireSummary: { minRooms: 1, minActors: 1 },
        runId,
        clock: () => createdAt,
        producedBy: "orchestrator",
        format: isNonEmptyString(llmFormat) ? llmFormat : undefined,
      });
      if (!session.ok) {
        throw new Error(`llm-plan session failed: ${JSON.stringify(session.errors || [])}`);
      }
      summary = session.summary;
      capture = session.capture;

      let mapped = director.mapPool({ summary, catalog });
      let actorInstances = countInstances(mapped.selections, "actor");
      if (actorInstances === 0) {
        const missingSelections = summarizeMissingSelections(mapped.selections);
        const catalogRepairPrompt = buildLlmCatalogRepairPromptTemplate({
          basePrompt,
          allowedPairsText,
          missingSelections,
        });
        session = await runLlmSessionHosted({
          adapter,
          model,
          baseUrl,
          prompt: catalogRepairPrompt,
          // CR.7 / WP-5: a cardSet is the Director's translation, injected rather than
          // imported. Uses the round opened just above.
          buildCardSet: director.buildCardSet,
          goal,
          budgetTokens: resolvedBudgetTokens,
          strict: isLlmStrictEnabled(),
          repairPromptBuilder,
          requireSummary: { minRooms: 1, minActors: 1 },
          runId,
          clock: () => createdAt,
          producedBy: "orchestrator",
          format: isNonEmptyString(llmFormat) ? llmFormat : undefined,
        });
        if (!session.ok) {
          throw new Error(`llm-plan session failed: ${JSON.stringify(session.errors || [])}`);
        }
        summary = session.summary;
        capture = session.capture;
        mapped = director.mapPool({ summary, catalog });
        actorInstances = countInstances(mapped.selections, "actor");
        if (actorInstances === 0) {
          const finalMissing = summarizeMissingSelections(mapped.selections);
          throw new Error(
            `llm-plan summary did not match catalog entries (actors=${actorInstances}).`
            + (finalMissing ? ` Unmatched picks: ${finalMissing}` : ""),
          );
        }
      }
      mappedSelections = mapped.selections;
    }
  } else {
    if (isNonEmptyString(prompt)) {
      throw new Error("llm-plan requires AK_LLM_LIVE=1 when using --prompt.");
    }
    if (!scenario) {
      throw new Error("llm-plan requires AK_LLM_LIVE=1 when --scenario is omitted.");
    }
    const summaryPath = resolveScenarioAssetPath(scenario.summaryPath, scenarioBaseDir);
    if (!summaryPath) {
      throw new Error("llm-plan requires scenario.summaryPath when AK_LLM_LIVE is off.");
    }
    const summaryFixture = await readJson(summaryPath);
    const normalized = normalizeSummary(summaryFixture);
    if (!normalized.ok) {
      throw new Error(`llm-plan summary fixture invalid: ${normalized.errors.map((entry) => entry.code).join(", ")}`);
    }
    summary = normalized.value;
  }

  let summaryForSpec = summary;
  if (!scenario) {
    summaryForSpec = { ...summary };
    if (isNonEmptyString(goal)) {
      summaryForSpec.goal = goal;
    }
    if (Number.isFinite(resolvedBudgetTokens)) {
      summaryForSpec.budgetTokens = resolvedBudgetTokens;
    }
  }
  if (!Array.isArray(summaryForSpec?.poolWeights) || summaryForSpec.poolWeights.length === 0) {
    const poolWeights = Array.isArray(budgetPoolWeights) && budgetPoolWeights.length > 0
      ? budgetPoolWeights
      : buildPoolWeightsForSummary(summaryForSpec);
    if (poolWeights.length > 0) {
      summaryForSpec = { ...summaryForSpec, poolWeights };
    }
  }

  // CR.7 / WP-5 — assembled BY the round opened at the top of this function, not by
  // reaching past it into `buildspec-assembler.js`. `roomGeometry` stays explicit: the
  // round's Director has no Configurator injected, so its own `roomGeometry()` is
  // `undefined` and a summary with room cards would be refused. Same pair either way.
  const buildSpecResult = director.assembleBuildSpec({
    summary: summaryForSpec,
    catalog,
    roomGeometry: configuratorRoomGeometry,
    selections: mappedSelections || undefined,
    runId,
    createdAt,
    source: "cli-llm-plan",
  });
  if (!buildSpecResult.ok) {
    throw new Error(`llm-plan build spec failed: ${buildSpecResult.errors.join("\n")}`);
  }
  const capturedInputsForBuild = captures.length > 0 ? captures : capture ? [capture] : undefined;
  const buildResult = await orchestrateBuild({
    spec: buildSpecResult.spec,
    producedBy: "cli-llm-plan",
    capturedInputs: capturedInputsForBuild,
    // #280: the plan this build persists is the one this round drafted.
    directorRound: director.currentRound(),
    placeObjects: await commandKernel.hostObjectPlacement(buildSpecResult.spec.meta.createdAt),
  });

  return buildDryRunSuccess({
    command: "scenario",
    runId,
    outDir,
    actorIds: deriveActorIds(buildResult.initialState),
    roomIds: deriveRoomIds(buildResult.simConfig),
    budgetEstimate: buildDryRunBudgetEstimate({
      budgetReceipt: buildResult.budgetReceipt,
      spendProposal: buildResult.spendProposal,
      budgetTokens: resolvedBudgetTokens,
    }),
    extra: {
      ticks: args.ticks !== undefined ? Number(args.ticks) : undefined,
    },
  });
}

function addManifestEntry(entries, artifact, path) {
  if (!artifact || typeof artifact !== "object") {
    return;
  }
  const id = artifact.meta?.id;
  if (!id) {
    return;
  }
  entries.push({
    id,
    schema: artifact.schema,
    schemaVersion: artifact.schemaVersion,
    path,
  });
}

function buildArtifactRefs(entries) {
  return entries.map((entry) => ({
    id: entry.id,
    schema: entry.schema,
    schemaVersion: entry.schemaVersion,
  }));
}

function logMixedRoomAssembliesFromBuildResult(buildResult) {
  const assemblies = attachMixedRoomAssembliesToBuildResult(buildResult);
  formatMixedRoomAssembliesCliLines(assemblies).forEach((line) => {
    console.error(line);
  });
}

const commandKernel = createCommandKernel({
  readJson,
  readText,
  writeJson,
  resolvePath,
  join,
  dirname,
  exists: existsSync,
  makeId,
  createMeta,
  toRef,
  defaultBuildOutDir,
  defaultRunCommandOutDir,
  defaultLlmPlanOutDir,
  allowNetworkRequests,
  isLlmLiveEnabled,
  isLlmStrictEnabled,
  isLlmBudgetLoopEnabled,
  isLocalBaseUrl,
  createIpfsAdapter,
  createBlockchainAdapter,
  createLlmAdapter,
  createSolverAdapter: async (options) => {
    let adapter;
    if (!options?.fixturePath && resolveSolverEngine() === "z3-real") {
      const { createHybridConstraintSolverAdapter } = await import("../adapters/z3/index.js");
      adapter = createHybridConstraintSolverAdapter(options);
    } else {
      const { createSolverAdapter } = await import("../adapters/solver-z3/index.js");
      adapter = createSolverAdapter(options);
    }
    // #557: AK_SOLVER_RECORD=<file> appends each answer, for a host with no solver to replay.
    if (!process.env.AK_SOLVER_RECORD) return adapter;
    const { withSolverRecording } = await import("../adapters/solver-recording/index.js");
    return withSolverRecording(adapter, process.env.AK_SOLVER_RECORD);
  },
  nowIso: () => new Date().toISOString(),
  env: process.env,
  cwd: () => process.cwd(),
  log: (...parts) => console.error(...parts),
  warn: (...parts) => console.error(...parts),
});



async function buildCommand(argv) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return;
  }

  assertAllowedBuildArgs(args);
  const result = await commandKernel.build(args);
  emitJsonStdout(await summarizeBuildLikeOutput({
    command: "build",
    outDir: result.outDir,
  }));
}

async function schemasCommand(argv) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return;
  }

  assertAllowedSchemasArgs(args);

  if (args["out-dir"] !== undefined && typeof args["out-dir"] !== "string") {
    throw new Error("schemas requires --out-dir <path> when provided.");
  }

  const outDir = resolvePath(args["out-dir"]);
  const clockOverride = process.env.AK_SCHEMA_CATALOG_TIME;
  const catalog = createSchemaCatalog({
    clock: clockOverride ? () => clockOverride : undefined,
  });

  if (outDir) {
    await writeJson(join(outDir, "schemas.json"), catalog);
    console.log(`schemas: wrote ${outDir}`);
    return;
  }

  console.log(`${JSON.stringify(catalog, null, 2)}`);
}

async function solveCommand(argv) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return;
  }
  const { outDir, runId, solverRequest, solverResult, answer, artifactPaths: questionPaths } = await commandKernel.solve(args);
  const artifactPaths = questionPaths || {
    solver_request: join(outDir, "solver-request.json"),
    solver_result: join(outDir, "solver-result.json"),
  };
  // `ok` says the command ran; `solved` says whether the solver answered. A deferred
  // result means no adapter served the request's domain, so nothing was solved, and
  // callers (ak_solve above all) must not read the envelope as an answer.
  // With --question, `answer` is the owning persona's verdict: which source decided it
  // (solver or fallback) and what it decided. `not_posed` means the persona needed no search.
  const status = solverResult?.status;
  emitJsonStdout({
    ok: true,
    command: "solve",
    runId: runId || solverRequest?.meta?.runId || args["run-id"] || "",
    outDir,
    solved: status !== "deferred" && status !== "error" && status !== "not_posed",
    status,
    ...(solverResult?.reason ? { reason: solverResult.reason } : {}),
    ...(answer ? { answer } : {}),
    artifactPaths,
  });
}

async function runCommand(argv) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return;
  }
  const resolvedArgs = await resolveRunInputArgs(args, { commandName: "run" });
  if (args["dry-run"]) {
    try {
      emitJsonStdout(await validateRunDryRun(resolvedArgs));
    } catch (error) {
      emitJsonStdout(buildDryRunFailure({
        command: "run",
        runId: resolvedArgs["run-id"] || "",
        outDir: resolvePath(resolvedArgs["out-dir"]),
        error,
      }));
    }
    return;
  }
  const progressEnabled = args.progress === true;
  const kernelArgs = progressEnabled
    ? {
        ...resolvedArgs,
        log: () => {},
        onTickProgress: (payload) => emitJsonStderr(payload),
      }
    : resolvedArgs;
  const result = await commandKernel.run(kernelArgs);
  emitJsonStdout(await summarizeRunOutput({ outDir: result.outDir, args: resolvedArgs, pricingReport: result.pricingReport }));
}

async function configuratorCommand(argv) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return;
  }
  await commandKernel.configurator(args);
}

async function budgetCommand(argv) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return;
  }
  const result = await commandKernel.budget(args);
  emitJsonStdout({ ok: true, command: "budget", ...result.output });
}

async function replayCommand(argv) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return;
  }
  await commandKernel.replay(args);
}

async function inspectCommand(argv) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return;
  }
  const result = await commandKernel.inspect(args);
  const tickFramesPath = resolvePath(args["tick-frames"]);
  emitJsonStdout(await summarizeInspectOutput({
    outDir: result.outDir,
    runtimeBudgetReceiptPath: tickFramesPath ? join(dirname(tickFramesPath), "runtime-budget-receipt.json") : null,
    buildDir: resolvePath(args["build-dir"]),
  }));
}

async function narrateCommand(argv) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return;
  }

  const tickFramesPath = resolvePath(args["tick-frames"]);
  const initialStatePath = resolvePath(args["initial-state"]);
  if (!tickFramesPath || !initialStatePath) {
    throw new Error("narrate requires --tick-frames and --initial-state.");
  }

  const [frames, initialState] = await Promise.all([
    readJson(tickFramesPath),
    readJson(initialStatePath),
  ]);
  assertSchema(initialState, SCHEMAS.initialState);
  if (!Array.isArray(frames)) {
    throw new Error("narrate expects --tick-frames to contain a JSON array.");
  }
  frames.forEach((frame) => assertSchema(frame, SCHEMAS.tickFrame));

  const runId = initialState?.meta?.runId || frames[0]?.meta?.runId || makeId("run");
  const outDir = resolvePath(args["out-dir"]) || defaultOutDir("narrate", runId);
  const narrative = createNarrativeArtifact({ initialState, frames, runId });
  await writeJson(join(outDir, "narrative.json"), narrative);
  emitJsonStdout(await summarizeNarrateOutput({ outDir }));
}

async function ipfsCommand(argv) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return;
  }
  const runId = makeId("run");
  const outDir = resolvePath(args["out-dir"]) || defaultOutDir("ipfs", runId);
  const outPath = resolvePath(args.out) || join(outDir, args.json ? "ipfs.json" : "ipfs.txt");
  const result = await commandKernel.ipfs(args);
  if (args.json) await writeJson(outPath, result.output);
  else await writeText(outPath, result.output);

  console.log(`ipfs: wrote ${outPath}`);
}

async function ipfsPublishCommand(argv) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return;
  }
  const artifactMapPath = resolvePath(args["artifact-map"]);
  if (!artifactMapPath) {
    throw new Error("ipfs-publish requires --artifact-map.");
  }

  const runId = makeId("run");
  const outDir = resolvePath(args["out-dir"]) || defaultOutDir("ipfs-publish", runId);
  const outPath = resolvePath(args.out) || join(outDir, "ipfs-publish.json");
  const artifactMap = await readJson(artifactMapPath);

  const result = await commandKernel.ipfsPublish({
    path: args.path,
    gateway: args.gateway,
    "fixture-cid": args["fixture-cid"],
    "artifact-map": artifactMap,
  });
  await writeJson(outPath, {
    cid: result.cid,
    rootPath: result.rootPath || "",
    publishedFiles: result.publishedFiles || [],
    mode: result.mode || "live",
  });
  console.log(`ipfs-publish: wrote ${outPath}`);
}

async function ipfsLoadCommand(argv) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return;
  }
  const runId = makeId("run");
  const outDir = resolvePath(args["out-dir"]) || defaultOutDir("ipfs-load", runId);
  const outPath = resolvePath(args.out) || join(outDir, "ipfs-load.json");
  const fixtureMapPath = resolvePath(args["fixture-map"]);
  const fixtureMap = fixtureMapPath ? await readJson(fixtureMapPath) : undefined;

  const result = await commandKernel.ipfsLoad({
    cid: args.cid,
    path: args.path,
    file: args.file,
    gateway: args.gateway,
    "fixture-map": fixtureMap,
  });

  const fetched = result?.fetched || {};
  for (const [fileName, payload] of Object.entries(fetched)) {
    await writeJson(join(outDir, fileName), payload);
  }
  await writeJson(outPath, {
    cid: result.cid,
    rootPath: result.rootPath || "",
    fetchedFiles: Object.keys(fetched),
    missing: result.missing || [],
  });
  console.log(`ipfs-load: wrote ${outDir}`);
}

async function blockchainCommand(argv) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return;
  }
  const runId = makeId("run");
  const outDir = resolvePath(args["out-dir"]) || defaultOutDir("blockchain", runId);
  const outPath = resolvePath(args.out) || join(outDir, "blockchain.json");
  const result = await commandKernel.blockchain(args);
  await writeJson(outPath, result.output);
  console.log(`blockchain: wrote ${outPath}`);
}

async function blockchainMintCommand(argv) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return;
  }
  const runId = makeId("run");
  const outDir = resolvePath(args["out-dir"]) || defaultOutDir("blockchain-mint", runId);
  const outPath = resolvePath(args.out) || join(outDir, "blockchain-mint.json");
  const result = await commandKernel.blockchainMint(args);
  await writeJson(outPath, result.output);
  console.log(`blockchain-mint: wrote ${outPath}`);
}

async function blockchainLoadCommand(argv) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return;
  }
  const runId = makeId("run");
  const outDir = resolvePath(args["out-dir"]) || defaultOutDir("blockchain-load", runId);
  const outPath = resolvePath(args.out) || join(outDir, "blockchain-load.json");
  const result = await commandKernel.blockchainLoad(args);
  await writeJson(outPath, result.output);
  console.log(`blockchain-load: wrote ${outPath}`);
}

async function llmCommand(argv) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return;
  }
  const runId = makeId("run");
  const outDir = resolvePath(args["out-dir"]) || defaultOutDir("llm", runId);
  const outPath = resolvePath(args.out) || join(outDir, "llm.json");
  const result = await commandKernel.llm(args);
  await writeJson(outPath, result.output);
  console.log(`llm: wrote ${outPath}`);
}

/**
 * #402: `--tactic llm`. The Orchestrator's prompt asks the model for a tactic plan; the Director
 * reads the tactics (unknown ones refused) and the Configurator checks params and counts. With no
 * model (no --fixture and AK_LLM_LIVE off, or a non-local URL without AK_ALLOW_NETWORK), a failed
 * call or an invalid reply, the seeded plan (#401) decides. `tacticPlan` records which path decided
 * and what the model returned; the result's `tactics` replays the build with no model.
 */
async function resolveLlmTacticPlan({ args, seededTactics, levelCounts, rooms }) {
  const fallback = (reasons, extra = {}) => ({
    tactics: seededTactics,
    tacticPlan: { decidedBy: "seeded", reasons, ...extra },
  });
  const fixturePath = args.fixture;
  const baseUrl = args["base-url"] || process.env.AK_LLM_BASE_URL || DEFAULT_LLM_BASE_URL;
  if (!fixturePath && !isLlmLiveEnabled()) {
    return fallback(["no model: pass --fixture or set AK_LLM_LIVE=1"]);
  }
  if (!fixturePath && !allowNetworkRequests() && !isLocalBaseUrl(baseUrl)) {
    return fallback(["no model: a non-local --base-url needs AK_ALLOW_NETWORK=1"]);
  }
  const model = args.model || process.env.AK_LLM_MODEL || DEFAULT_LLM_MODEL;
  const prompt = buildTacticPlanPrompt({ ...levelCounts, rooms, goal: args.goal });
  let payload;
  try {
    const adapter = fixturePath
      ? createLlmAdapter({ fixture: JSON.parse(await readText(fixturePath)) })
      : createLlmAdapter({ baseUrl });
    payload = await adapter.generate({ model, prompt, stream: false });
  } catch (error) {
    return fallback([`model call failed: ${error.message}`], { model });
  }
  const reply = readTacticPlanResponse(payload);
  if (reply.errors) return fallback(reply.errors, { model });
  let tactics;
  try {
    tactics = tacticDirector.normalizeTactics(reply.tactics);
  } catch (error) {
    return fallback([error.message], { model, response: reply.tactics });
  }
  const errors = configurator.validateTactics(tactics, levelCounts);
  if (errors.length > 0) return fallback(errors, { model, response: reply.tactics });
  return { tactics, tacticPlan: { decidedBy: "llm", model, response: reply.tactics } };
}

async function agentAuthoringCommand(argv, { commandName, action, allowDryRun = false } = {}) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return;
  }

  const {
    runId,
    createdAt,
    resolvedBudgetTokens,
    tacticPlan,
    requestArtifact,
    hazards: canonicalHazardEntries,
    resources: parsedResources,
    buildInput,
  } = await prepareAuthoringBuild(args, { commandName, action, allowDryRun }, {
    readArtifact: (path) => readJson(resolvePath(path)),
    drawSeed: () => randomInt(0, 2 ** 31 - 1),
    planTacticsWithLlm: resolveLlmTacticPlan,
    now: () => new Date().toISOString(),
  });
  const outDir = resolvePath(args["out-dir"]) || defaultRunCommandOutDir(commandName, runId);

  // Authoring domain build runs in the kernel (P2.3.2): assemble the BuildSpec
  // through the Director controller, Configurator input prep, orchestrateBuild,
  // and post-process.
  const { buildResult } = await commandKernel.authoringBuild(buildInput);

  if (args["dry-run"]) {
    emitJsonStdout(buildDryRunSuccess({
      command: commandName,
      runId,
      outDir,
      actorIds: deriveActorIds(buildResult.initialState),
      roomIds: deriveRoomIds(buildResult.simConfig),
      budgetEstimate: buildDryRunBudgetEstimate({
        budgetReceipt: buildResult.budgetReceipt,
        spendProposal: buildResult.spendProposal,
        budgetTokens: resolvedBudgetTokens,
      }),
    }));
    return;
  }

  const stdoutSummary = await writeBuildOutputs({
    outDir,
    spec: buildResult.spec,
    buildResult,
    requestArtifact,
    emitIntermediates: Boolean(args["emit-intermediates"]),
    commandName,
    producedBy: `cli-${commandName}`,
    tacticPlan,
  });

  await writeHazardArtifactFiles({
    parsedHazards: canonicalHazardEntries,
    outDir,
    runId,
    createdAt,
    producedBy: `cli-${commandName}`,
  });
  await writeResourceArtifactFiles({
    parsedResources,
    outDir,
    runId,
    createdAt,
    producedBy: `cli-${commandName}`,
  });

  emitJsonStdout(stdoutSummary);
}

async function createCommand(argv) {
  const args = parseArgs(argv);
  if (args["dry-run"]) {
    try {
      await agentAuthoringCommand(argv, { commandName: "create", action: "author", allowDryRun: true });
    } catch (error) {
      emitJsonStdout(buildDryRunFailure({
        command: "create",
        runId: args["run-id"] || "",
        outDir: resolvePath(args["out-dir"]),
        error,
      }));
    }
    return;
  }
  await agentAuthoringCommand(argv, { commandName: "create", action: "author", allowDryRun: true });
}

async function configureAuthoringCommand(argv) {
  await agentAuthoringCommand(argv, { commandName: "configure", action: "configure" });
}

async function roomPlanCommand(argv) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return;
  }

  assertAllowedRoomPlanArgs(args);

  const parsedRooms = parseRoomSpecs(args.room);
  const runId = args["run-id"] || makeId("run");
  const createdAt = args["created-at"] || new Date().toISOString();
  const outDir = resolvePath(args["out-dir"]) || defaultRunCommandOutDir("room-plan", runId);
  const budgetPath = resolvePath(args.budget);
  const priceListPath = resolvePath(args["price-list"]);

  const dungeonAffinity = isNonEmptyString(args["dungeon-affinity"])
    ? args["dungeon-affinity"].trim().toLowerCase()
    : (DEFAULT_ROOM_CARD_AFFINITY ?? undefined);
  if (dungeonAffinity !== undefined && !ALLOWED_AFFINITIES.includes(dungeonAffinity)) {
    throw new Error(`room-plan --dungeon-affinity must be one of: ${ALLOWED_AFFINITIES.join(", ")}.`);
  }

  let budgetTokensFlag;
  if (args["budget-tokens"] !== undefined) {
    budgetTokensFlag = parsePositiveIntStrict(args["budget-tokens"], "room-plan --budget-tokens");
  }
  if ((budgetPath && !priceListPath) || (!budgetPath && priceListPath)) {
    throw new Error("room-plan requires both --budget and --price-list.");
  }

  let budgetArtifact = null;
  let priceListArtifact = null;
  if (budgetPath) {
    budgetArtifact = await readJson(budgetPath);
    assertSchema(budgetArtifact, SCHEMAS.budgetArtifact);
  }
  if (priceListPath) {
    priceListArtifact = await readJson(priceListPath);
    assertSchema(priceListArtifact, SCHEMAS.priceList);
  }

  const goal = isNonEmptyString(args.goal)
    ? args.goal.trim()
    : `Author dungeon rooms (${parsedRooms.length} configuration${parsedRooms.length === 1 ? "" : "s"}).`;
  const textBudgetTokens = extractBudgetTokensFromText(goal, "room-plan --goal");
  const {
    resolvedBudgetTokens,
    requestedBudgetTokens,
    constraints: authoringConstraints,
  } = resolveAuthoringBudget({
    commandName: "room-plan",
    textBudgetTokens,
    flagBudgetTokens: budgetTokensFlag,
    budgetArtifact,
  });
  resolveTextVitalOptimizationGoals({
    commandName: "room-plan",
    text: goal,
    scope: null,
  });
  const sharedOptimizationGoals = buildSharedOptimizationGoals({
    text: goal,
    hardBudgetConstraint: authoringConstraints,
  });
  ensureBudgetedFulfillmentFeasible({
    commandName: "room-plan",
    budgetTokens: resolvedBudgetTokens,
    rooms: parsedRooms,
    delvers: [],
    priceListArtifact,
  });
  const fulfilledRooms = applyBudgetCappedFulfillment({
    rooms: parsedRooms,
    delvers: [],
    priceListArtifact,
    budgetTokens: requestedBudgetTokens,
  }).rooms;
  const summary = {
    goal,
    dungeonAffinity,
    rooms: fulfilledRooms.map((entry) => entry.value),
    actors: [],
    poolWeights: [{ id: "rooms", weight: 1 }],
  };
  if (resolvedBudgetTokens !== undefined) {
    summary.budgetTokens = resolvedBudgetTokens;
  }

  const authoring = buildAuthoringSection({
    objectKinds: ["room"],
    constraints: authoringConstraints,
    sharedOptimizationGoals,
  });
  const { buildResult } = await commandKernel.planBuild({
    summary,
    authoring,
    commandName: "room-plan",
    runId,
    createdAt,
    budgetArtifact,
    priceListArtifact,
  });
  emitJsonStdout(await writeBuildOutputs({
    outDir,
    spec: buildResult.spec,
    buildResult,
    emitIntermediates: Boolean(args["emit-intermediates"]),
    commandName: "room-plan",
    producedBy: "cli-room-plan",
  }));
}

async function hazardPlanCommand(argv) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return;
  }

  assertAllowedHazardPlanArgs(args);

  const parsedHazards = parseHazardSpecs(args.hazard);
  const runId = args["run-id"] || makeId("run");
  const createdAt = args["created-at"] || new Date().toISOString();
  const outDir = resolvePath(args["out-dir"]) || defaultRunCommandOutDir("hazard-plan", runId);
  const budgetPath = resolvePath(args.budget);
  const priceListPath = resolvePath(args["price-list"]);

  const dungeonAffinity = isNonEmptyString(args["dungeon-affinity"])
    ? args["dungeon-affinity"].trim().toLowerCase()
    : (DEFAULT_DUNGEON_AFFINITY ?? undefined);
  if (dungeonAffinity !== undefined && !ALLOWED_AFFINITIES.includes(dungeonAffinity)) {
    throw new Error(`hazard-plan --dungeon-affinity must be one of: ${ALLOWED_AFFINITIES.join(", ")}.`);
  }

  let budgetTokensFlag;
  if (args["budget-tokens"] !== undefined) {
    budgetTokensFlag = parsePositiveIntStrict(args["budget-tokens"], "hazard-plan --budget-tokens");
  }
  if ((budgetPath && !priceListPath) || (!budgetPath && priceListPath)) {
    throw new Error("hazard-plan requires both --budget and --price-list.");
  }

  let budgetArtifact = null;
  let priceListArtifact = null;
  if (budgetPath) {
    budgetArtifact = await readJson(budgetPath);
    assertSchema(budgetArtifact, SCHEMAS.budgetArtifact);
  }
  if (priceListPath) {
    priceListArtifact = await readJson(priceListPath);
    assertSchema(priceListArtifact, SCHEMAS.priceList);
  }

  const goal = isNonEmptyString(args.goal)
    ? args.goal.trim()
    : `Author hazards (${parsedHazards.length} configuration${parsedHazards.length === 1 ? "" : "s"}).`;
  const textBudgetTokens = extractBudgetTokensFromText(goal, "hazard-plan --goal");
  const {
    resolvedBudgetTokens,
    constraints: authoringConstraints,
  } = resolveAuthoringBudget({
    commandName: "hazard-plan",
    textBudgetTokens,
    flagBudgetTokens: budgetTokensFlag,
    budgetArtifact,
  });
  const sharedOptimizationGoals = buildSharedOptimizationGoals({
    text: goal,
    hardBudgetConstraint: authoringConstraints,
  });
  const hazards = parsedHazards.map((entry) => entry.value);
  const summary = {
    goal,
    dungeonAffinity,
    hazards,
    budgetScaffold: true,
    poolWeights: [{ id: "hazards", weight: 1 }],
  };
  if (resolvedBudgetTokens !== undefined) {
    summary.budgetTokens = resolvedBudgetTokens;
  }

  const authoring = buildAuthoringSection({
    objectKinds: ["hazard"],
    constraints: authoringConstraints,
    sharedOptimizationGoals,
  });
  const { buildResult } = await commandKernel.planBuild({
    summary,
    authoring,
    commandName: "hazard-plan",
    runId,
    createdAt,
    budgetArtifact,
    priceListArtifact,
  });
  const stdoutSummary = await writeBuildOutputs({
    outDir,
    spec: buildResult.spec,
    buildResult,
    emitIntermediates: Boolean(args["emit-intermediates"]),
    commandName: "hazard-plan",
    producedBy: "cli-hazard-plan",
  });
  await writeHazardArtifactFiles({
    parsedHazards,
    outDir,
    runId,
    createdAt,
    producedBy: "cli-hazard-plan",
  });
  emitJsonStdout(stdoutSummary);
}

async function resourcePlanCommand(argv) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return;
  }

  assertAllowedResourcePlanArgs(args);

  const parsedResources = parseResourceSpecs(args.resource);
  const runId = args["run-id"] || makeId("run");
  const createdAt = args["created-at"] || new Date().toISOString();
  const outDir = resolvePath(args["out-dir"]) || defaultRunCommandOutDir("resource-plan", runId);
  const budgetPath = resolvePath(args.budget);
  const priceListPath = resolvePath(args["price-list"]);

  const dungeonAffinity = isNonEmptyString(args["dungeon-affinity"])
    ? args["dungeon-affinity"].trim().toLowerCase()
    : (DEFAULT_DUNGEON_AFFINITY ?? undefined);
  if (dungeonAffinity !== undefined && !ALLOWED_AFFINITIES.includes(dungeonAffinity)) {
    throw new Error(`resource-plan --dungeon-affinity must be one of: ${ALLOWED_AFFINITIES.join(", ")}.`);
  }

  let budgetTokensFlag;
  if (args["budget-tokens"] !== undefined) {
    budgetTokensFlag = parsePositiveIntStrict(args["budget-tokens"], "resource-plan --budget-tokens");
  }
  if ((budgetPath && !priceListPath) || (!budgetPath && priceListPath)) {
    throw new Error("resource-plan requires both --budget and --price-list.");
  }

  let budgetArtifact = null;
  let priceListArtifact = null;
  if (budgetPath) {
    budgetArtifact = await readJson(budgetPath);
    assertSchema(budgetArtifact, SCHEMAS.budgetArtifact);
  }
  if (priceListPath) {
    priceListArtifact = await readJson(priceListPath);
    assertSchema(priceListArtifact, SCHEMAS.priceList);
  }

  const goal = isNonEmptyString(args.goal)
    ? args.goal.trim()
    : `Author resources (${parsedResources.length} configuration${parsedResources.length === 1 ? "" : "s"}).`;
  const textBudgetTokens = extractBudgetTokensFromText(goal, "resource-plan --goal");
  const {
    resolvedBudgetTokens,
    constraints: authoringConstraints,
  } = resolveAuthoringBudget({
    commandName: "resource-plan",
    textBudgetTokens,
    flagBudgetTokens: budgetTokensFlag,
    budgetArtifact,
  });
  const sharedOptimizationGoals = buildSharedOptimizationGoals({
    text: goal,
    hardBudgetConstraint: authoringConstraints,
  });
  const resources = parsedResources.map((entry) => entry.value);
  const summary = {
    goal,
    dungeonAffinity,
    resources,
    budgetScaffold: true,
    poolWeights: [{ id: "resources", weight: 1 }],
  };
  if (resolvedBudgetTokens !== undefined) {
    summary.budgetTokens = resolvedBudgetTokens;
  }

  const authoring = buildAuthoringSection({
    objectKinds: ["resource"],
    constraints: authoringConstraints,
    sharedOptimizationGoals,
  });
  const { buildResult } = await commandKernel.planBuild({
    summary,
    authoring,
    commandName: "resource-plan",
    runId,
    createdAt,
    budgetArtifact,
    priceListArtifact,
  });
  const stdoutSummary = await writeBuildOutputs({
    outDir,
    spec: buildResult.spec,
    buildResult,
    emitIntermediates: Boolean(args["emit-intermediates"]),
    commandName: "resource-plan",
    producedBy: "cli-resource-plan",
  });
  await writeResourceArtifactFiles({
    parsedResources,
    outDir,
    runId,
    createdAt,
    producedBy: "cli-resource-plan",
  });
  emitJsonStdout(stdoutSummary);
}

async function delverPlanCommand(argv) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return;
  }

  assertAllowedDelverPlanArgs(args);

  const runId = args["run-id"] || makeId("run");
  const createdAt = args["created-at"] || new Date().toISOString();
  const outDir = resolvePath(args["out-dir"]) || defaultRunCommandOutDir("delver-plan", runId);
  const budgetPath = resolvePath(args.budget);
  const priceListPath = resolvePath(args["price-list"]);

  const dungeonAffinity = isNonEmptyString(args["dungeon-affinity"])
    ? args["dungeon-affinity"].trim().toLowerCase()
    : (DEFAULT_DUNGEON_AFFINITY ?? undefined);
  if (dungeonAffinity !== undefined && !ALLOWED_AFFINITIES.includes(dungeonAffinity)) {
    throw new Error(`delver-plan --dungeon-affinity must be one of: ${ALLOWED_AFFINITIES.join(", ")}.`);
  }

  const parsedDelvers = parseDelverSpecs(args.delver, { defaultAffinity: dungeonAffinity });

  let budgetTokensFlag;
  if (args["budget-tokens"] !== undefined) {
    budgetTokensFlag = parsePositiveIntStrict(args["budget-tokens"], "delver-plan --budget-tokens");
  }
  if ((budgetPath && !priceListPath) || (!budgetPath && priceListPath)) {
    throw new Error("delver-plan requires both --budget and --price-list.");
  }

  let budgetArtifact = null;
  let priceListArtifact = null;
  if (budgetPath) {
    budgetArtifact = await readJson(budgetPath);
    assertSchema(budgetArtifact, SCHEMAS.budgetArtifact);
  }
  if (priceListPath) {
    priceListArtifact = await readJson(priceListPath);
    assertSchema(priceListArtifact, SCHEMAS.priceList);
  }

  const goal = isNonEmptyString(args.goal)
    ? args.goal.trim()
    : `Author delvers (${parsedDelvers.length} configuration${parsedDelvers.length === 1 ? "" : "s"}).`;
  const textBudgetTokens = extractBudgetTokensFromText(goal, "delver-plan --goal");
  const {
    resolvedBudgetTokens,
    requestedBudgetTokens,
    constraints: authoringConstraints,
  } = resolveAuthoringBudget({
    commandName: "delver-plan",
    textBudgetTokens,
    flagBudgetTokens: budgetTokensFlag,
    budgetArtifact,
  });
  const textVitalGoals = resolveTextVitalOptimizationGoals({
    commandName: "delver-plan",
    text: goal,
    scope: "delver",
  });
  const sharedOptimizationGoals = buildSharedOptimizationGoals({
    text: goal,
    hardBudgetConstraint: authoringConstraints,
  });
  const delverOptimizationGoals = dedupeOptimizationGoals([
    ...parsedDelvers.flatMap((entry) => entry.optimizationGoals || []),
    ...textVitalGoals,
  ]);
  ensureBudgetedFulfillmentFeasible({
    commandName: "delver-plan",
    budgetTokens: resolvedBudgetTokens,
    rooms: [],
    delvers: parsedDelvers.map((entry) => ({
      ...entry,
      optimizationGoals: dedupeOptimizationGoals([
        ...(entry.optimizationGoals || []),
        ...textVitalGoals,
      ]),
    })),
    priceListArtifact,
  });
  const fulfilledDelvers = applyBudgetCappedFulfillment({
    rooms: [],
    delvers: parsedDelvers.map((entry) => ({
      ...entry,
      optimizationGoals: dedupeOptimizationGoals([
        ...(entry.optimizationGoals || []),
        ...textVitalGoals,
      ]),
    })),
    priceListArtifact,
    budgetTokens: requestedBudgetTokens,
  }).delvers;
  const summary = {
    goal,
    dungeonAffinity,
    cardSet: fulfilledDelvers.map((entry) => entry.value),
    budgetScaffold: true,
    poolWeights: [{ id: "delver", weight: 1 }],
  };
  if (resolvedBudgetTokens !== undefined) {
    summary.budgetTokens = resolvedBudgetTokens;
  }

  const authoring = buildAuthoringSection({
    objectKinds: ["delver"],
    constraints: authoringConstraints,
    sharedOptimizationGoals,
    objectOptimizationGoals: delverOptimizationGoals,
  });
  const { buildResult } = await commandKernel.planBuild({
    summary,
    authoring,
    commandName: "delver-plan",
    runId,
    createdAt,
    budgetArtifact,
    priceListArtifact,
  });
  emitJsonStdout(await writeBuildOutputs({
    outDir,
    spec: buildResult.spec,
    buildResult,
    emitIntermediates: Boolean(args["emit-intermediates"]),
    commandName: "delver-plan",
    producedBy: "cli-delver-plan",
  }));
}

async function wardenPlanCommand(argv) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return;
  }

  assertAllowedWardenPlanArgs(args);

  const runId = args["run-id"] || makeId("run");
  const createdAt = args["created-at"] || new Date().toISOString();
  const outDir = resolvePath(args["out-dir"]) || defaultRunCommandOutDir("warden-plan", runId);
  const budgetPath = resolvePath(args.budget);
  const priceListPath = resolvePath(args["price-list"]);

  const dungeonAffinity = isNonEmptyString(args["dungeon-affinity"])
    ? args["dungeon-affinity"].trim().toLowerCase()
    : (DEFAULT_DUNGEON_AFFINITY ?? undefined);
  if (dungeonAffinity !== undefined && !ALLOWED_AFFINITIES.includes(dungeonAffinity)) {
    throw new Error(`warden-plan --dungeon-affinity must be one of: ${ALLOWED_AFFINITIES.join(", ")}.`);
  }

  const wardens = parseWardenSpecs(args.warden, { defaultAffinity: dungeonAffinity });

  let budgetTokensFlag;
  if (args["budget-tokens"] !== undefined) {
    budgetTokensFlag = parsePositiveIntStrict(args["budget-tokens"], "warden-plan --budget-tokens");
  }
  if ((budgetPath && !priceListPath) || (!budgetPath && priceListPath)) {
    throw new Error("warden-plan requires both --budget and --price-list.");
  }

  let budgetArtifact = null;
  let priceListArtifact = null;
  if (budgetPath) {
    budgetArtifact = await readJson(budgetPath);
    assertSchema(budgetArtifact, SCHEMAS.budgetArtifact);
  }
  if (priceListPath) {
    priceListArtifact = await readJson(priceListPath);
    assertSchema(priceListArtifact, SCHEMAS.priceList);
  }

  const goal = isNonEmptyString(args.goal)
    ? args.goal.trim()
    : `Author wardens (${wardens.length} configuration${wardens.length === 1 ? "" : "s"}).`;
  const textBudgetTokens = extractBudgetTokensFromText(goal, "warden-plan --goal");
  const {
    resolvedBudgetTokens,
    constraints: authoringConstraints,
  } = resolveAuthoringBudget({
    commandName: "warden-plan",
    textBudgetTokens,
    flagBudgetTokens: budgetTokensFlag,
    budgetArtifact,
  });
  const textVitalGoals = resolveTextVitalOptimizationGoals({
    commandName: "warden-plan",
    text: goal,
    scope: "warden",
  });
  const sharedOptimizationGoals = buildSharedOptimizationGoals({
    text: goal,
    hardBudgetConstraint: authoringConstraints,
  });
  ensureBudgetedFulfillmentFeasible({
    commandName: "warden-plan",
    budgetTokens: resolvedBudgetTokens,
    rooms: [],
    delvers: [],
    wardens: wardens.map((entry) => ({
      value: entry,
      optimizationGoals: dedupeOptimizationGoals(textVitalGoals),
    })),
    priceListArtifact,
  });
  const summary = {
    goal,
    dungeonAffinity,
    cardSet: wardens,
    budgetScaffold: true,
    poolWeights: [{ id: "wardens", weight: 1 }],
  };
  if (resolvedBudgetTokens !== undefined) {
    summary.budgetTokens = resolvedBudgetTokens;
  }

  const authoring = buildAuthoringSection({
    objectKinds: ["warden"],
    constraints: authoringConstraints,
    sharedOptimizationGoals,
    objectOptimizationGoals: textVitalGoals,
  });
  const { buildResult } = await commandKernel.planBuild({
    summary,
    authoring,
    commandName: "warden-plan",
    runId,
    createdAt,
    budgetArtifact,
    priceListArtifact,
  });
  emitJsonStdout(await writeBuildOutputs({
    outDir,
    spec: buildResult.spec,
    buildResult,
    emitIntermediates: Boolean(args["emit-intermediates"]),
    commandName: "warden-plan",
    producedBy: "cli-warden-plan",
  }));
}

async function llmPlanCommand(argv) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return;
  }
  const result = await commandKernel.llmPlan(args);
  emitJsonStdout(await summarizeBuildLikeOutput({
    command: "llm-plan",
    outDir: result.outDir,
  }));
}

async function scenarioCommand(argv) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return;
  }
  assertAllowedScenarioArgs(args);
  const fromRunId = args["from-run"];
  const hasFromRun = isNonEmptyString(fromRunId);
  const hasLevelFiles = isNonEmptyString(args["sim-config"]) || isNonEmptyString(args["initial-state"]);
  if (!hasFromRun && !hasLevelFiles && !isNonEmptyString(args.text)) {
    throw new Error("scenario requires --text, --from-run, or --sim-config with --initial-state.");
  }
  if (hasFromRun && isNonEmptyString(args.text)) {
    throw new Error("scenario does not allow --text together with --from-run.");
  }
  if (args["dry-run"]) {
    try {
      emitJsonStdout(await validateScenarioDryRun(args));
    } catch (error) {
      emitJsonStdout(buildDryRunFailure({
        command: "scenario",
        runId: args["run-id"] || "",
        outDir: resolvePath(args["out-dir"]),
        error,
      }));
    }
    return;
  }

  const runId = args["run-id"] || fromRunId || makeId("run");
  const outDir = resolvePath(args["out-dir"]) || defaultRunDir(runId);
  const runOutDir = join(outDir, "run");
  const inspectOutDir = join(outDir, "inspect");
  let llmPlanResult = null;
  let llmPlanSummary = null;
  let sourceArtifactPaths = null;
  let runArgs;

  const resolvedFromRun = await resolveScenarioLevelSource(args);
  if (resolvedFromRun) {
    runArgs = {
      "sim-config": resolvedFromRun.simConfigPath,
      "initial-state": resolvedFromRun.initialStatePath,
      ticks: args.ticks,
      seed: args.seed,
      "run-id": runId,
      "out-dir": runOutDir,
    };
    sourceArtifactPaths = {
      source_sim_config: resolvedFromRun.simConfigPath,
      source_initial_state: resolvedFromRun.initialStatePath,
    };
  } else {
    const llmPlanOutDir = join(outDir, "llm-plan");
    const llmPlanArgs = {
      text: args.text,
      catalog: args.catalog,
      model: args.model,
      goal: args.goal,
      "budget-tokens": args["budget-tokens"],
      "base-url": args["base-url"],
      fixture: args.fixture,
      "budget-loop": args["budget-loop"],
      "budget-pool": args["budget-pool"],
      "budget-reserve": args["budget-reserve"],
      "run-id": runId,
      "created-at": args["created-at"],
      "emit-intermediates": args["emit-intermediates"],
      "out-dir": llmPlanOutDir,
    };
    llmPlanResult = await commandKernel.llmPlan(llmPlanArgs);

    const simConfigPath = join(llmPlanResult.outDir, "sim-config.json");
    const initialStatePath = join(llmPlanResult.outDir, "initial-state.json");
    if (!existsSync(simConfigPath) || !existsSync(initialStatePath)) {
      throw new Error("scenario requires llm-plan to produce sim-config.json and initial-state.json.");
    }

    runArgs = {
      "sim-config": simConfigPath,
      "initial-state": initialStatePath,
      ticks: args.ticks,
      seed: args.seed,
      "run-id": runId,
      "out-dir": runOutDir,
    };
  }
  const runResult = await commandKernel.run(runArgs);

  const inspectResult = await commandKernel.inspect({
    "tick-frames": join(runResult.outDir, "tick-frames.json"),
    "effects-log": join(runResult.outDir, "effects-log.json"),
    "out-dir": inspectOutDir,
  });

  const [runSummary, inspectSummary] = await Promise.all([
    summarizeRunOutput({
      outDir: runResult.outDir,
      args: runArgs,
      pricingReport: runResult.pricingReport,
    }),
    summarizeInspectOutput({
      outDir: inspectResult.outDir,
      runtimeBudgetReceiptPath: join(runResult.outDir, "runtime-budget-receipt.json"),
    }),
  ]);
  if (llmPlanResult) {
    llmPlanSummary = await summarizeBuildLikeOutput({
      command: "llm-plan",
      outDir: llmPlanResult.outDir,
    });
  }

  emitJsonStdout(buildScenarioSummary({
    runId,
    outDir,
    llmPlanSummary,
    sourceArtifactPaths,
    runSummary,
    inspectSummary,
  }));
}

async function showCommand(argv) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return;
  }
  if (!isNonEmptyString(args["run-id"])) {
    throw new Error("show requires --run-id <id>.");
  }
  const unknown = [];
  for (const key of Object.keys(args)) {
    if (key === "_" || key === "help" || key === "run-id") {
      continue;
    }
    unknown.push(`--${key}`);
  }
  if (Array.isArray(args._) && args._.length > 0) {
    unknown.push(...args._);
  }
  if (unknown.length > 0) {
    throw new Error(`show only accepts --run-id. Unknown: ${unknown.join(", ")}`);
  }
  emitJsonStdout(await summarizeRunShow({ runId: args["run-id"] }));
}

async function diffCommand(argv) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return;
  }
  if (!isNonEmptyString(args["run-a"]) || !isNonEmptyString(args["run-b"])) {
    throw new Error("diff requires --run-a <id> and --run-b <id>.");
  }
  const unknown = [];
  for (const key of Object.keys(args)) {
    if (key === "_" || key === "help" || key === "run-a" || key === "run-b") {
      continue;
    }
    unknown.push(`--${key}`);
  }
  if (Array.isArray(args._) && args._.length > 0) {
    unknown.push(...args._);
  }
  if (unknown.length > 0) {
    throw new Error(`diff only accepts --run-a and --run-b. Unknown: ${unknown.join(", ")}`);
  }
  emitJsonStdout(await summarizeRunDiff({ runA: args["run-a"], runB: args["run-b"] }));
}

async function tickCommand(argv) {
  const [subcommand, ...rest] = argv;
  if (!subcommand || subcommand === "--help" || subcommand === "-h" || subcommand === "help") {
    console.log(usage());
    return;
  }

  const validSubcommands = ["forward", "backward", "state"];
  if (!validSubcommands.includes(subcommand)) {
    throw new Error(`Unknown tick subcommand: ${subcommand}. Expected: forward, backward, state`);
  }

  const args = parseArgs(rest);
  const runId = args["run-id"];
  if (!runId) {
    throw new Error("tick requires --run-id <id>");
  }

  const vizMode = args["visualization"];
  if (vizMode !== undefined) {
    const check = validateVisualizationMode(vizMode);
    if (!check.ok) {
      emitJsonStdout({ ok: false, command: "tick", action: subcommand, runId, error: check.error });
      process.exit(1);
    }
  }

  const runDir = resolveTickRunDir(runId);
  if (!existsSync(runDir)) {
    throw new Error(`run directory not found: ${runDir}`);
  }

  const maxTick = await readMaxTick(runDir);
  if (maxTick === null) {
    throw new Error(`run directory not found or missing tick-frames.json for run: ${runId}`);
  }

  const stored = await readCursor(runDir);
  const currentTick = stored !== null ? stored.tick : 0;

  if (subcommand === "forward") {
    if (currentTick >= maxTick) {
      emitJsonStdout({
        ok: false,
        command: "tick",
        action: "forward",
        runId,
        tick: currentTick,
        maxTick,
        error: `cannot advance past max tick ${maxTick}`,
      });
      process.exit(1);
    }
    const newTick = currentTick + 1;
    await writeCursor(runDir, runId, newTick, maxTick);
    const result = {
      ok: true,
      command: "tick",
      action: "forward",
      runId,
      previousTick: currentTick,
      tick: newTick,
      maxTick,
    };
    if (vizMode) {
      result.visualization = await buildVisualizationSnapshot(runDir, runId, newTick, vizMode);
    }
    emitJsonStdout(result);
    return;
  }

  if (subcommand === "backward") {
    if (currentTick <= 0) {
      emitJsonStdout({
        ok: false,
        command: "tick",
        action: "backward",
        runId,
        tick: 0,
        maxTick,
        error: "cannot rewind past tick 0",
      });
      process.exit(1);
    }
    const newTick = currentTick - 1;
    await writeCursor(runDir, runId, newTick, maxTick);
    const result = {
      ok: true,
      command: "tick",
      action: "backward",
      runId,
      previousTick: currentTick,
      tick: newTick,
      maxTick,
    };
    if (vizMode) {
      result.visualization = await buildVisualizationSnapshot(runDir, runId, newTick, vizMode);
    }
    emitJsonStdout(result);
    return;
  }

  // subcommand === "state"
  const [ascii, tickFrame] = await Promise.all([renderAscii(runDir, currentTick), readTickFrame(runDir, currentTick)]);
  const stateResult = {
    ok: true,
    command: "tick",
    action: "state",
    runId,
    tick: currentTick,
    maxTick,
    ascii,
    tickFrame,
  };
  if (vizMode) {
    stateResult.visualization = await buildVisualizationSnapshot(runDir, runId, currentTick, vizMode);
  }
  emitJsonStdout(stateResult);
}

/**
 * `ak play`: the level a create/run produced, in the terminal UI. Which level
 * is the only thing decided here; the UI program does the rest.
 */
async function playCommand(argv) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return;
  }
  const allowed = new Set(["_", "dir", "from-run", "sim-config", "initial-state", "level", "keys", "json", "color", "no-color", "no-fog", "record", "replay", "watch", "tick", "realtime", "web", "port", "lan", "debug"]);
  const unknown = Object.keys(args).filter((key) => !allowed.has(key));
  if (unknown.length > 0) throw new Error(`play does not support: ${unknown.map((key) => `--${key}`).join(", ")}`);
  if (args.watch) {
    await watchRunCommand(args);
    return;
  }
  if (args.tick !== undefined) throw new Error("play --tick needs --watch.");
  const source = await resolvePlaySource(args);

  const color = args["no-color"] ? false : args.color ? true : undefined;
  const fog = !args["no-fog"];
  // parseArgs reads a bare `--keys ""` as a flag.
  const keys = args.keys === true ? "" : args.keys;
  // #204: record the played commands, or re-run a recorded game first.
  const capture = {
    recordPath: isNonEmptyString(args.record) ? resolvePath(args.record) : undefined,
    replayPath: isNonEmptyString(args.replay) ? resolvePath(args.replay) : undefined,
  };
  if ((args.record !== undefined && !capture.recordPath) || (args.replay !== undefined && !capture.replayPath)) {
    throw new Error("play --record and --replay each need a file path.");
  }
  // #291: real time is for a person at the keyboard, so only interactive play takes it.
  if (args.realtime !== undefined && (keys !== undefined || args.json)) {
    throw new Error("play --realtime is for interactive play; drop --keys/--json.");
  }
  if (args.web && (keys !== undefined || args.json)) throw new Error("play --web is for play in a browser; drop --keys/--json.");
  if ((args.port !== undefined || args.lan || args.debug) && !args.web) throw new Error("play --port, --lan and --debug need --web.");
  if (keys === undefined && !args.json) {
    process.exitCode = await playAsciiInteractive({ source, color, fog, realtime: args.realtime, web: Boolean(args.web), port: args.port, lan: Boolean(args.lan), debug: Boolean(args.debug), ...capture });
    return;
  }
  const result = playAsciiScripted({ source, keys: keys ?? "", color: color === true, fog, ...capture });
  if (!result.ok) throw new Error(result.error);
  if (args.json) {
    emitJsonStdout({ ...result, command: "play", source, launch: launchCommand(source) });
  } else {
    for (const warning of result.warnings || []) console.error(`warning: ${warning}`);
    console.log(result.screen);
  }
}

/** The level `play` and `play-session start` name: one of --dir, --from-run, --sim-config/--initial-state, --level. */
async function resolvePlaySource(args, command = "play") {
  const named = ["dir", "from-run", "level"].filter((key) => args[key] !== undefined);
  if (args["sim-config"] !== undefined || args["initial-state"] !== undefined) named.push("sim-config");
  if (named.length > 1) throw new Error(`${command} takes one level source: --dir, --from-run, --sim-config/--initial-state, or --level.`);
  if (isNonEmptyString(args.dir)) return { dir: resolvePath(args.dir) };
  if (args["from-run"] !== undefined) {
    const resolved = await resolveFromRunArtifactPaths(args["from-run"]);
    return { simConfigPath: resolved.simConfigPath, initialStatePath: resolved.initialStatePath };
  }
  if (args["sim-config"] !== undefined || args["initial-state"] !== undefined) {
    if (!isNonEmptyString(args["sim-config"]) || !isNonEmptyString(args["initial-state"])) {
      throw new Error(`${command} needs --sim-config and --initial-state together.`);
    }
    return { simConfigPath: resolvePath(args["sim-config"]), initialStatePath: resolvePath(args["initial-state"]) };
  }
  return isNonEmptyString(args.level) ? { level: args.level } : {};
}

export const PLAY_SESSIONS_DIR = "artifacts/play-sessions";
const PLAY_SESSION_ACTIONS = new Set(["start", "act", "view", "switch", "order", "advance", "end"]);

/**
 * `ak play-session`: a game that lasts across calls, for a caller that is not at a
 * terminal (the MCP tools). The game lives in artifacts/play-sessions/<name>.json as a
 * player capture, so it survives a restart and replays exactly; each call re-runs it,
 * applies this call's seat change, commands and keys, and saves it again. The UI
 * program does the playing; this only names the file and the level.
 *   start   a new game on a level          act     commands and/or keys
 *   view    the board, nothing played      switch  seat another party member (free)
 *   order   give --actor a new --strategy (a turn)
 *   advance let the world run --ticks n, or --until orders_done|contact
 *   end     the final board; removes the file
 * `--save <path>` copies the game out after any call; `start --load <path>` begins from such a copy.
 * It also writes artifacts/play-sessions/hud.txt, one line about the seated actor,
 * for a status line to show. AK_PLAY_SESSIONS_DIR moves both.
 */
async function playSessionCommand(argv) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return;
  }
  const action = args._[0];
  if (!PLAY_SESSION_ACTIONS.has(action)) {
    throw new Error(`play-session needs an action: ${[...PLAY_SESSION_ACTIONS].join(", ")}.`);
  }
  const allowed = new Set(["_", "session", "dir", "from-run", "sim-config", "initial-state", "level", "keys", "commands", "actor", "json", "color", "no-fog", "save", "load", "strategy", "ticks", "until"]);
  const unknown = Object.keys(args).filter((key) => !allowed.has(key));
  if (unknown.length > 0) throw new Error(`play-session does not support: ${unknown.map((key) => `--${key}`).join(", ")}`);
  const name = args.session === undefined ? "game" : String(args.session);
  if (!/^[\w.-]+$/.test(name) || name.startsWith(".")) {
    throw new Error(`play-session --session must be a plain name (letters, digits, - _ .), got ${name}`);
  }
  // AK_PLAY_SESSIONS_DIR moves the saves (tests keep theirs apart with it).
  const sessionsDir = resolvePath(process.env.AK_PLAY_SESSIONS_DIR || PLAY_SESSIONS_DIR);
  const sessionPath = join(sessionsDir, `${name}.json`);
  const exists = existsSync(sessionPath);
  const levelNamed = ["dir", "from-run", "sim-config", "initial-state", "level"].some((key) => args[key] !== undefined);
  if (action === "start" && exists) throw new Error(`play-session "${name}" is already running; act on it, or end it first.`);
  if (action !== "start" && !exists) throw new Error(`No play-session "${name}"; start one with play-session start.`);
  if (action !== "start" && levelNamed) throw new Error(`play-session ${action} continues "${name}" on its own level; level options go with start.`);
  if ((action === "view" || action === "end") && (args.keys !== undefined || args.commands !== undefined || args.actor !== undefined)) {
    throw new Error(`play-session ${action} plays nothing; use act (or switch) for keys, commands and --actor.`);
  }
  if (action === "switch" && args.actor === undefined) throw new Error("play-session switch needs --actor <id or label>.");
  if (action === "order" && (args.actor === undefined || args.strategy === undefined)) {
    throw new Error("play-session order needs --actor <id or label> and --strategy <goals, JSON or a .json file>.");
  }
  if (args.strategy !== undefined && action !== "order") throw new Error("play-session --strategy goes with order.");
  if ((args.ticks !== undefined || args.until !== undefined) && action !== "advance") {
    throw new Error("play-session --ticks and --until go with advance.");
  }
  if (args.load !== undefined && (action !== "start" || levelNamed)) {
    throw new Error("play-session --load goes with start, in place of a level: the saved game names its own level.");
  }
  if (args.save !== undefined && !isNonEmptyString(args.save)) throw new Error("play-session --save needs a file path.");

  let commands;
  if (args.commands !== undefined) {
    try {
      commands = JSON.parse(String(args.commands));
    } catch {
      throw new Error("play-session --commands needs a JSON array.");
    }
    if (!Array.isArray(commands)) throw new Error("play-session --commands needs a JSON array.");
  }
  let actor = Array.isArray(args.actor) ? args.actor.at(-1) : args.actor;
  const keys = args.keys === true ? "" : args.keys;
  // An order and an advance are structured commands the game plays; the order's --actor
  // names who takes it, not a seat change.
  if (action === "order") {
    commands = [{ kind: "order", actorId: String(actor), strategy: parseActorStrategy(String(args.strategy), "order", 1) }];
    actor = undefined;
  }
  if (action === "advance") {
    const ticks = args.ticks === undefined ? (args.until === undefined ? 1 : 50) : parsePositiveIntStrict(args.ticks, "play-session --ticks");
    commands = [...(commands ?? []), { kind: "advance", ticks, ...(args.until === undefined ? {} : { until: String(args.until) }) }];
  }
  const source = action === "start" && args.load === undefined ? await resolvePlaySource(args, "play-session start") : {};
  await mkdir(sessionsDir, { recursive: true });
  if (args.load !== undefined) {
    // A saved game: a session save, or any player capture that names its level.
    const loadPath = resolvePath(String(args.load));
    const saved = JSON.parse(readFileSync(loadPath, "utf8"));
    const request = saved?.source?.request;
    if (!request?.source && !request?.level) {
      throw new Error(`${args.load} does not say which level it was played on; start on that level and play it again.`);
    }
    copyFileSync(loadPath, sessionPath);
  }
  const result = playSessionScripted({
    sessionPath, source, keys: keys ?? "", commands, actor, color: args.color === true, fog: !args["no-fog"],
  });
  if (!result.ok) throw new Error(result.error);
  if (result.hud) await writeFile(join(sessionsDir, "hud.txt"), `${result.hud}\n`);
  let saved;
  if (args.save !== undefined) {
    saved = resolvePath(String(args.save));
    await mkdir(dirname(saved), { recursive: true });
    copyFileSync(sessionPath, saved);
  }
  if (action === "end") {
    rmSync(sessionPath, { force: true });
    rmSync(join(sessionsDir, "hud.txt"), { force: true });
  }
  const payload = { ...result, command: "play-session", action, name, ...(saved ? { saved } : {}), ...(action === "end" ? { ended: true } : {}) };
  emitJsonStdout(payload);
}

/**
 * `ak play --watch`: a recorded run in the terminal UI, tick by tick. The run is
 * an `ak run` output directory (`--dir`) or a run id under artifacts/runs (`--from-run`).
 */
async function watchRunCommand(args) {
  const extra = ["sim-config", "initial-state", "level", "no-fog", "record", "replay"].filter((key) => args[key] !== undefined);
  if (extra.length > 0) {
    throw new Error(`play --watch shows a recorded run as it happened; it does not take ${extra.map((key) => `--${key}`).join(", ")}.`);
  }
  if (isNonEmptyString(args.dir) === (args["from-run"] !== undefined)) {
    throw new Error("play --watch takes one run: --dir <ak run output directory> or --from-run <runId>.");
  }
  const runDir = isNonEmptyString(args.dir) ? resolvePath(args.dir) : resolveTickRunDir(String(args["from-run"]));
  let tick;
  if (args.tick !== undefined) {
    if (!/^\d+$/.test(String(args.tick))) throw new Error(`play --tick needs a whole number, got ${args.tick}`);
    tick = Number(args.tick);
  }
  const color = args["no-color"] ? false : args.color ? true : undefined;
  const keys = args.keys === true ? "" : args.keys;
  if (keys === undefined && !args.json) {
    process.exitCode = await watchAsciiInteractive({ runDir, tick, color });
    return;
  }
  const result = watchAsciiScripted({ runDir, tick, keys: keys ?? "", color: color === true });
  if (!result.ok) throw new Error(result.error);
  if (args.json) {
    emitJsonStdout({ ...result, command: "play", watch: true, runDir, launch: launchCommand({ dir: runDir }, { watch: true, tick: result.tick }) });
  } else {
    console.log(result.screen);
  }
}

async function runsCommand(argv) {
  const [subcommand, ...rest] = argv;
  if (!subcommand || subcommand === "--help" || subcommand === "-h" || subcommand === "help") {
    console.log(usage());
    return;
  }
  if (subcommand !== "list") {
    throw new Error(`Unknown runs subcommand: ${subcommand}`);
  }
  if (rest.length > 0) {
    const args = parseArgs(rest);
    if (!args.help && args._.length > 0) {
      throw new Error("runs list does not accept positional arguments.");
    }
    if (Object.keys(args).some((key) => key !== "_" && key !== "help")) {
      throw new Error("runs list does not accept options.");
    }
  }
  const rootDir = resolve(process.cwd(), DEFAULT_ARTIFACTS_DIR, DEFAULT_RUNS_DIR);
  emitJsonStdout(await summarizeRunsIndex({ rootDir }));
}

async function sandboxCreateCommand(argv) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return;
  }

  const width = args.width !== undefined ? Number(args.width) : 10;
  const height = args.height !== undefined ? Number(args.height) : 10;
  if (!Number.isInteger(width) || width <= 0) {
    throw new Error("sandbox-create: --width must be a positive integer.");
  }
  if (!Number.isInteger(height) || height <= 0) {
    throw new Error("sandbox-create: --height must be a positive integer.");
  }

  // #277: one sandbox-create for the CLI and MCP, so the Allocator judges and issues every receipt.
  const result = await executeSandboxCreate({
    budgetReceipt: resolvePath(args["budget-receipt"]),
    budget: resolvePath(args.budget),
    width,
    height,
    entityCategories: isNonEmptyString(args["entity-categories"]) ? args["entity-categories"].split(",") : undefined,
    runId: args["run-id"],
    createdAt: args["created-at"],
    outDir: resolvePath(args["out-dir"]) || undefined,
  });
  emitJsonStdout(result);
}

async function sandboxPlaceCommand(argv) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return;
  }

  const sessionPath = resolvePath(args.session);
  const entityType = args["entity-type"];
  const spec = args.spec;

  if (!sessionPath) {
    throw new Error("sandbox-place requires --session <path>");
  }
  if (!isNonEmptyString(entityType)) {
    throw new Error("sandbox-place requires --entity-type <type>");
  }
  if (!isNonEmptyString(spec)) {
    throw new Error("sandbox-place requires --spec <spec-string>");
  }

  const result = await executeSandboxPlace({ session: sessionPath, entityType, spec });
  emitJsonStdout(result);
  if (!result.ok) {
    process.exit(1);
  }
}

async function sandboxMoveCommand(argv) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return;
  }

  const sessionPath = resolvePath(args.session);
  const actorId = args["actor-id"];
  const direction = args.direction;
  const actionsOut = resolvePath(args["actions-out"]);

  if (!sessionPath) {
    throw new Error("sandbox-move requires --session <path>");
  }
  if (!isNonEmptyString(actorId)) {
    throw new Error("sandbox-move requires --actor-id <id>");
  }
  if (!isNonEmptyString(direction)) {
    throw new Error(
      "sandbox-move requires --direction <north|northeast|east|southeast|south|southwest|west|northwest>",
    );
  }
  if (!actionsOut) {
    throw new Error("sandbox-move requires --actions-out <path>");
  }

  const result = await executeSandboxMove({
    session: sessionPath,
    actorId,
    direction,
    actionsOut,
  });
  emitJsonStdout(result);
  if (!result.ok) {
    process.exit(1);
  }
}

const WORKFLOW_ACTIONS = new Set(["run", "status", "replay", "cancel", "validate"]);
const WORKFLOW_FLAGS = new Set(["input", "objective", "out-dir", "policy", "runtime-profile", "dry-run", "replay", "cancel", "run-id", "created-at", "base-url", "model", "reason", "max-model-attempts", "push-ui", "require-client", "help"]);

async function workflowCommand(argv) {
  let [action, ...flags] = argv;
  if (!action || action === "--help" || action === "-h") { console.log(usage()); return; }
  assertUniqueWorkflowFlags(flags);
  const args = parseArgs(flags);
  if (args.help) { console.log(usage()); return; }
  assertWorkflowArgs(args);
  if (args.replay && args.cancel) throw new Error("workflow replay and cancel flags cannot be combined");
  if (action !== "run" && (args.replay || args.cancel)) throw new Error(`workflow ${action} cannot use replay or cancel compatibility flags`);
  if (["status", "replay", "cancel"].includes(action) && ["input", "objective", "policy", "runtime-profile", "dry-run", "model", "max-model-attempts"].some((key) => args[key] !== undefined)) throw new Error(`workflow ${action} received run-only arguments`);
  if (action === "run" && (args.replay || args.cancel) && ["input", "objective", "policy", "runtime-profile", "dry-run", "model", "max-model-attempts"].some((key) => args[key] !== undefined)) throw new Error("workflow compatibility action received run-only arguments");
  if (action === "run" && args.replay && (args["out-dir"] || args.reason)) throw new Error("workflow run --replay received conflicting arguments");
  if (action === "run" && args.cancel && args["run-id"]) throw new Error("workflow run --cancel cannot also use --run-id");
  if (action === "run" && args.replay) { action = "replay"; args["out-dir"] = args.replay; }
  if (action === "run" && args.cancel) { action = "cancel"; args["run-id"] = args.cancel; }
  if (!WORKFLOW_ACTIONS.has(action)) throw new Error(`Unknown workflow action: ${action}`);
  if (action === "validate" || (action === "run" && args["dry-run"])) {
    const input = await resolveWorkflowInput(args);
    emitJsonStdout({ ok: true, command: "workflow", action: action === "validate" ? "validate" : "run", valid: true, dryRun: Boolean(args["dry-run"]), runId: input.runId, outDir: resolvePath(args["out-dir"]) });
    return;
  }
  const outDir = resolvePath(args["out-dir"]);
  if (!outDir) throw new Error(`workflow ${action} requires --out-dir <dir>`);
  if (action === "status") return workflowStatus({ args, outDir });
  if (action === "cancel") return workflowCancel({ args, outDir });
  if (action === "replay") return workflowReplay({ args, outDir });
  return workflowRun({ args, outDir });
}

async function resolveWorkflowInput(args) {
  if (args.input && args.objective) throw new Error("workflow accepts either --objective or --input, not both");
  const input = args.input ? await readJson(resolvePath(args.input)) : {};
  if (args.input && (input.schema !== ADAPTIVE_WORKFLOW_CLI_RUN_INPUT_SCHEMA || input.schemaVersion !== 1)) throw new Error("Invalid AdaptiveWorkflowCliRunInput");
  validateWorkflowInputFields(input, args);
  const objective = args.objective || input.objective;
  if (!isNonEmptyString(objective)) throw new Error("workflow requires --objective <text> or --input <path>");
  const runId = args["run-id"] || input.runId || makeId("workflow");
  const createdAt = args["created-at"] || input.createdAt || new Date().toISOString();
  const clock = () => createdAt;
  const runtimeProfile = await createRuntimeProfileAdapter({ clock }).snapshot({ path: resolvePath(args["runtime-profile"]), runId });
  const rawPolicy = args.policy ? await readJson(resolvePath(args.policy)) : undefined;
  if (rawPolicy && (rawPolicy.schema !== ADAPTIVE_WORKFLOW_STRATEGY_POLICY_SCHEMA || rawPolicy.schemaVersion !== 1)) throw new Error("Invalid AdaptiveWorkflowStrategyPolicy");
  assertNoSensitiveFields(rawPolicy, "workflow policy");
  const policy = rawPolicy ? createStrategyPolicyV1(rawPolicy) : undefined;
  const model = args.model || input.model || DEFAULT_LLM_MODEL;
  if (!isNonEmptyString(model)) throw new Error("workflow model must be a non-empty string");
  assertNoSensitiveFields(input.declaredCapability, "workflow declared capability");
  const declaredCapability = createDeclaredModelCapabilityV1(input.declaredCapability || { schemaVersion: 1, providerId: "ollama", modelId: model, source: "declared", contextWindowTokens: 128000, maxOutputTokens: 4096, supports: { textGeneration: true, structuredOutput: true, streaming: false } });
  return { input, objective, runId, createdAt, clock, runtimeProfile, policy, model, declaredCapability };
}

function workflowValidator(requiredKeys = []) {
  return { id: "cli-workflow-contract", version: 1, validate(value) {
    const missing = !value || typeof value !== "object" || Array.isArray(value) ? ["/"] : requiredKeys.filter((key) => !Object.prototype.hasOwnProperty.call(value, key)).map((key) => `/${key}`);
    return missing.length ? { ok: false, issues: missing.map((path) => ({ path, code: "workflow_output_invalid", message: "Required workflow output is missing" })) } : { ok: true };
  } };
}

function workflowExecution({ operationId, counter, pushUi = false, store, requireClient = false } = {}) {
  if (pushUi) {
    const gameplay = createGameplayBridgeOperation({
      // CR.7 / WP-5 — one Director round PER BRIDGE REQUEST, opened from the args the
      // bridge already supplies (`{ summary, runId, createdAt, source }`). A round per
      // request rather than one hoisted here: each request assembles its own BuildSpec, and
      // `assembleBuildSpec` closes the round it runs in.
      assembleSpec: (args) => beginDirectorRound({
        runId: args.runId,
        createdAt: args.createdAt,
        goal: args.summary?.goal,
        producedBy: args.source || "cli-workflow",
      }).assembleBuildSpec({ roomGeometry: configuratorRoomGeometry, ...args }),
      compile: compileBuildSpecToGameplayBundle,
      requireClient,
      onBundle: store ? async (bundle) => { await store.writeArtifact("bundle.json", bundle); } : undefined,
    });
    return createControlledExecutionAdapter({ operationId: "gameplay_bridge", operations: { gameplay_bridge: async (request) => { counter.count += 1; return gameplay(request); } } });
  }
  if (!operationId) return undefined;
  return createControlledExecutionAdapter({ operationId, operations: { record: ({ runId, selectedStrategy }) => {
    counter.count += 1;
    return { schema: ADAPTIVE_WORKFLOW_EXECUTION_RECEIPT_SCHEMA, schemaVersion: 1, runId, operation: "record", strategyId: selectedStrategy.strategyId };
  } } });
}

async function workflowRun({ args, outDir }) {
  const resolved = await resolveWorkflowInput(args);
  await assertWorkflowOutDirAvailable(outDir);
  const store = await createFilesystemWorkflowStore({ root: outDir });
  const counter = { count: 0 }; const operationId = resolved.input.executionOperation;
  const idempotencyKey = resolved.input.idempotencyKey || `${resolved.runId}:execution:${operationId || "none"}`;
  const attemptInput = args["max-model-attempts"] ?? resolved.input.maxModelAttempts;
  const maxModelAttempts = attemptInput === undefined ? 2 : parsePositiveIntStrict(String(attemptInput), "workflow --max-model-attempts");
  const request = { schema: ADAPTIVE_WORKFLOW_CLI_REQUEST_SCHEMA, schemaVersion: 1, runId: resolved.runId, createdAt: resolved.createdAt, objective: resolved.objective, model: resolved.model, declaredCapability: resolved.declaredCapability, requiredKeys: resolved.input.requiredKeys || [], idempotencyKey, ...(resolved.policy ? { policy: resolved.policy } : {}), ...(operationId ? { executionOperation: operationId } : {}) };
  await store.writeArtifact("runtime-profile.json", resolved.runtimeProfile);
  await store.writeArtifact("request.json", request);
  const result = await runAdaptiveWorkflow({
    objective: resolved.objective, runId: resolved.runId, declaredCapability: resolved.declaredCapability, runtimeProfile: resolved.runtimeProfile, policy: resolved.policy, model: resolved.model,
    maxModelAttempts, idempotencyKey,
    ports: { model: createLlmAdapter({ baseUrl: args["base-url"], fixture: resolved.input.modelResponse }), validator: [workflowValidator(resolved.input.requiredKeys)], persistence: store, execution: workflowExecution({ operationId, counter, pushUi: args["push-ui"] === true || args["push-ui"] === "true", store, requireClient: args["require-client"] === true || args["require-client"] === "true" }), clock: resolved.clock, runtimeProfile: resolved.runtimeProfile },
    cancelRequested: () => existsSync(join(outDir, "cancel-request.json")),
  });
  await writeWorkflowArtifacts(store, result, resolved.runtimeProfile, request);
  emitJsonStdout({ ok: result.outcome === "complete", command: "workflow", action: "run", runId: resolved.runId, outDir, outcome: result.outcome, phase: result.state.phase, executionCalls: counter.count });
  if (result.outcome !== "complete") process.exitCode = 1;
}

async function workflowStatus({ args, outDir }) {
  const store = await createFilesystemWorkflowStore({ root: outDir, create: false }); const state = await loadWorkflowState(store, args["run-id"]);
  emitJsonStdout({ ok: true, command: "workflow", action: "status", runId: state.runId, phase: state.phase, updatedAt: state.updatedAt, cancellation: state.cancellation });
}

async function workflowCancel({ args, outDir }) {
  const store = await createFilesystemWorkflowStore({ root: outDir, create: false }); const state = await loadWorkflowState(store, args["run-id"]);
  const terminal = ["complete", "failed", "cancelled"].includes(state.phase);
  if (!terminal) await store.writeArtifact("cancel-request.json", { runId: state.runId, requestedAt: new Date().toISOString(), reason: args.reason || "cancelled by CLI" });
  emitJsonStdout({ ok: true, command: "workflow", action: "cancel", runId: state.runId, requested: !terminal, terminal, phase: state.phase });
}

async function workflowReplay({ args, outDir }) {
  const store = await createFilesystemWorkflowStore({ root: outDir, create: false }); const source = await loadWorkflowState(store, args["run-id"]);
  const request = await store.readArtifact("request.json"); const runtimeProfile = await store.readArtifact("runtime-profile.json");
  if (request.runId !== source.runId || runtimeProfile.meta?.runId !== source.runId) throw new Error("workflow replay run-id does not match its durable output directory");
  const counter = { count: 0 }; const envelope = createReplayEnvelope({ state: source });
  const replayPersistence = Object.freeze({ ...store, save: async (_runId, state) => JSON.parse(JSON.stringify(state)), putContent: (value) => store.referenceContent(value) });
  const result = await runAdaptiveWorkflow({ objective: request.objective, runId: source.runId, declaredCapability: request.declaredCapability, runtimeProfile, policy: request.policy, model: request.model, idempotencyKey: request.idempotencyKey,
    ports: { model: createReplayModelAdapter({ store, envelope }), validator: [workflowValidator(request.requiredKeys)], persistence: replayPersistence, clock: () => request.createdAt, runtimeProfile } });
  await store.writeArtifact("replay-state.json", result.state); await store.writeArtifact("replay-validation.json", result.validation); await store.writeArtifact("replay-events.json", result.events);
  emitJsonStdout({ ok: result.outcome === "complete", command: "workflow", action: "replay", runId: source.runId, outDir, outcome: result.outcome, phase: result.state.phase, liveModelCalls: 0, liveExecutionCalls: counter.count });
  if (result.outcome !== "complete") process.exitCode = 1;
}

async function writeWorkflowArtifacts(store, result, runtimeProfile, request) {
  await store.writeArtifact("runtime-profile.json", runtimeProfile);
  await store.writeArtifact("selected-strategy.json", result.selectedStrategy);
  await store.writeArtifact("validation.json", result.validation);
  await store.writeArtifact("events.json", result.events);
  if (request) await store.writeArtifact("request.json", request);
}

function assertWorkflowArgs(args) {
  const unknown = Object.keys(args).filter((key) => key !== "_" && !WORKFLOW_FLAGS.has(key));
  if (unknown.length || args._.length) throw new Error(`Unknown workflow arguments: ${[...unknown.map((key) => `--${key}`), ...args._].join(", ")}`);
}

function assertUniqueWorkflowFlags(flags) { const seen = new Set(); for (const flag of flags) { if (!flag.startsWith("--")) continue; const key = flag.slice(2).split("=", 1)[0]; if (seen.has(key)) throw new Error(`Duplicate workflow argument: --${key}`); seen.add(key); } }
function assertNoSensitiveFields(value, label) { if (!value || typeof value !== "object") return; for (const [key, nested] of Object.entries(value)) { if (/^(api[-_]?key|secret([-_]?key)?|password|passwd|passphrase|credentials?|authorization|auth([-_]?token)?|(access|refresh|bearer|id|session)[-_]?token|token|client[-_]?secret|private[-_]?key|access[-_]?key)$/i.test(key)) throw new Error(`${label} contains credential fields`); assertNoSensitiveFields(nested, label); } }
function validateWorkflowInputFields(input, args) {
  if (input.requiredKeys !== undefined && (!Array.isArray(input.requiredKeys) || !input.requiredKeys.every(isNonEmptyString))) throw new Error("workflow requiredKeys must be an array of strings");
  if (input.executionOperation !== undefined && input.executionOperation !== "record") throw new Error("workflow executionOperation is not allowed");
  if (input.modelResponse !== undefined && (!input.modelResponse || typeof input.modelResponse !== "object" || !isNonEmptyString(input.modelResponse.response))) throw new Error("workflow modelResponse fixture is invalid");
  const attempts = args["max-model-attempts"] ?? input.maxModelAttempts; if (attempts !== undefined) parsePositiveIntStrict(String(attempts), "workflow --max-model-attempts");
}
async function assertWorkflowOutDirAvailable(outDir) { try { if ((await readdir(outDir)).length) throw new Error("workflow output directory must be empty"); } catch (error) { if (error?.code !== "ENOENT") throw error; } }
async function loadWorkflowState(store, runId) { const found = await store.load(runId); if (!found) throw new Error("workflow durable state not found or run-id mismatch"); return found; }

export const COMMANDS = {
  build: buildCommand,
  schemas: schemasCommand,
  solve: solveCommand,
  run: runCommand,
  create: createCommand,
  configure: configureAuthoringCommand,
  configurator: configuratorCommand,
  budget: budgetCommand,
  replay: replayCommand,
  inspect: inspectCommand,
  narrate: narrateCommand,
  ipfs: ipfsCommand,
  "ipfs-publish": ipfsPublishCommand,
  "ipfs-load": ipfsLoadCommand,
  blockchain: blockchainCommand,
  "blockchain-mint": blockchainMintCommand,
  "blockchain-load": blockchainLoadCommand,
  llm: llmCommand,
  ollama: llmCommand,
  "room-plan": roomPlanCommand,
  "hazard-plan": hazardPlanCommand,
  "resource-plan": resourcePlanCommand,
  "delver-plan": delverPlanCommand,
  "warden-plan": wardenPlanCommand,
  "llm-plan": llmPlanCommand,
  scenario: scenarioCommand,
  show: showCommand,
  diff: diffCommand,
  runs: runsCommand,
  tick: tickCommand,
  "sandbox-create": sandboxCreateCommand,
  "sandbox-place": sandboxPlaceCommand,
  "sandbox-move": sandboxMoveCommand,
  workflow: workflowCommand,
  play: playCommand,
  "play-session": playSessionCommand,
};

/**
 * Compile a BuildSpec into a gameplay bundle suitable for the browser UI.
 *
 * Returns { spec, artifacts } where artifacts is the canonical artifact array
 * produced by buildBuildArtifacts (SimConfigArtifact, InitialStateArtifact,
 * ResourceBundleArtifact, AffinitySummary, etc.).
 *
 * @param {object} buildSpec  BuildSpec object (agent-kernel/BuildSpec)
 * @returns {Promise<{ spec: object, artifacts: object[] }>}
 */
export async function compileBuildSpecToGameplayBundle(buildSpec) {
  if (!buildSpec || typeof buildSpec !== "object") {
    throw new Error("compileBuildSpecToGameplayBundle requires a BuildSpec object.");
  }
  const buildResult = await orchestrateBuild({
    spec: buildSpec,
    producedBy: "sandbox-bridge",
    placeObjects: await commandKernel.hostObjectPlacement(buildSpec.meta?.createdAt),
  });
  const artifacts = buildBuildArtifacts(buildResult, { includeAffinitySummary: true });
  return { spec: buildSpec, artifacts };
}

export async function executeCommand(command, rest = []) {
  const handler = COMMANDS[command];
  if (!handler) {
    throw new Error(`Unknown command: ${command}`);
  }
  await handler(rest);
}

export async function main(argv = process.argv.slice(2)) {
  const [command, ...rest] = argv;
  if (!command || command === "help" || command === "--help" || command === "-h") {
    console.log(usage());
    return;
  }
  if (!COMMANDS[command]) {
    console.error(`Unknown command: ${command}`);
    console.log(usage());
    process.exit(1);
  }
  try {
    await executeCommand(command, rest);
  } catch (error) {
    const message = error?.message || String(error);
    if (STRUCTURED_STDOUT_COMMANDS.has(command)) {
      console.error(message);
      emitJsonStdout({
        ok: false,
        command,
        error: message,
      });
    } else {
      console.error(message);
    }
    process.exit(1);
  }
}

const isDirectExecution = (() => {
  const scriptPath = process.argv[1];
  if (!scriptPath) {
    return false;
  }
  return resolve(scriptPath) === fileURLToPath(import.meta.url);
})();

if (isDirectExecution) {
  await main();
}
