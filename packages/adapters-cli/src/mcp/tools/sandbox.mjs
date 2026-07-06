/**
 * Sandbox MCP tools — M2 + M3
 *
 * ak_sandbox_create: Create a SandboxSessionArtifact with budget enforcement.
 *   Produces a session envelope that indexes the BudgetReceiptArtifact and
 *   establishes room configuration. Foundation for Phaser rendering.
 *
 * ak_sandbox_place: Place and configure an entity in an existing sandbox session.
 *   Builds or updates SimConfig, InitialState, and ResourceBundle artifacts.
 *   Reuses the existing session's room dimensions for bounds checking.
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import {
  validateSandboxSession,
  SANDBOX_SESSION_SCHEMA,
} from "../../../../runtime/src/contracts/sandbox-session.mjs";
import { createDefaultResourceBundleArtifact } from "../../../../runtime/src/render/resource-bundle.js";
import {
  booleanSchema,
  createHandlerTool,
  integerSchema,
  pathSchema,
  stringArraySchema,
  stringSchema,
  withCommonOutput,
} from "./shared.mjs";
import { getSandboxBridgeState, pushGameplayBundle } from "../bridge-server.mjs";

// ---------------------------------------------------------------------------
// Local I/O helpers (self-contained — no dependency on ak-impl.mjs)
// ---------------------------------------------------------------------------

async function readJson(filePath) {
  const text = await readFile(filePath, "utf8");
  return JSON.parse(text);
}

async function writeJson(filePath, value) {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function makeId(prefix) {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now().toString(36)}_${rand}`;
}

function toRef(artifact) {
  return {
    id: artifact.meta?.id || makeId("artifact"),
    schema: artifact.schema,
    schemaVersion: artifact.schemaVersion,
  };
}

// ---------------------------------------------------------------------------
// Core sandbox-create logic (shared by both MCP handler and CLI command)
// ---------------------------------------------------------------------------

/**
 * Create a SandboxSessionArtifact with budget enforcement.
 *
 * @param {object} options
 * @param {string} [options.budgetReceipt]    Absolute path to BudgetReceiptArtifact JSON.
 * @param {string} [options.budget]           Absolute path to BudgetArtifact JSON (alternative).
 * @param {number} [options.width]            Default room width in tiles (default: 10).
 * @param {number} [options.height]           Default room height in tiles (default: 10).
 * @param {string[]} [options.entityCategories] Entity categories to enable.
 * @param {string} [options.runId]            Run ID override.
 * @param {string} [options.createdAt]        ISO timestamp override.
 * @param {string} [options.outDir]           Output directory override.
 * @returns {Promise<object>} Structured result with ok, sandboxId, runId, outDir, rooms, artifacts.
 */
