const EFFECT_SCHEMA = "agent-kernel/Effect";
const TARGET_ADAPTER_HINTS = ["fixtures", "ipfs", "ollama"];
const REQUEST_DETAIL_MASK = 0xff;

export const EffectKind = Object.freeze({
  Log: 1,
  InitInvalid: 2,
  ActionRejected: 3,
  LimitReached: 4,
  LimitViolated: 5,
  NeedExternalFact: 6,
  Telemetry: 7,
  SolverRequest: 8,
  EffectFulfilled: 9,
  EffectDeferred: 10,
});

function buildEffectId(tick, index, kind, value) {
  return `eff_${tick}_${index}_${kind}_${value}`;
}

function decodeRequestPayload(value) {
  return {
    requestSeq: value >> 8,
    detail: value & REQUEST_DETAIL_MASK,
  };
}

function buildRequestId(prefix, seq) {
  return `${prefix}-${seq}`;
}

export function buildEffectFromCore({ tick, index, kind, value }) {
  const base = {
    schema: EFFECT_SCHEMA,
    schemaVersion: 1,
    id: buildEffectId(tick, index, kind, value),
    tick,
    fulfillment: "deterministic",
    personaRef: "core",
    tags: ["core"],
  };

  switch (kind) {
    case EffectKind.Log: {
      const severity = value === 0 ? "debug" : value === 1 ? "info" : value === 2 ? "warn" : "error";
      return {
        ...base,
        kind: "log",
        severity,
        data: { counter: value, message: `log#${value}` },
      };
    }
    case EffectKind.InitInvalid:
      return {
        ...base,
        kind: "log",
        severity: "error",
        data: { reason: "init_invalid", code: value },
      };
    case EffectKind.ActionRejected:
      return {
        ...base,
        kind: "log",
        severity: "warn",
        data: { reason: "action_rejected", code: value },
      };
    case EffectKind.LimitReached:
      return {
        ...base,
        kind: "limit_violation",
        severity: "warn",
        data: { status: "reached", spent: value, category: "default" },
      };
    case EffectKind.LimitViolated:
      return {
        ...base,
        kind: "limit_violation",
        severity: "error",
        data: { status: "violated", spent: value, category: "default" },
      };
    case EffectKind.NeedExternalFact: {
      const { requestSeq, detail } = decodeRequestPayload(value);
      const hasSourceRef = (detail & 1) === 0;
      const targetAdapter = TARGET_ADAPTER_HINTS[detail % TARGET_ADAPTER_HINTS.length];
      return {
        ...base,
        id: buildEffectId(tick, index, "need_external_fact", value),
        kind: "need_external_fact",
        requestId: buildRequestId("fact", requestSeq),
        targetAdapter,
        data: { query: `fact-${detail}`, detail },
        sourceRef: hasSourceRef
          ? { id: `fact-${detail}`, schema: "agent-kernel/IntentEnvelope", schemaVersion: 1 }
          : undefined,
        fulfillment: hasSourceRef ? "deterministic" : "deferred",
      };
    }
    case EffectKind.Telemetry:
      return {
        ...base,
        kind: "telemetry",
        data: { metric: value, scope: "core" },
      };
    case EffectKind.SolverRequest: {
      const { requestSeq, detail } = decodeRequestPayload(value);
      return {
        ...base,
        id: buildEffectId(tick, index, "solver_request", value),
        kind: "solver_request",
        requestId: buildRequestId("solver", requestSeq),
        targetAdapter: "solver",
        data: { problem: { language: "custom", data: { difficulty: detail } } },
      };
    }
    case EffectKind.EffectFulfilled:
      return {
        ...base,
        kind: "effect_fulfilled",
        requestId: buildRequestId("fact", value),
        data: { status: "fulfilled" },
        fulfillment: "deterministic",
      };
    case EffectKind.EffectDeferred:
      return {
        ...base,
        kind: "effect_deferred",
        requestId: buildRequestId("fact", value),
        data: { status: "deferred" },
        fulfillment: "deferred",
      };
    default:
      return {
        ...base,
        kind: "custom",
        data: { kind, value },
      };
  }
}

function normalizeKind(effect) {
  if (!effect) return "custom";
  const kind = effect.kind;
  if (typeof kind === "string") return kind;
  if (typeof kind === "number") return `${kind}`;
  if (kind && typeof kind.kind === "string") return kind.kind;
  if (kind && typeof kind.kind === "number") return `${kind.kind}`;
  if (kind && typeof kind.type === "string") return kind.type;
  if (kind && typeof kind.type === "number") return `${kind.type}`;
  if (kind && typeof kind.name === "string") return kind.name;
  if (kind && typeof kind === "object") {
    const stringEntries = Object.values(kind).filter((value) => typeof value === "string");
    if (stringEntries.length === 1) {
      return stringEntries[0];
    }
  }
  return "custom";
}

export function dispatchEffect(adapters, effect) {
  if (!effect) {
    return { status: "deferred", reason: "invalid_effect" };
  }

  const normalized = normalizeKind(effect);
  const kind = typeof normalized === "string" ? normalized : `${normalized}`;

  switch (kind) {
    case "log": {
      const logger = adapters?.logger;
      if (!logger) {
        return { status: "deferred", reason: "missing_logger" };
      }
      const severity = effect.severity || "info";
      const message = (effect.data && effect.data.message) || "log";
      const logFn = severity === "error"
        ? logger.error || logger.warn || logger.log
        : severity === "warn"
          ? logger.warn || logger.log
          : logger.log;
      if (!logFn) {
        return { status: "deferred", reason: "missing_logger" };
      }
      return { status: "fulfilled", result: logFn.call(logger, message, effect.data) };
    }
    case "telemetry":
      if (!adapters?.telemetry?.emit) {
        return { status: "deferred", reason: "missing_telemetry" };
      }
      return { status: "fulfilled", result: adapters.telemetry.emit(effect) };
    case "solver_request":
      if (!adapters?.solver?.solve) {
        return { status: "deferred", reason: "missing_solver" };
      }
      return { status: "fulfilled", result: adapters.solver.solve(effect) };
    case "limit_violation":
      if (!adapters?.logger?.warn) {
        return { status: "deferred", reason: "missing_logger" };
      }
      return { status: "fulfilled", result: adapters.logger.warn("Budget limit", effect.data) };
    case "effect_fulfilled":
    case "effect_deferred":
      return { status: "fulfilled", result: effect.data };
    default:
      if (!adapters?.logger?.warn) {
        return { status: "deferred", reason: "missing_logger" };
      }
      return {
        status: "fulfilled",
        result: adapters.logger.warn(`Unhandled effect kind: ${kind}`, effect.data ?? effect),
      };
  }
}
