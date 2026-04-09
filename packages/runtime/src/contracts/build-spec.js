export const BUILD_SPEC_SCHEMA = "agent-kernel/BuildSpec";
export const BUILD_SPEC_SCHEMA_VERSION = 1;
export const AGENT_COMMAND_REQUEST_SCHEMA = "agent-kernel/AgentCommandRequestArtifact";

const BUDGET_SCHEMA = "agent-kernel/BudgetArtifact";
const PRICE_LIST_SCHEMA = "agent-kernel/PriceList";
const BUDGET_RECEIPT_SCHEMA = "agent-kernel/BudgetReceiptArtifact";
const AGENT_COMMAND_ACTIONS = new Set(["author", "configure"]);
const AGENT_COMMAND_OBJECT_KINDS = new Set([
  "room",
  "floor_tile",
  "trap",
  "delver",
  "warden",
  "shared_config",
]);
const AGENT_COMMAND_COMPILE_TARGETS = new Set([
  "build_spec_intent",
  "build_spec_plan",
  "build_spec_configurator",
  "artifact_extension",
]);
const AGENT_COMMAND_DIRECTIVE_SOURCES = new Set(["text", "flag", "object_flag", "budget_artifact"]);
const AGENT_COMMAND_OPTIMIZATION_PRIORITIES = new Set(["low", "medium", "high"]);
const AGENT_COMMAND_OPTIMIZATION_SCOPES = new Set([
  ...Array.from(AGENT_COMMAND_OBJECT_KINDS),
  "shared_config",
]);
const AGENT_COMMAND_OPTIMIZATION_GOAL_KINDS = new Set([
  "maximize_budget_spend",
  "maximize_vital_max",
  "maximize_vital_regen",
]);
const VITAL_KEYS = new Set(["health", "mana", "stamina", "durability"]);

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function addError(errors, path, message) {
  errors.push(`${path}: ${message}`);
}

function validateArtifactRef(value, path, errors) {
  if (!isObject(value)) {
    addError(errors, path, "expected object");
    return;
  }
  if (!isNonEmptyString(value.id)) {
    addError(errors, `${path}.id`, "expected non-empty string");
  }
  if (!isNonEmptyString(value.schema)) {
    addError(errors, `${path}.schema`, "expected non-empty string");
  }
  if (!Number.isInteger(value.schemaVersion)) {
    addError(errors, `${path}.schemaVersion`, "expected integer");
  }
}

function validateInlineArtifact(value, path, expectedSchema, errors) {
  if (!isObject(value)) {
    addError(errors, path, "expected object");
    return;
  }
  if (value.schema !== expectedSchema) {
    addError(errors, `${path}.schema`, `expected ${expectedSchema}`);
  }
  if (value.schemaVersion !== 1) {
    addError(errors, `${path}.schemaVersion`, "expected 1");
  }
}

function validateOptionalString(value, path, errors) {
  if (value === undefined) {
    return;
  }
  if (!isNonEmptyString(value)) {
    addError(errors, path, "expected non-empty string");
  }
}

function validateOptionalNumber(value, path, errors) {
  if (value === undefined) {
    return;
  }
  if (!Number.isFinite(value)) {
    addError(errors, path, "expected number");
  }
}