export async function executeSandboxCreate({
  budgetReceipt,
  budget,
  width,
  height,
  entityCategories,
  runId: runIdInput,
  createdAt: createdAtInput,
  outDir: outDirInput,
} = {}) {
  // Budget inputs are required — one of receipt or budget artifact must be present
  if (!isNonEmptyString(budgetReceipt) && !isNonEmptyString(budget)) {
    return {
      ok: false,
      command: "sandbox-create",
      error: "sandbox-create requires budgetReceipt or budget.",
      budgetRequired: true,
    };
  }

  const runId = isNonEmptyString(runIdInput) ? runIdInput.trim() : makeId("sandbox_run");
  const createdAt = isNonEmptyString(createdAtInput)
    ? createdAtInput.trim()
    : new Date().toISOString();

  let budgetReceiptRef;

  if (isNonEmptyString(budgetReceipt)) {
    let receipt;
    try {
      receipt = await readJson(budgetReceipt);
    } catch (err) {
      return {
        ok: false,
        command: "sandbox-create",
        error: `Cannot read budget receipt: ${err.message}`,
      };
    }
    if (receipt.schema !== "agent-kernel/BudgetReceiptArtifact") {
      return {
        ok: false,
        command: "sandbox-create",
        error: `Expected agent-kernel/BudgetReceiptArtifact, got ${receipt.schema || "unknown"}`,
      };
    }
    // Full BudgetReceiptArtifact validation — reject malformed receipts that
    // could bypass the budget trust boundary.
    if (receipt.schemaVersion !== 1) {
      return {
        ok: false,
        command: "sandbox-create",
        error: `Budget receipt schemaVersion must be 1, got ${receipt.schemaVersion}`,
      };
    }
    if (!isNonEmptyString(receipt.meta?.id)) {
      return {
        ok: false,
        command: "sandbox-create",
        error: "Budget receipt is missing meta.id",
      };
    }
    // Only "approved" status is accepted — missing, unknown, or denied status is rejected.
    const ALLOWED_RECEIPT_STATUSES = new Set(["approved"]);
    if (!ALLOWED_RECEIPT_STATUSES.has(receipt.status)) {
      return {
        ok: false,
        command: "sandbox-create",
        error: `Budget receipt status must be "approved", got ${JSON.stringify(receipt.status)}`,
        budgetInsufficient: true,
      };
    }
    if (!(Number.isFinite(receipt.remaining) && receipt.remaining >= 0)) {
      return {
        ok: false,
        command: "sandbox-create",
        error: `Budget receipt remaining must be a non-negative finite number, got ${receipt.remaining}`,
        budgetInsufficient: true,
      };
    }
    if (!Array.isArray(receipt.lineItems)) {
      return {
        ok: false,
        command: "sandbox-create",
        error: "Budget receipt is missing lineItems array",
      };
    }
    budgetReceiptRef = toRef(receipt);
  } else {
    let budgetArtifact;
    try {
      budgetArtifact = await readJson(budget);
    } catch (err) {
      return {
        ok: false,
        command: "sandbox-create",
        error: `Cannot read budget artifact: ${err.message}`,
      };
    }
    if (budgetArtifact.schema !== "agent-kernel/BudgetArtifact") {
      return {
        ok: false,
        command: "sandbox-create",
        error: `Expected agent-kernel/BudgetArtifact, got ${budgetArtifact.schema || "unknown"}`,
      };
    }
    const tokens = budgetArtifact.budget?.tokens;
    if (!Number.isInteger(tokens) || tokens <= 0) {
      return {
        ok: false,
        command: "sandbox-create",
        error: `Budget insufficient: tokens=${tokens}`,
        budgetInsufficient: true,
      };
    }
    // Synthesize a placeholder budget receipt ref from the budget artifact
    budgetReceiptRef = {
      id: `budget_receipt_${runId}`,
      schema: "agent-kernel/BudgetReceiptArtifact",
      schemaVersion: 1,
    };
  }

  // Room dimensions (default 10×10)
  const roomWidth = Number.isInteger(Number(width)) && Number(width) > 0 ? Number(width) : 10;
  const roomHeight = Number.isInteger(Number(height)) && Number(height) > 0 ? Number(height) : 10;

  // Entity categories (optional)
  const cats = Array.isArray(entityCategories)
    ? entityCategories.map((c) => String(c).trim()).filter(Boolean)
    : [];

  const sandboxId = `sandbox_session_${runId}`;
  const outDir = isNonEmptyString(outDirInput)
    ? outDirInput
    : resolve(process.cwd(), "artifacts", "sandbox", runId);

  const session = {
    schema: SANDBOX_SESSION_SCHEMA,
    schemaVersion: 1,
    meta: {
      id: sandboxId,
      runId,
      createdAt,
      producedBy: "sandbox-create",
    },
    rooms: [{ id: "room_default", width: roomWidth, height: roomHeight }],
    artifacts: { budgetReceiptRef },
    ...(cats.length > 0 ? { entityCategories: cats } : {}),
  };

  // Validate before writing
  const validation = validateSandboxSession(session);
  if (!validation.ok) {
    return {
      ok: false,
      command: "sandbox-create",
      error: `Session validation failed: ${validation.errors.join("; ")}`,
    };
  }

  await mkdir(outDir, { recursive: true });
  await writeJson(join(outDir, "sandbox-session.json"), session);

  return {
    ok: true,
    command: "sandbox-create",
    sandboxId,
    runId,
    outDir,
    rooms: session.rooms,
    artifacts: session.artifacts,
    ...(cats.length > 0 ? { entityCategories: cats } : {}),
  };
}

// ---------------------------------------------------------------------------
// Entity placement helpers (M3)
// ---------------------------------------------------------------------------

const AMBULATORY_ENTITY_TYPES = new Set(["delver", "warden"]);
const ALLOWED_ENTITY_TYPES = new Set(["delver", "warden", "hazard", "trap", "resource"]);

/**
 * Parse a semicolon-delimited spec string into a key-value object.
 * e.g. "id=hazard_fire;x=4;y=4;affinity=fire" → { id: "hazard_fire", x: "4", y: "4", affinity: "fire" }
 */
function parseEntitySpec(specString) {
  const spec = {};
  for (const part of String(specString).split(";")) {
    const eqIdx = part.indexOf("=");
    if (eqIdx === -1) continue;
    const key = part.slice(0, eqIdx).trim();
    const val = part.slice(eqIdx + 1).trim();
    if (key) spec[key] = val;
  }
  return spec;
}

/**
 * Build a minimal SimConfigArtifact for a sandbox room.
 * Grid layout: walls on the border, floor tiles inside.
 */
function buildMinimalSimConfig({ runId, createdAt, width, height }) {
  const tiles = [];
  for (let y = 0; y < height; y++) {
    let row = "";
    for (let x = 0; x < width; x++) {
      row += y === 0 || y === height - 1 || x === 0 || x === width - 1 ? "#" : ".";
    }
    tiles.push(row);
  }
  return {
    schema: "agent-kernel/SimConfigArtifact",
    schemaVersion: 1,
    meta: {
      id: `sim-config-${runId}`,
      runId,
      createdAt,
      producedBy: "sandbox-place",
    },
    planRef: {
      id: `plan-${runId}`,
      schema: "agent-kernel/PlanArtifact",
      schemaVersion: 1,
    },
    seed: 1,
    layout: {
      kind: "grid",
      data: {
        width,
        height,
        tiles,
        legend: {
          "#": { tile: "wall" },
          ".": { tile: "floor" },
        },
      },
    },
  };
}

/**
 * Build a minimal InitialStateArtifact.
 */
function buildMinimalInitialState({ runId, createdAt, simConfigRef, actors = [] }) {
  return {
    schema: "agent-kernel/InitialStateArtifact",
    schemaVersion: 1,
    meta: {
      id: `initial-state-${runId}`,
      runId,
      createdAt,
      producedBy: "sandbox-place",
    },
    simConfigRef,
    actors,
  };
}

/**
 * Build a full visual ResourceBundleArtifact for sandbox use.
 * Uses the same createDefaultResourceBundleArtifact path as the normal build
 * so icon mappings are present and the card builder palette shows real sprites.
 */
