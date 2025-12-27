export const EffectKind = Object.freeze({
  Log: 1,
  InitInvalid: 2,
  ActionRejected: 3,
  LimitReached: 4,
  LimitViolated: 5,
});

export function dispatchEffect(adapters, kind, value) {
  switch (kind) {
    case EffectKind.Log:
      if (!adapters?.logger?.log) {
        return { status: "deferred", reason: "missing_logger" };
      }
      return { status: "fulfilled", result: adapters.logger.log(value) };
    case EffectKind.InitInvalid:
      if (!adapters?.logger?.warn) {
        return { status: "deferred", reason: "missing_logger" };
      }
      return { status: "fulfilled", result: adapters.logger.warn("Init invalid", value) };
    case EffectKind.ActionRejected:
      if (!adapters?.logger?.warn) {
        return { status: "deferred", reason: "missing_logger" };
      }
      return { status: "fulfilled", result: adapters.logger.warn("Action rejected", value) };
    case EffectKind.LimitReached:
      if (!adapters?.logger?.warn) {
        return { status: "deferred", reason: "missing_logger" };
      }
      return { status: "fulfilled", result: adapters.logger.warn("Budget limit reached", value) };
    case EffectKind.LimitViolated:
      if (!adapters?.logger?.warn) {
        return { status: "deferred", reason: "missing_logger" };
      }
      return { status: "fulfilled", result: adapters.logger.warn("Budget limit violated", value) };
    default:
      if (!adapters?.logger?.warn) {
        return { status: "deferred", reason: "missing_logger" };
      }
      return { status: "fulfilled", result: adapters.logger.warn(`Unhandled effect kind: ${kind}`, value) };
  }
}
