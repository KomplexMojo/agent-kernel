/**
 * Configurator config validation — the structural and invariant checks behind
 * the persona's `validate()` state (CR.2).
 *
 * The Configurator's chartered role is "configuration assembly, validation,
 * locking". Assembly lived in input-preparation.js from P2.2, but validation was
 * a label: `validate()` was requireState + fsm.advance, so a config with
 * `width: "not-a-number"`, `height: -3`, `shape: "wrong-type"` and
 * `resources: "not-an-array"` advanced the FSM to `configured`. This module is
 * the missing half.
 *
 * WHY HERE AND NOT contracts/build-spec.js: validateBuildSpec() only calls
 * validateAgentHints() on `configurator.inputs` — it validates the *hints*
 * sub-object and never looks at levelGen, resources, actors, or the grid
 * invariants. So this is a genuine gap, not a second origin of an existing
 * check (which would be an A1 violation in its own right). The error idiom
 * (`{ ok, errors }` with "path: message" strings) deliberately mirrors
 * build-spec.js so the two read alike.
 *
 * PERMISSIVE ON PRESENCE, STRICT ON TYPE. Production emits partial shapes that
 * are legitimate: the resource-plan-g4 golden carries `shape: { roomCount: 1 }`
 * with no roomMinSize/roomMaxSize/corridorWidth, and `actors: []`. Mandating a
 * fuller shape than production emits would reject valid builds, so every field
 * is optional and checked only when present. The one exception is a genuine
 * cross-field invariant: roomMinSize must not exceed roomMaxSize.
 *
 * Deeper normalization of actors/cardSet stays with orchestrateBuild, which
 * owns it today; those are checked only as arrays of objects here.
 *
 * Pure: no IO, no clock, no imports — safe under the runtime persona layer.
 */

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function addError(errors, path, message) {
  errors.push(`${path}: ${message}`);
}

function validateOptionalPositiveInteger(value, path, errors) {
  if (value === undefined) {
    return;
  }
  if (!Number.isInteger(value) || value <= 0) {
    addError(errors, path, "expected positive integer");
  }
}

function validateOptionalBoolean(value, path, errors) {
  if (value === undefined) {
    return;
  }
  if (typeof value !== "boolean") {
    addError(errors, path, "expected boolean");
  }
}

/** An array of objects; entries are not inspected further. */
function validateOptionalObjectArray(value, path, errors) {
  if (value === undefined) {
    return;
  }
  if (!Array.isArray(value)) {
    addError(errors, path, "expected array");
    return;
  }
  value.forEach((entry, index) => {
    if (!isObject(entry)) {
      addError(errors, `${path}[${index}]`, "expected object");
    }
  });
}

function validateLevelGenShape(shape, path, errors) {
  if (shape === undefined) {
    return;
  }
  if (!isObject(shape)) {
    addError(errors, path, "expected object");
    return;
  }
  validateOptionalPositiveInteger(shape.roomCount, `${path}.roomCount`, errors);
  validateOptionalPositiveInteger(shape.roomMinSize, `${path}.roomMinSize`, errors);
  validateOptionalPositiveInteger(shape.roomMaxSize, `${path}.roomMaxSize`, errors);
  validateOptionalPositiveInteger(shape.corridorWidth, `${path}.corridorWidth`, errors);
  // The one cross-field invariant. level-layout.js clamps roomMinSize against
  // the grid, but an inverted min/max silently yields rooms of an unintended
  // size rather than failing, so reject it here.
  if (Number.isInteger(shape.roomMinSize) && Number.isInteger(shape.roomMaxSize)
    && shape.roomMinSize > shape.roomMaxSize) {
    addError(errors, path, `roomMinSize (${shape.roomMinSize}) must not exceed roomMaxSize (${shape.roomMaxSize})`);
  }
}

function validateLevelGen(levelGen, path, errors) {
  if (levelGen === undefined) {
    return;
  }
  if (!isObject(levelGen)) {
    addError(errors, path, "expected object");
    return;
  }
  validateOptionalPositiveInteger(levelGen.width, `${path}.width`, errors);
  validateOptionalPositiveInteger(levelGen.height, `${path}.height`, errors);
  validateOptionalPositiveInteger(levelGen.walkableTilesTarget, `${path}.walkableTilesTarget`, errors);
  validateOptionalBoolean(levelGen.budgetScaffold, `${path}.budgetScaffold`, errors);
  if (levelGen.seed !== undefined && !Number.isFinite(levelGen.seed)) {
    addError(errors, `${path}.seed`, "expected number");
  }
  validateLevelGenShape(levelGen.shape, `${path}.shape`, errors);
  validateOptionalObjectArray(levelGen.hazards, `${path}.hazards`, errors);
}

function validateResources(resources, path, errors) {
  if (resources === undefined) {
    return;
  }
  if (!Array.isArray(resources)) {
    addError(errors, path, "expected array");
    return;
  }
  resources.forEach((entry, index) => {
    const entryPath = `${path}[${index}]`;
    if (!isObject(entry)) {
      addError(errors, entryPath, "expected object");
      return;
    }
    // mapResources() carries `id` through from the authored resource; an
    // id-less resource cannot be referenced by a receipt line item.
    if (!isNonEmptyString(entry.id)) {
      addError(errors, `${entryPath}.id`, "expected non-empty string");
    }
  });
}

/**
 * Validate an assembled configurator config (the `configurator.inputs` shape).
 *
 * @param {unknown} config
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function validateConfiguratorConfig(config) {
  if (!isObject(config)) {
    return { ok: false, errors: ["config: expected object"] };
  }
  const errors = [];
  validateLevelGen(config.levelGen, "levelGen", errors);
  validateResources(config.resources, "resources", errors);
  validateOptionalObjectArray(config.actors, "actors", errors);
  validateOptionalObjectArray(config.actorGroups, "actorGroups", errors);
  validateOptionalObjectArray(config.cardSet, "cardSet", errors);
  validateOptionalBoolean(config.maximizeBudget, "maximizeBudget", errors);
  return { ok: errors.length === 0, errors };
}