function buildVisualResourceBundle({ runId, createdAt }) {
  return createDefaultResourceBundleArtifact({
    createMeta: ({ producedBy }) => ({
      id: `resource-bundle-${runId}`,
      runId,
      createdAt,
      producedBy,
    }),
    runId,
    producedBy: "sandbox-place",
    emitVisualAssets: true,
  });
}

/**
 * Build an actor record for InitialState from an entity type and parsed spec.
 * Stores entity-specific attributes in `traits` for downstream consumers.
 */
function buildActorFromEntitySpec(entityType, spec, position) {
  const actorKind = AMBULATORY_ENTITY_TYPES.has(entityType) ? "ambulatory" : "stationary";
  const actor = {
    id: spec.id || `${entityType}_${Date.now()}`,
    kind: actorKind,
    position,
    archetype: entityType,
  };

  const traits = {};
  // Shared attributes
  if (spec.affinity) traits.affinity = spec.affinity;
  if (spec.expression) traits.expression = spec.expression;
  // Ambulatory-specific
  if (spec.motivation) traits.motivation = spec.motivation;
  // Hazard / trap
  if (spec.stacks !== undefined) traits.stacks = Number(spec.stacks);
  if (spec.proximityRadius !== undefined) traits.proximityRadius = Number(spec.proximityRadius);
  if (spec.blocking !== undefined) traits.blocking = spec.blocking === "true" || spec.blocking === "1";
  // Resource
  if (spec.tier) traits.tier = spec.tier;
  if (spec.stat) traits.stat = spec.stat;
  if (spec.delta !== undefined) traits.delta = Number(spec.delta);
  if (spec.dropRate !== undefined) traits.dropRate = Number(spec.dropRate);

  if (Object.keys(traits).length > 0) {
    actor.traits = traits;
  }

  // Vitals — stamina fields (staminaCurrent, staminaMax, staminaRegen).
  // Other vitals (health, mana, durability) follow the same pattern but are
  // omitted here until a use-case requires them. When any stamina field is
  // present the full vitals block is written so downstream consumers always
  // find a well-formed record.
  const hasStamina =
    spec.staminaCurrent !== undefined ||
    spec.staminaMax !== undefined ||
    spec.staminaRegen !== undefined;
  if (hasStamina) {
    const sc = Number.isFinite(Number(spec.staminaCurrent)) ? Number(spec.staminaCurrent) : 0;
    // If staminaMax is absent, fall back to staminaCurrent so a one-field
    // spec like staminaCurrent=10 produces a sensible full record.
    const sm = spec.staminaMax !== undefined ? Number(spec.staminaMax) : sc;
    const sr = Number.isFinite(Number(spec.staminaRegen)) ? Number(spec.staminaRegen) : 0;
    actor.vitals = {
      health: { current: 0, max: 0, regen: 0 },
      mana: { current: 0, max: 0, regen: 0 },
      stamina: { current: sc, max: sm, regen: sr },
      durability: { current: 0, max: 0, regen: 0 },
    };
  }

  // Capabilities — movementCost drives stamina consumption on each move step.
  // Omitting movementCost (or leaving it at 0) means free movement.
  if (spec.movementCost !== undefined) {
    actor.capabilities = { movementCost: Number(spec.movementCost) };
  }

  return actor;
}

// ---------------------------------------------------------------------------
// executeSandboxPlace — shared logic used by MCP handler and CLI command
// ---------------------------------------------------------------------------

/**
 * Place an entity in an existing sandbox session.
 *
 * - Loads (or creates) SimConfig and InitialState artifacts in the session's directory.
 * - Performs bounds checking against the room dimensions in the session.
 * - Adds or replaces the actor in InitialState.
 * - Creates a minimal ResourceBundle placeholder if one doesn't exist.
 * - Persists all artifacts and updates the session's artifacts index.
 *
 * @param {object} options
 * @param {string} options.session      Absolute path to sandbox-session.json.
 * @param {string} options.entityType   Entity type (delver|warden|hazard|trap|resource).
 * @param {string} options.spec         Semicolon-delimited spec string.
 * @returns {Promise<object>}
 */