function validatePositiveInteger(value, path, errors) {
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

function validateStringArray(value, path, errors) {
  if (value === undefined) {
    return;
  }
  if (!Array.isArray(value) || !value.every(isNonEmptyString)) {
    addError(errors, path, "expected array of non-empty strings");
  }
}

function validateRoomHints(value, path, errors) {
  if (value === undefined) {
    return;
  }
  if (!Array.isArray(value)) {
    addError(errors, path, "expected array");
    return;
  }
  value.forEach((room, index) => {
    const basePath = `${path}[${index}]`;
    if (!isObject(room)) {
      addError(errors, basePath, "expected object");
      return;
    }
    validateOptionalString(room.affinity, `${basePath}.affinity`, errors);
    validateOptionalString(room.trap, `${basePath}.trap`, errors);
    validateOptionalString(room.trapAffinity, `${basePath}.trapAffinity`, errors);
  });
}

function validateActorHints(value, path, errors) {
  if (value === undefined) {
    return;
  }
  if (!Array.isArray(value)) {
    addError(errors, path, "expected array");
    return;
  }
  value.forEach((actor, index) => {
    const basePath = `${path}[${index}]`;
    if (!isObject(actor)) {
      addError(errors, basePath, "expected object");
      return;
    }
    validateOptionalString(actor.role, `${basePath}.role`, errors);
    validateOptionalNumber(actor.count, `${basePath}.count`, errors);
    validateOptionalString(actor.affinity, `${basePath}.affinity`, errors);
    validateOptionalString(actor.motivation, `${basePath}.motivation`, errors);
    validateStringArray(actor.motivations, `${basePath}.motivations`, errors);
    validateOptionalNumber(actor.strength, `${basePath}.strength`, errors);
  });
}

function validateActorGroupHints(value, path, errors) {
  if (value === undefined) {
    return;
  }
  if (!Array.isArray(value)) {
    addError(errors, path, "expected array");
    return;
  }
  value.forEach((group, index) => {
    const basePath = `${path}[${index}]`;
    if (!isObject(group)) {
      addError(errors, basePath, "expected object");
      return;
    }
    validateOptionalString(group.role, `${basePath}.role`, errors);
    validateOptionalNumber(group.count, `${basePath}.count`, errors);
  });
}

function validateAgentHints(value, path, errors) {
  if (value === undefined) {
    return;
  }
  if (!isObject(value)) {
    addError(errors, path, "expected object");
    return;
  }
  validateOptionalNumber(value.budgetTokens, `${path}.budgetTokens`, errors);
  validateOptionalString(value.levelSize, `${path}.levelSize`, errors);
  validateOptionalString(value.levelAffinity, `${path}.levelAffinity`, errors);
  validateOptionalNumber(value.roomCount, `${path}.roomCount`, errors);
  validateRoomHints(value.rooms, `${path}.rooms`, errors);
  validateActorHints(value.actors, `${path}.actors`, errors);
  validateActorGroupHints(value.actorGroups, `${path}.actorGroups`, errors);
}

function validateArtifactMeta(value, path, errors) {
  if (!isObject(value)) {
    addError(errors, path, "expected object");
    return;
  }
  if (!isNonEmptyString(value.id)) {
    addError(errors, `${path}.id`, "expected non-empty string");
  }
  if (!isNonEmptyString(value.runId)) {
    addError(errors, `${path}.runId`, "expected non-empty string");
  }
  if (!isNonEmptyString(value.createdAt)) {
    addError(errors, `${path}.createdAt`, "expected non-empty string");
  }
  if (!isNonEmptyString(value.producedBy)) {
    addError(errors, `${path}.producedBy`, "expected non-empty string");
  }
}

function validateAgentCommandObjectKind(value, path, errors) {
  if (!isNonEmptyString(value) || !AGENT_COMMAND_OBJECT_KINDS.has(value)) {
    addError(
      errors,
      path,
      `expected one of ${Array.from(AGENT_COMMAND_OBJECT_KINDS).join(", ")}`,
    );
  }
}

function validateAgentCommandObject(value, path, errors) {
  if (!isObject(value)) {
    addError(errors, path, "expected object");
    return;
  }
  validateAgentCommandObjectKind(value.kind, `${path}.kind`, errors);
  if (!isNonEmptyString(value.prompt)) {
    addError(errors, `${path}.prompt`, "expected non-empty string");
  }
  validateOptionalString(value.id, `${path}.id`, errors);
  validateOptionalNumber(value.count, `${path}.count`, errors);
  if (value.attributes !== undefined && !isObject(value.attributes)) {
    addError(errors, `${path}.attributes`, "expected object");
  }
  validateOptimizationGoals(value.optimizationGoals, `${path}.optimizationGoals`, errors);
}

function validateAgentCommandRoute(value, path, errors) {
  if (!isObject(value)) {
    addError(errors, path, "expected object");
    return;
  }
  if (!isNonEmptyString(value.target) || !AGENT_COMMAND_COMPILE_TARGETS.has(value.target)) {
    addError(
      errors,
      `${path}.target`,
      `expected one of ${Array.from(AGENT_COMMAND_COMPILE_TARGETS).join(", ")}`,
    );
  }
  validateOptionalString(value.path, `${path}.path`, errors);
  validateOptionalString(value.artifactSchema, `${path}.artifactSchema`, errors);
  validateOptionalString(value.legacyFlow, `${path}.legacyFlow`, errors);
  if (value.target === "artifact_extension" && !isNonEmptyString(value.artifactSchema)) {
    addError(errors, `${path}.artifactSchema`, "expected non-empty string for artifact_extension");
  }
  if (value.target !== "artifact_extension" && value.path !== undefined && !isNonEmptyString(value.path)) {
    addError(errors, `${path}.path`, "expected non-empty string");
  }
}

function validateAgentCommandCompilation(value, path, errors, expectedKinds = []) {
  if (!isObject(value)) {
    addError(errors, path, "expected object");
    return;
  }
  if (!Array.isArray(value.rules) || value.rules.length === 0) {
    addError(errors, `${path}.rules`, "expected non-empty array");
    return;
  }
  const seenKinds = new Set();
  value.rules.forEach((rule, index) => {
    const basePath = `${path}.rules[${index}]`;
    if (!isObject(rule)) {
      addError(errors, basePath, "expected object");
      return;
    }
    validateAgentCommandObjectKind(rule.kind, `${basePath}.kind`, errors);
    if (!Array.isArray(rule.compileTo) || rule.compileTo.length === 0) {
      addError(errors, `${basePath}.compileTo`, "expected non-empty array");
    } else {
      rule.compileTo.forEach((route, routeIndex) => {
        validateAgentCommandRoute(route, `${basePath}.compileTo[${routeIndex}]`, errors);
      });
    }
    validateStringArray(rule.notes, `${basePath}.notes`, errors);
    if (isNonEmptyString(rule.kind)) {
      seenKinds.add(rule.kind);
    }
  });
  expectedKinds.forEach((kind) => {
    if (!seenKinds.has(kind)) {
      addError(errors, `${path}.rules`, `missing compilation rule for ${kind}`);
    }
  });
}

function validateDirectiveSources(value, path, errors) {
  if (value === undefined) {
    return;
  }
  if (!Array.isArray(value) || value.length === 0) {
    addError(errors, path, "expected non-empty array");
    return;
  }
  value.forEach((entry, index) => {
    if (!isNonEmptyString(entry) || !AGENT_COMMAND_DIRECTIVE_SOURCES.has(entry)) {
      addError(
        errors,
        `${path}[${index}]`,
        `expected one of ${Array.from(AGENT_COMMAND_DIRECTIVE_SOURCES).join(", ")}`,
      );
    }
  });
}

function validateOptimizationGoal(value, path, errors) {
  if (!isObject(value)) {
    addError(errors, path, "expected object");
    return;
  }
  if (!isNonEmptyString(value.kind) || !AGENT_COMMAND_OPTIMIZATION_GOAL_KINDS.has(value.kind)) {
    addError(
      errors,
      `${path}.kind`,
      `expected one of ${Array.from(AGENT_COMMAND_OPTIMIZATION_GOAL_KINDS).join(", ")}`,
    );
  }
  if (!isNonEmptyString(value.scope) || !AGENT_COMMAND_OPTIMIZATION_SCOPES.has(value.scope)) {
    addError(
      errors,
      `${path}.scope`,
      `expected one of ${Array.from(AGENT_COMMAND_OPTIMIZATION_SCOPES).join(", ")}`,
    );
  }
  if (value.priority !== undefined
    && (!isNonEmptyString(value.priority) || !AGENT_COMMAND_OPTIMIZATION_PRIORITIES.has(value.priority))) {
    addError(
      errors,
      `${path}.priority`,
      `expected one of ${Array.from(AGENT_COMMAND_OPTIMIZATION_PRIORITIES).join(", ")}`,
    );
  }
  if (value.source !== undefined
    && (!isNonEmptyString(value.source) || !AGENT_COMMAND_DIRECTIVE_SOURCES.has(value.source))) {
    addError(
      errors,
      `${path}.source`,
      `expected one of ${Array.from(AGENT_COMMAND_DIRECTIVE_SOURCES).join(", ")}`,
    );
  }

  const requiresVital = value.kind === "maximize_vital_max" || value.kind === "maximize_vital_regen";
  if (requiresVital) {
    if (!isNonEmptyString(value.vital) || !VITAL_KEYS.has(value.vital)) {
      addError(errors, `${path}.vital`, `expected one of ${Array.from(VITAL_KEYS).join(", ")}`);
    }
    if (value.scope === "shared_config") {
      addError(errors, `${path}.scope`, "expected authored object scope for vital optimization");
    }
  } else if (value.scope !== undefined && value.scope !== "shared_config") {
    addError(errors, `${path}.scope`, "maximize_budget_spend must target shared_config");
  }
}

function validateOptimizationGoals(value, path, errors) {
  if (value === undefined) {
    return;
  }
  if (!Array.isArray(value)) {
    addError(errors, path, "expected array");
    return;
  }
  value.forEach((entry, index) => {
    validateOptimizationGoal(entry, `${path}[${index}]`, errors);
  });
}

function validateHardConstraints(value, path, errors) {
  if (value === undefined) {
    return;
  }
  if (!isObject(value)) {
    addError(errors, path, "expected object");
    return;
  }
  if (value.hardBudget !== undefined) {
    if (!isObject(value.hardBudget)) {
      addError(errors, `${path}.hardBudget`, "expected object");
    } else {
      validatePositiveInteger(value.hardBudget.totalTokens, `${path}.hardBudget.totalTokens`, errors);
      validateDirectiveSources(value.hardBudget.sources, `${path}.hardBudget.sources`, errors);
    }
  }
}

function validateAgentCommandSharedConfig(value, path, errors) {
  if (value === undefined) {
    return;
  }
  if (!isObject(value)) {
    addError(errors, path, "expected object");
    return;
  }
  validateOptionalString(value.dungeonAffinity, `${path}.dungeonAffinity`, errors);
  validateOptionalNumber(value.budgetTokens, `${path}.budgetTokens`, errors);
  validateOptionalString(value.levelSize, `${path}.levelSize`, errors);
  validateOptionalNumber(value.roomCount, `${path}.roomCount`, errors);
  validateHardConstraints(value.constraints, `${path}.constraints`, errors);
  validateOptimizationGoals(value.optimizationGoals, `${path}.optimizationGoals`, errors);
}

function validateAgentCommandCompatibility(value, path, errors) {
  if (value === undefined) {
    return;
  }
  if (!isObject(value)) {
    addError(errors, path, "expected object");
    return;
  }
  validateOptionalBoolean(value.preserveExistingCommands, `${path}.preserveExistingCommands`, errors);
  validateStringArray(value.supportedLegacyFlows, `${path}.supportedLegacyFlows`, errors);
  validateStringArray(value.notes, `${path}.notes`, errors);
}

export function validateAgentCommandRequest(request, path = "agentCommandRequest") {
  const errors = [];
  if (!isObject(request)) {
    return { ok: false, errors: [`${path}: expected object`] };
  }
  if (request.schema !== AGENT_COMMAND_REQUEST_SCHEMA) {
    addError(errors, `${path}.schema`, `expected ${AGENT_COMMAND_REQUEST_SCHEMA}`);
  }
  if (request.schemaVersion !== 1) {
    addError(errors, `${path}.schemaVersion`, "expected 1");
  }
  validateArtifactMeta(request.meta, `${path}.meta`, errors);

  if (!isObject(request.command)) {
    addError(errors, `${path}.command`, "expected object");
  } else {
    if (!isNonEmptyString(request.command.action) || !AGENT_COMMAND_ACTIONS.has(request.command.action)) {
      addError(errors, `${path}.command.action`, `expected one of ${Array.from(AGENT_COMMAND_ACTIONS).join(", ")}`);
    }
    if (!isNonEmptyString(request.command.text)) {
      addError(errors, `${path}.command.text`, "expected non-empty string");
    }
    if (!isNonEmptyString(request.command.source)) {
      addError(errors, `${path}.command.source`, "expected non-empty string");
    }
    if (request.command.taxonomyVersion !== 1) {
      addError(errors, `${path}.command.taxonomyVersion`, "expected 1");
    }
  }

  if (!Array.isArray(request.objects) || request.objects.length === 0) {
    addError(errors, `${path}.objects`, "expected non-empty array");
  } else {
    request.objects.forEach((entry, index) => {
      validateAgentCommandObject(entry, `${path}.objects[${index}]`, errors);
    });
  }

  validateAgentCommandSharedConfig(request.sharedConfig, `${path}.sharedConfig`, errors);
  validateAgentCommandCompatibility(request.compatibility, `${path}.compatibility`, errors);

  const expectedKinds = Array.isArray(request.objects)
    ? Array.from(
      new Set(
        request.objects
          .map((entry) => entry?.kind)
          .filter((kind) => isNonEmptyString(kind)),
      ),
    )
    : [];
  validateAgentCommandCompilation(request.compilation, `${path}.compilation`, errors, expectedKinds);

  return { ok: errors.length === 0, errors };
}

function validateBuildSpecAuthoring(value, path, errors) {
  if (value === undefined) {
    return;
  }
  if (!isObject(value)) {
    addError(errors, path, "expected object");
    return;
  }
  if (value.requestRef !== undefined) {
    validateArtifactRef(value.requestRef, `${path}.requestRef`, errors);
  }
  if (value.request !== undefined) {
    const result = validateAgentCommandRequest(value.request, `${path}.request`);
    errors.push(...result.errors);
  }
  if (value.objectKinds !== undefined) {
    if (!Array.isArray(value.objectKinds) || value.objectKinds.length === 0) {
      addError(errors, `${path}.objectKinds`, "expected non-empty array");
    } else {
      value.objectKinds.forEach((kind, index) => {
        validateAgentCommandObjectKind(kind, `${path}.objectKinds[${index}]`, errors);
      });
    }
  }
  validateHardConstraints(value.constraints, `${path}.constraints`, errors);
  validateOptimizationGoals(value.optimizationGoals, `${path}.optimizationGoals`, errors);
}

export function validateBuildSpec(spec) {
  const errors = [];

  if (!isObject(spec)) {
    return { ok: false, errors: ["spec: expected object"] };
  }

  if (spec.schema !== BUILD_SPEC_SCHEMA) {
    addError(errors, "schema", `expected ${BUILD_SPEC_SCHEMA}`);
  }

  if (spec.schemaVersion !== BUILD_SPEC_SCHEMA_VERSION) {
    addError(errors, "schemaVersion", `expected ${BUILD_SPEC_SCHEMA_VERSION}`);
  }

  if (!isObject(spec.meta)) {
    addError(errors, "meta", "expected object");
  } else {
    if (!isNonEmptyString(spec.meta.id)) {
      addError(errors, "meta.id", "expected non-empty string");
    }
    if (!isNonEmptyString(spec.meta.runId)) {
      addError(errors, "meta.runId", "expected non-empty string");
    }
    if (!isNonEmptyString(spec.meta.createdAt)) {
      addError(errors, "meta.createdAt", "expected non-empty string");
    }
    if (!isNonEmptyString(spec.meta.source)) {
      addError(errors, "meta.source", "expected non-empty string");
    }
  }

  if (!isObject(spec.intent)) {
    addError(errors, "intent", "expected object");
  } else {
    if (!isNonEmptyString(spec.intent.goal)) {
      addError(errors, "intent.goal", "expected non-empty string");
    }
    if (spec.intent.tags !== undefined) {
      if (!Array.isArray(spec.intent.tags)) {
        addError(errors, "intent.tags", "expected array of strings");
      } else if (!spec.intent.tags.every(isNonEmptyString)) {
        addError(errors, "intent.tags", "expected array of non-empty strings");
      }
    }
    validateAgentHints(spec.intent.hints, "intent.hints", errors);
  }

  if (spec.plan !== undefined) {
    if (!isObject(spec.plan)) {
      addError(errors, "plan", "expected object");
    } else if (spec.plan.hints !== undefined && !isObject(spec.plan.hints)) {
      addError(errors, "plan.hints", "expected object");
    }
  }

  if (spec.configurator !== undefined) {
    if (!isObject(spec.configurator)) {
      addError(errors, "configurator", "expected object");
    } else {
      validateAgentHints(spec.configurator.inputs, "configurator.inputs", errors);
    }
  }

  validateBuildSpecAuthoring(spec.authoring, "authoring", errors);

  if (spec.budget !== undefined) {
    if (!isObject(spec.budget)) {
      addError(errors, "budget", "expected object");
    } else {
      if (spec.budget.budgetRef !== undefined) {
        validateArtifactRef(spec.budget.budgetRef, "budget.budgetRef", errors);
      }
      if (spec.budget.priceListRef !== undefined) {
        validateArtifactRef(spec.budget.priceListRef, "budget.priceListRef", errors);
      }
      if (spec.budget.receiptRef !== undefined) {
        validateArtifactRef(spec.budget.receiptRef, "budget.receiptRef", errors);
      }
      if (spec.budget.budget !== undefined) {
        validateInlineArtifact(spec.budget.budget, "budget.budget", BUDGET_SCHEMA, errors);
      }
      if (spec.budget.priceList !== undefined) {
        validateInlineArtifact(spec.budget.priceList, "budget.priceList", PRICE_LIST_SCHEMA, errors);
      }
      if (spec.budget.receipt !== undefined) {
        validateInlineArtifact(spec.budget.receipt, "budget.receipt", BUDGET_RECEIPT_SCHEMA, errors);
      }
    }
  }

  if (spec.adapters !== undefined) {
    if (!isObject(spec.adapters)) {
      addError(errors, "adapters", "expected object");
    } else if (spec.adapters.capture !== undefined) {
      if (!Array.isArray(spec.adapters.capture)) {
        addError(errors, "adapters.capture", "expected array");
      } else {
        spec.adapters.capture.forEach((capture, index) => {
          const basePath = `adapters.capture[${index}]`;
          if (!isObject(capture)) {
            addError(errors, basePath, "expected object");
            return;
          }
          if (!isNonEmptyString(capture.adapter)) {
            addError(errors, `${basePath}.adapter`, "expected non-empty string");
          }
          if (capture.request !== undefined && !isObject(capture.request)) {
            addError(errors, `${basePath}.request`, "expected object");
          }
          validateOptionalString(capture.contentType, `${basePath}.contentType`, errors);
          validateOptionalString(capture.fixturePath, `${basePath}.fixturePath`, errors);
          if (capture.outputRef !== undefined) {
            validateArtifactRef(capture.outputRef, `${basePath}.outputRef`, errors);
          }
        });
      }
    }
  }

  return { ok: errors.length === 0, errors };
}
