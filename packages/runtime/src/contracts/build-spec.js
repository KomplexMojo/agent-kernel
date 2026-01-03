export const BUILD_SPEC_SCHEMA = "agent-kernel/BuildSpec";
export const BUILD_SPEC_SCHEMA_VERSION = 1;

const BUDGET_SCHEMA = "agent-kernel/BudgetArtifact";
const PRICE_LIST_SCHEMA = "agent-kernel/PriceList";
const BUDGET_RECEIPT_SCHEMA = "agent-kernel/BudgetReceiptArtifact";

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