export async function executeSandboxPlace({ session: sessionPath, entityType, spec } = {}) {
  // Validate required inputs
  if (!isNonEmptyString(sessionPath)) {
    return { ok: false, command: "sandbox-place", error: "sandbox-place requires session path." };
  }
  if (!isNonEmptyString(entityType) || !ALLOWED_ENTITY_TYPES.has(entityType)) {
    return {
      ok: false,
      command: "sandbox-place",
      error: `entityType must be one of: ${Array.from(ALLOWED_ENTITY_TYPES).join(", ")}`,
    };
  }
  if (!isNonEmptyString(spec)) {
    return { ok: false, command: "sandbox-place", error: "sandbox-place requires spec string." };
  }

  // Load the sandbox session
  let session;
  try {
    session = await readJson(sessionPath);
  } catch (err) {
    return {
      ok: false,
      command: "sandbox-place",
      error: `Cannot read session file: ${err.message}`,
    };
  }
  if (session.schema !== SANDBOX_SESSION_SCHEMA) {
    return {
      ok: false,
      command: "sandbox-place",
      error: `Expected ${SANDBOX_SESSION_SCHEMA}, got ${session.schema || "unknown"}`,
    };
  }

  // Parse and validate the entity spec
  const parsedSpec = parseEntitySpec(spec);
  const x = Number(parsedSpec.x);
  const y = Number(parsedSpec.y);
  if (!Number.isInteger(x) || !Number.isInteger(y)) {
    return {
      ok: false,
      command: "sandbox-place",
      error: `spec must include integer x and y fields, got x=${parsedSpec.x} y=${parsedSpec.y}`,
    };
  }

  // Bounds check against room dimensions
  const room = Array.isArray(session.rooms) ? session.rooms[0] : null;
  if (!room || !Number.isInteger(room.width) || !Number.isInteger(room.height)) {
    return { ok: false, command: "sandbox-place", error: "Session room dimensions are invalid." };
  }
  if (x < 0 || x >= room.width || y < 0 || y >= room.height) {
    return {
      ok: false,
      command: "sandbox-place",
      error: `Position ${x},${y} is out of bounds for room ${room.width}×${room.height}`,
      outOfBounds: true,
    };
  }

  // Resolve output directory from session path
  const sessionDir = dirname(sessionPath);
  const runId = session.meta?.runId || makeId("sandbox_run");
  const createdAt = new Date().toISOString();

  // Load or create SimConfig
  const simConfigPath = join(sessionDir, "sim-config.json");
  let simConfig;
  if (existsSync(simConfigPath)) {
    try {
      simConfig = await readJson(simConfigPath);
    } catch {
      simConfig = buildMinimalSimConfig({ runId, createdAt, width: room.width, height: room.height });
    }
  } else {
    simConfig = buildMinimalSimConfig({ runId, createdAt, width: room.width, height: room.height });
  }

  // Load or create InitialState
  const initialStatePath = join(sessionDir, "initial-state.json");
  let initialState;
  if (existsSync(initialStatePath)) {
    try {
      initialState = await readJson(initialStatePath);
    } catch {
      initialState = buildMinimalInitialState({
        runId,
        createdAt,
        simConfigRef: toRef(simConfig),
        actors: [],
      });
    }
  } else {
    initialState = buildMinimalInitialState({
      runId,
      createdAt,
      simConfigRef: toRef(simConfig),
      actors: [],
    });
  }

  // Load or create ResourceBundle. Upgrade minimal bundles (no icon mappings) to visual bundles
  // so the card builder palette shows real sprites instead of Unicode fallbacks.
  const resourceBundlePath = join(sessionDir, "resource-bundle.json");
  let resourceBundle;
  if (existsSync(resourceBundlePath)) {
    try {
      resourceBundle = await readJson(resourceBundlePath);
      if (!resourceBundle?.mappings?.icons) {
        resourceBundle = buildVisualResourceBundle({ runId, createdAt });
      }
    } catch {
      resourceBundle = buildVisualResourceBundle({ runId, createdAt });
    }
  } else {
    resourceBundle = buildVisualResourceBundle({ runId, createdAt });
  }

  // Build the actor and add/replace in InitialState
  const position = { x, y };
  const actor = buildActorFromEntitySpec(entityType, parsedSpec, position);
  const actors = Array.isArray(initialState.actors)
    ? initialState.actors.filter((a) => a.id !== actor.id)
    : [];
  actors.push(actor);
  initialState.actors = actors;

  // Build and validate the updated session BEFORE writing any artifact files.
  // Writing artifacts first then failing validation leaves orphaned files on disk
  // while sandbox-session.json remains at the prior state — a partial-failure gap.
  const updatedSession = {
    ...session,
    artifacts: {
      ...session.artifacts,
      simConfigRef: toRef(simConfig),
      initialStateRef: toRef(initialState),
      resourceBundleRef: toRef(resourceBundle),
    },
  };
  const validation = validateSandboxSession(updatedSession);
  if (!validation.ok) {
    return {
      ok: false,
      command: "sandbox-place",
      error: `Session validation failed after placement: ${validation.errors.join("; ")}`,
    };
  }

  // Validation passed — write all four files atomically (best-effort; no temp-file
  // rename on this platform, but at least validation cannot fail after a partial write).
  await writeJson(simConfigPath, simConfig);
  await writeJson(initialStatePath, initialState);
  await writeJson(resourceBundlePath, resourceBundle);
  await writeJson(sessionPath, updatedSession);

  return {
    ok: true,
    command: "sandbox-place",
    entityType,
    entityId: actor.id,
    position,
    sessionPath,
    simConfigPath,
    initialStatePath,
    resourceBundlePath,
  };
}

// ---------------------------------------------------------------------------
// Movement helpers (M4)
// ---------------------------------------------------------------------------

/**
 * Cardinal direction map → { dx, dy, value }
 * `value` matches the Direction enum in core-ts (North=0, East=2, South=4, West=6).
 */
const DIRECTION_MAP = {
  north:     { dx:  0, dy: -1, value: 0 },
  northeast: { dx:  1, dy: -1, value: 1 },
  east:      { dx:  1, dy:  0, value: 2 },
  southeast: { dx:  1, dy:  1, value: 3 },
  south:     { dx:  0, dy:  1, value: 4 },
  southwest: { dx: -1, dy:  1, value: 5 },
  west:      { dx: -1, dy:  0, value: 6 },
  northwest: { dx: -1, dy: -1, value: 7 },
};

/**
 * Compose a single-tile cardinal move into an ActionSequence file.
 *
 * - Loads SimConfig and InitialState from the session directory.
 * - Validates that the target tile is walkable (not a wall).
 * - Appends an Action to the ActionSequence at `actionsOut` (creating it if absent).
 * - Updates the actor's position in InitialState for subsequent calls.
 *
 * @param {object} options
 * @param {string} options.session     Absolute path to sandbox-session.json.
 * @param {string} options.actorId     ID of the actor to move.
 * @param {string} options.direction   Cardinal direction: north|east|south|west.
 * @param {string} options.actionsOut  Path for the ActionSequence JSON file (created or appended).
 * @returns {Promise<object>}
 */
