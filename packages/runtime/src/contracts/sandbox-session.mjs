/**
 * Sandbox Session Contract
 * ------------------------
 * Versioned artifact that acts as an index and session envelope for a
 * standalone Phaser sandbox. It references existing SimConfig, InitialState,
 * ResourceBundle, and BudgetReceipt artifacts rather than embedding payloads.
 *
 * This is a boundary-crossing artifact: MCP, CLI, runtime, and standalone
 * Phaser all reference the sandbox session by its schema/id. It must be
 * stable and versioned.
 */

export const SANDBOX_SESSION_SCHEMA = "agent-kernel/SandboxSessionArtifact";
export const SANDBOX_SESSION_SCHEMA_VERSION = 1;

const SUPPORTED_ENTITY_CATEGORIES = new Set([
  "delver",
  "warden",
  "hazard",
  "trap",
  "resource",
]);

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function addError(errors, path, message) {
  errors.push(`${path}: ${message}`);
}

function validateArtifactMeta(meta, path, errors) {
  if (!isObject(meta)) {
    addError(errors, path, "expected object");
    return;
  }
  if (!isNonEmptyString(meta.id)) {
    addError(errors, `${path}.id`, "expected non-empty string");
  }
  if (!isNonEmptyString(meta.runId)) {
    addError(errors, `${path}.runId`, "expected non-empty string");
  }
  if (!isNonEmptyString(meta.createdAt)) {
    addError(errors, `${path}.createdAt`, "expected non-empty string");
  }
  if (!isNonEmptyString(meta.producedBy)) {
    addError(errors, `${path}.producedBy`, "expected non-empty string");
  }
}

function validateRoom(room, path, errors) {
  if (!isObject(room)) {
    addError(errors, path, "expected object");
    return;
  }
  if (!isNonEmptyString(room.id)) {
    addError(errors, `${path}.id`, "expected non-empty string");
  }
  if (!Number.isInteger(room.width) || room.width <= 0) {
    addError(errors, `${path}.width`, "expected positive integer");
  }
  if (!Number.isInteger(room.height) || room.height <= 0) {
    addError(errors, `${path}.height`, "expected positive integer");
  }
}

function validateRooms(rooms, path, errors) {
  if (!Array.isArray(rooms) || rooms.length === 0) {
    addError(errors, path, "expected non-empty array");
    return;
  }
  rooms.forEach((room, index) => {
    validateRoom(room, `${path}[${index}]`, errors);
  });
}

function validateArtifactsIndex(artifacts, path, errors) {
  if (!isObject(artifacts)) {
    addError(errors, path, "expected object");
    return;
  }
  // Require at minimum a budget receipt reference — the other refs are written
  // lazily as the sandbox progresses through creation steps, but budget receipt
  // must exist before any entity placement can occur.
  const hasBudgetRef =
    isObject(artifacts.budgetReceiptRef) ||
    isNonEmptyString(artifacts["budget-receipt"]);
  if (!hasBudgetRef) {
    addError(errors, `${path}.budgetReceiptRef`, "expected budget receipt reference");
  }
}

function validateEntityCategories(categories, path, errors) {
  if (categories === undefined) {
    return;
  }
  if (!Array.isArray(categories)) {
    addError(errors, path, "expected array");
    return;
  }
  categories.forEach((category, index) => {
    if (!isNonEmptyString(category) || !SUPPORTED_ENTITY_CATEGORIES.has(category)) {
      addError(
        errors,
        `${path}[${index}]`,
        `expected one of: ${Array.from(SUPPORTED_ENTITY_CATEGORIES).join(", ")}`,
      );
    }
  });
}

/**
 * Validate a SandboxSessionArtifactV1.
 *
 * @param {unknown} artifact
 * @returns {{ ok: boolean; errors: string[] }}
 */
export function validateSandboxSession(artifact) {
  const errors = [];

  if (!isObject(artifact)) {
    return { ok: false, errors: ["artifact: expected object"] };
  }

  if (artifact.schema !== SANDBOX_SESSION_SCHEMA) {
    addError(errors, "schema", `expected ${SANDBOX_SESSION_SCHEMA}`);
  }

  if (artifact.schemaVersion !== SANDBOX_SESSION_SCHEMA_VERSION) {
    addError(errors, "schemaVersion", `expected ${SANDBOX_SESSION_SCHEMA_VERSION}`);
  }

  validateArtifactMeta(artifact.meta, "meta", errors);
  validateRooms(artifact.rooms, "rooms", errors);
  validateArtifactsIndex(artifact.artifacts, "artifacts", errors);
  validateEntityCategories(artifact.entityCategories, "entityCategories", errors);

  return { ok: errors.length === 0, errors };
}