export async function executeSandboxMove({
  session: sessionPath,
  actorId,
  direction,
  actionsOut,
} = {}) {
  // Validate required inputs
  if (!isNonEmptyString(sessionPath)) {
    return { ok: false, command: "sandbox-move", error: "sandbox-move requires session path." };
  }
  if (!isNonEmptyString(actorId)) {
    return { ok: false, command: "sandbox-move", error: "sandbox-move requires actorId." };
  }
  if (!isNonEmptyString(direction)) {
    return { ok: false, command: "sandbox-move", error: "sandbox-move requires direction." };
  }
  if (!isNonEmptyString(actionsOut)) {
    return { ok: false, command: "sandbox-move", error: "sandbox-move requires actionsOut path." };
  }

  const dirKey = direction.toLowerCase().trim();
  const dirInfo = DIRECTION_MAP[dirKey];
  if (!dirInfo) {
    return {
      ok: false,
      command: "sandbox-move",
      error: `Unknown direction '${direction}'. Allowed: north, northeast, east, southeast, south, southwest, west, northwest.`,
      unknownDirection: true,
    };
  }

  // Load the sandbox session
  let session;
  try {
    session = await readJson(sessionPath);
  } catch (err) {
    return {
      ok: false,
      command: "sandbox-move",
      error: `Cannot read session file: ${err.message}`,
    };
  }
  if (session.schema !== SANDBOX_SESSION_SCHEMA) {
    return {
      ok: false,
      command: "sandbox-move",
      error: `Expected ${SANDBOX_SESSION_SCHEMA}, got ${session.schema || "unknown"}`,
    };
  }

  // Verify session has required artifact refs
  if (!session.artifacts?.initialStateRef) {
    return {
      ok: false,
      command: "sandbox-move",
      error: "Session has no initialStateRef — place at least one entity before moving.",
      noInitialState: true,
    };
  }
  if (!session.artifacts?.simConfigRef) {
    return {
      ok: false,
      command: "sandbox-move",
      error: "Session has no simConfigRef — place at least one entity before moving.",
      noSimConfig: true,
    };
  }

  const sessionDir = dirname(sessionPath);

  // Load SimConfig
  const simConfigPath = join(sessionDir, "sim-config.json");
  let simConfig;
  try {
    simConfig = await readJson(simConfigPath);
  } catch (err) {
    return {
      ok: false,
      command: "sandbox-move",
      error: `Cannot read sim-config.json: ${err.message}`,
    };
  }

  // Load InitialState
  const initialStatePath = join(sessionDir, "initial-state.json");
  let initialState;
  try {
    initialState = await readJson(initialStatePath);
  } catch (err) {
    return {
      ok: false,
      command: "sandbox-move",
      error: `Cannot read initial-state.json: ${err.message}`,
    };
  }

  // Find the actor
  const actors = Array.isArray(initialState.actors) ? [...initialState.actors] : [];
  const actorIdx = actors.findIndex((a) => a.id === actorId);
  if (actorIdx === -1) {
    return {
      ok: false,
      command: "sandbox-move",
      error: `Actor '${actorId}' not found in InitialState.`,
      actorNotFound: true,
    };
  }
  const actor = actors[actorIdx];

  // Guard: position coordinates must be integers — NaN or non-numeric coordinates
  // slip past bounds checks (NaN < 0 → false) and serialise as null, corrupting state.
  if (
    !Number.isInteger(actor.position?.x) ||
    !Number.isInteger(actor.position?.y)
  ) {
    return {
      ok: false,
      command: "sandbox-move",
      error: `Actor '${actorId}' has invalid position coordinates: x=${actor.position?.x}, y=${actor.position?.y}`,
    };
  }

  const from = { x: actor.position.x, y: actor.position.y };

  // Compute target position
  const to = { x: from.x + dirInfo.dx, y: from.y + dirInfo.dy };

  // Bounds check against room dimensions
  const room = Array.isArray(session.rooms) ? session.rooms[0] : null;
  const roomWidth = room?.width ?? 0;
  const roomHeight = room?.height ?? 0;
  if (to.x < 0 || to.x >= roomWidth || to.y < 0 || to.y >= roomHeight) {
    return {
      ok: false,
      command: "sandbox-move",
      error: `Move out of bounds: target ${to.x},${to.y} exceeds room ${roomWidth}×${roomHeight}.`,
      outOfBounds: true,
    };
  }

  // Wall check — target tile must not be a wall
  const tiles = simConfig.layout?.data?.tiles;
  if (Array.isArray(tiles) && typeof tiles[to.y] === "string") {
    const char = tiles[to.y][to.x];
    const legend = simConfig.layout?.data?.legend || {};
    const tileInfo = legend[char];
    if (tileInfo?.tile === "wall") {
      return {
        ok: false,
        command: "sandbox-move",
        error: `Move blocked by wall tile at ${to.x},${to.y}.`,
        blockedByWall: true,
      };
    }
  }

  // ------------------------------------------------------------------
  // Stamina check — mirrors the core-ts computeMovementCost formula.
  // Only enforced when the actor has capabilities.movementCost > 0.
  // Actors without movementCost (or with 0) get free movement so that
  // un-configured sandbox entities always work out of the box.
  // ------------------------------------------------------------------
  const cardinalCost =
    typeof actor.capabilities?.movementCost === "number" &&
    Number.isFinite(actor.capabilities.movementCost)
      ? actor.capabilities.movementCost
      : 0;

  let staminaDeducted = null; // null → no stamina tracking on this actor

  if (cardinalCost > 0) {
    const isDiagonal = dirInfo.dx !== 0 && dirInfo.dy !== 0;
    const diagonalExtra = isDiagonal
      ? cardinalCost > 1
        ? Math.max(1, Math.trunc(cardinalCost / 2))
        : 1
      : 0;
    const movementCost = cardinalCost + diagonalExtra;

    const sv = actor.vitals?.stamina ?? { current: 0, max: 0, regen: 0 };
    const sc = Number.isFinite(sv.current) ? sv.current : 0;
    const sm = Number.isFinite(sv.max) ? sv.max : 0;
    const sr = Number.isFinite(sv.regen) ? sv.regen : 0;
    const staminaAfterRegen = Math.min(sc + sr, sm);

    if (staminaAfterRegen < movementCost) {
      return {
        ok: false,
        command: "sandbox-move",
        error: `Insufficient stamina: need ${movementCost}, have ${staminaAfterRegen} (after regen).`,
        insufficientStamina: true,
        movementCost,
        staminaAfterRegen,
      };
    }

    staminaDeducted = {
      remaining: staminaAfterRegen - movementCost,
      max: sm,
      regen: sr,
      movementCost,
    };
  }

  // Load or initialise ActionSequence at actionsOut
  const actionsOutAbs = resolve(actionsOut);
  let actionSequence = null;
  if (existsSync(actionsOutAbs)) {
    try {
      actionSequence = await readJson(actionsOutAbs);
    } catch {
      actionSequence = null;
    }
  }

  const existingActions = Array.isArray(actionSequence?.actions) ? actionSequence.actions : [];
  const maxTick = existingActions.reduce(
    (max, a) => Math.max(max, typeof a.tick === "number" ? a.tick : 0),
    0,
  );
  const tick = maxTick + 1;

  // Build the Action
  const action = {
    schema: "agent-kernel/Action",
    schemaVersion: 1,
    actorId,
    tick,
    kind: "move",
    params: {
      direction: dirInfo.value,
      from,
      to,
    },
  };

  // Build the updated ActionSequence
  const runId = session.meta?.runId || "unknown";
  const updatedSequence = {
    schema: "agent-kernel/ActionSequence",
    schemaVersion: 1,
    meta: actionSequence?.meta || {
      id: `action-sequence-${runId}`,
      runId,
      createdAt: new Date().toISOString(),
      producedBy: "sandbox-move",
    },
    simConfigRef: session.artifacts.simConfigRef,
    initialStateRef: session.artifacts.initialStateRef,
    actions: [...existingActions, action],
  };

  // Write ActionSequence
  await writeJson(actionsOutAbs, updatedSequence);

  // Update actor position (and stamina when tracked) in InitialState
  let updatedActor = { ...actor, position: to };
  if (staminaDeducted !== null) {
    updatedActor = {
      ...updatedActor,
      vitals: {
        ...(actor.vitals ?? {
          health: { current: 0, max: 0, regen: 0 },
          mana: { current: 0, max: 0, regen: 0 },
          durability: { current: 0, max: 0, regen: 0 },
        }),
        stamina: {
          current: staminaDeducted.remaining,
          max: staminaDeducted.max,
          regen: staminaDeducted.regen,
        },
      },
    };
  }
  actors[actorIdx] = updatedActor;
  initialState.actors = actors;
  await writeJson(initialStatePath, initialState);

  return {
    ok: true,
    command: "sandbox-move",
    actorId,
    direction: dirKey,
    from,
    to,
    tick,
    actionsFile: actionsOutAbs,
    ...(staminaDeducted !== null
      ? { staminaRemaining: staminaDeducted.remaining, movementCost: staminaDeducted.movementCost }
      : {}),
  };
}

// ---------------------------------------------------------------------------
// ak_push_to_ui — M7 gap 4: deliver a create+run GameplayBundle to the UI (M8 bridge)
// ---------------------------------------------------------------------------

const DEFAULT_BRIDGE_PORT = Number(process.env.AK_SANDBOX_BRIDGE_PORT) || 38487;

function makePushMessageId() {
  return `msg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * Push a compiled agent-kernel/GameplayBundle to the sandbox WS bridge so a
 * connected browser UI (packages/ui-web/src/sandbox-bridge-client.js) loads
 * it into the gameplay Phaser surface.
 *
 * Accepts either:
 *   - `bundle`: an inline GameplayBundle object, or
 *   - `bundlePath`: an explicit path to a GameplayBundle JSON file, or
 *   - `outDir`: a run/create outDir containing bundle.json (the shape written
 *     by `run` per the M7 gap-3 stitching step, or by `create` pre-run).
 *
 * @param {object} options
 * @param {object} [options.bundle]
 * @param {string} [options.bundlePath]
 * @param {string} [options.outDir]
 * @param {string} [options.targetTab]      "design" | "gameplay" (default "gameplay").
 * @param {boolean} [options.requireClient] Fail if no browser UI is connected (default true).
 * @param {string} [options.correlationId]
 * @returns {Promise<object>}
 */
export async function executePushToUi({
  bundle: inlineBundle,
  bundlePath,
  outDir,
  targetTab = "gameplay",
  requireClient = true,
  correlationId,
} = {}) {
  let bundle = inlineBundle;

  if (!bundle) {
    const resolvedBundlePath = isNonEmptyString(bundlePath)
      ? resolve(bundlePath)
      : isNonEmptyString(outDir)
        ? join(resolve(outDir), "bundle.json")
        : null;
    if (!resolvedBundlePath) {
      return {
        ok: false,
        command: "push-to-ui",
        error: "ak_push_to_ui requires one of bundle, bundlePath, or outDir.",
      };
    }
    if (!existsSync(resolvedBundlePath)) {
      return {
        ok: false,
        command: "push-to-ui",
        error: `No bundle found at ${resolvedBundlePath}.`,
        bundleNotFound: true,
      };
    }
    try {
      bundle = await readJson(resolvedBundlePath);
    } catch (err) {
      return {
        ok: false,
        command: "push-to-ui",
        error: `Cannot read bundle: ${err.message}`,
      };
    }
  }

  if (!bundle || typeof bundle !== "object" || !Array.isArray(bundle.artifacts)) {
    return {
      ok: false,
      command: "push-to-ui",
      error: "Bundle must be an agent-kernel/GameplayBundle object with an artifacts[] array.",
      invalidBundle: true,
    };
  }

  const state = getSandboxBridgeState();

  if (state.startFailed) {
    return {
      ok: false,
      command: "push-to-ui",
      error: "SANDBOX_BRIDGE_START_FAILED",
      message: `The sandbox bridge server failed to start (port may be in use). Check port ${DEFAULT_BRIDGE_PORT}.`,
      bridge: { port: DEFAULT_BRIDGE_PORT, connectedClients: 0, startFailed: true },
    };
  }

  if (requireClient && state.connectedClients === 0) {
    return {
      ok: false,
      command: "push-to-ui",
      error: "SANDBOX_UI_NOT_CONNECTED",
      message:
        "No browser UI is connected to the sandbox bridge. " +
        "Open the UI dev server and ensure the bridge client is running, or set requireClient: false to pre-stage the bundle.",
      bridge: { port: DEFAULT_BRIDGE_PORT, connectedClients: 0 },
    };
  }

  const messageId = makePushMessageId();
  // D4 (sandbox-bridge-client.js handleBundle): targetTab lives at the envelope
  // root, not inside payload.
  const envelope = {
    type: "ak.gameplayBundle.v1",
    id: messageId,
    ...(correlationId ? { correlationId } : {}),
    createdAt: new Date().toISOString(),
    targetTab,
    payload: {
      bundle,
      source: { tool: "ak_push_to_ui" },
    },
  };

  const { deliveredClientIds, timedOutClientIds } = await pushGameplayBundle(envelope);

  return {
    ok: true,
    command: "push-to-ui",
    ...(correlationId ? { correlationId } : {}),
    targetTab,
    bridge: {
      port: DEFAULT_BRIDGE_PORT,
      connectedClients: state.connectedClients,
      deliveredClientIds,
      timedOutClientIds,
    },
    bundleSummary: {
      schema: bundle.schema,
      schemaVersion: bundle.schemaVersion,
      artifactCount: bundle.artifacts.length,
      tickFrameCount: Array.isArray(bundle.tickFrames) ? bundle.tickFrames.length : 0,
    },
  };
}

// ---------------------------------------------------------------------------
// MCP tool definition
// ---------------------------------------------------------------------------

export const sandboxTools = [
  createHandlerTool({
    name: "ak_sandbox_create",
    description:
      "Create a standalone Phaser sandbox session with budget enforcement. " +
      "Produces a SandboxSessionArtifact (sandbox-session.json) referencing the " +
      "BudgetReceiptArtifact and establishing room configuration. " +
      "The sandbox is the foundation for Phaser rendering and entity placement. " +
      "Requires budgetReceipt (BudgetReceiptArtifact path) or budget (BudgetArtifact path). " +
      "Returns ok: false with budgetInsufficient: true if budget is denied or zero-token.",
    inputSchema: {
      properties: withCommonOutput({
        budgetReceipt: pathSchema(
          "Budget receipt artifact path (BudgetReceiptArtifact). " +
            "Preferred — pass this when a receipt already exists from a prior build.",
        ),
        budget: pathSchema(
          "Budget artifact path (BudgetArtifact). " +
            "Alternative to budgetReceipt — a synthetic receipt ref is generated.",
        ),
        width: integerSchema("Default room width in tiles (default: 10).", { minimum: 1 }),
        height: integerSchema("Default room height in tiles (default: 10).", { minimum: 1 }),
        entityCategories: stringArraySchema(
          "Entity categories to enable in this sandbox session " +
            "(allowed: delver, warden, hazard, trap, resource).",
        ),
      }),
    },
    handler: (args) =>
      executeSandboxCreate({
        budgetReceipt: isNonEmptyString(args.budgetReceipt) ? args.budgetReceipt : undefined,
        budget: isNonEmptyString(args.budget) ? args.budget : undefined,
        width: args.width,
        height: args.height,
        entityCategories: args.entityCategories,
        runId: args.runId,
        createdAt: args.createdAt,
        outDir: args.outDir,
      }),
  }),

  createHandlerTool({
    name: "ak_sandbox_place",
    description:
      "Place and configure an entity in an existing Phaser sandbox session. " +
      "Builds or updates the canonical SimConfig, InitialState, and ResourceBundle artifacts " +
      "referenced by the sandbox session. Reuses existing authoring rules for entity normalization. " +
      "Supported entity types: delver, warden, hazard, trap, resource. " +
      "The spec parameter uses semicolon-delimited key=value pairs (e.g. id=hazard_fire;x=4;y=4;affinity=fire;expression=emit;stacks=2). " +
      "Returns ok: false with outOfBounds: true when position exceeds room dimensions.",
    inputSchema: {
      required: ["session", "entityType", "spec"],
      properties: {
        session: pathSchema("Absolute path to the sandbox-session.json file created by ak_sandbox_create."),
        entityType: {
          type: "string",
          enum: ["delver", "warden", "hazard", "trap", "resource"],
          description: "Entity category to place in the sandbox.",
        },
        spec: {
          type: "string",
          minLength: 1,
          description:
            "Semicolon-delimited entity spec (e.g. id=delver_1;x=1;y=1;affinity=water;motivation=exploring). " +
            "Required fields: id, x, y. Entity-type-specific fields: " +
            "delver/warden — affinity, motivation; " +
            "hazard/trap — affinity, expression, stacks, [proximityRadius], [blocking]; " +
            "resource — tier, stat, delta, dropRate.",
        },
      },
    },
    handler: (args) =>
      executeSandboxPlace({
        session: isNonEmptyString(args.session) ? args.session : undefined,
        entityType: args.entityType,
        spec: isNonEmptyString(args.spec) ? args.spec : undefined,
      }),
  }),

  createHandlerTool({
    name: "ak_sandbox_move",
    description:
      "Compose a single-tile cardinal move for an actor in a Phaser sandbox session. " +
      "Appends an Action to the ActionSequence file at actionsOut (creating it if absent). " +
      "Updates the actor's position in InitialState so subsequent calls reflect the new position. " +
      "Supports directions: north (dy=-1), east (dx=+1), south (dy=+1), west (dx=-1). " +
      "The produced ActionSequence is a valid input for the run --actions flag. " +
      "Returns ok: false with blockedByWall: true when the target tile is a wall, " +
      "actorNotFound: true when the actorId is not in InitialState, " +
      "outOfBounds: true when the target position exceeds room dimensions. " +
      "Supports all 8 directions: north, northeast, east, southeast, south, southwest, west, northwest.",
    inputSchema: {
      required: ["session", "actorId", "direction", "actionsOut"],
      properties: {
        session: pathSchema(
          "Absolute path to the sandbox-session.json file created by ak_sandbox_create.",
        ),
        actorId: stringSchema(
          "ID of the actor to move. Must match an actor id in the session's InitialState.",
        ),
        direction: {
          type: "string",
          enum: [
            "north", "northeast", "east", "southeast",
            "south", "southwest", "west", "northwest",
          ],
          description:
            "Direction to move one tile. Cardinal: north, east, south, west. " +
            "Inter-cardinal: northeast, southeast, southwest, northwest.",
        },
        actionsOut: pathSchema(
          "Path for the ActionSequence JSON file. " +
            "Created if absent; the new move action is appended if the file already exists.",
        ),
      },
    },
    handler: (args) =>
      executeSandboxMove({
        session: isNonEmptyString(args.session) ? args.session : undefined,
        actorId: isNonEmptyString(args.actorId) ? args.actorId : undefined,
        direction: isNonEmptyString(args.direction) ? args.direction : undefined,
        actionsOut: isNonEmptyString(args.actionsOut) ? args.actionsOut : undefined,
      }),
  }),

  createHandlerTool({
    name: "ak_push_to_ui",
    description:
      "Deliver a compiled agent-kernel/GameplayBundle (produced by ak_create + ak_run) to the " +
      "connected browser UI via the sandbox WebSocket bridge, so the Phaser gameplay surface can " +
      "load and play back the run. Accepts an explicit bundlePath, an outDir containing bundle.json " +
      "(the shape ak_run writes after M7 stitching), or an inline bundle object. " +
      "Returns ok: false with bundleNotFound: true when no bundle is found at the resolved path, " +
      "SANDBOX_UI_NOT_CONNECTED when no browser UI is connected and requireClient is true, and " +
      "SANDBOX_BRIDGE_START_FAILED when the bridge server failed to start.",
    inputSchema: {
      properties: {
        outDir: pathSchema(
          "Run or create outDir containing bundle.json. Used when bundle/bundlePath are omitted.",
        ),
        bundlePath: pathSchema("Explicit path to an agent-kernel/GameplayBundle JSON file."),
        bundle: {
          type: "object",
          additionalProperties: true,
          description: "Inline agent-kernel/GameplayBundle object, taking precedence over bundlePath/outDir.",
        },
        targetTab: {
          type: "string",
          enum: ["design", "gameplay"],
          description: "Which UI tab to activate after loading. Defaults to 'gameplay'.",
          default: "gameplay",
        },
        requireClient: booleanSchema(
          "When true (default), fail immediately if no browser UI is connected. " +
            "When false, push and store the bundle for replay when the UI connects.",
        ),
        correlationId: stringSchema("Optional caller-supplied correlation ID echoed back in the result."),
      },
    },
    handler: (args) =>
      executePushToUi({
        bundle: args.bundle && typeof args.bundle === "object" ? args.bundle : undefined,
        bundlePath: isNonEmptyString(args.bundlePath) ? args.bundlePath : undefined,
        outDir: isNonEmptyString(args.outDir) ? args.outDir : undefined,
        targetTab: args.targetTab === "design" ? "design" : "gameplay",
        requireClient: args.requireClient === false ? false : true,
        correlationId: isNonEmptyString(args.correlationId) ? args.correlationId : undefined,
      }),
  }),
];
