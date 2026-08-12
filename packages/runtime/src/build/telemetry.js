const TELEMETRY_SCHEMA = "agent-kernel/TelemetryRecord";
const DEFAULT_CREATED_AT = "1970-01-01T00:00:00.000Z";

export function buildBuildTelemetryRecord({
  spec = null,
  status = "unknown",
  errors = [],
  artifactRefs = [],
  producedBy = "cli-build",
  clock,
  data,
} = {}) {
  const runId = spec?.meta?.runId || "run_unknown";
  const createdAt = clock ? clock() : (spec?.meta?.createdAt || DEFAULT_CREATED_AT);
  const metaId = `${spec?.meta?.id || `build_${runId}`}_telemetry`;
  const record = {
    schema: TELEMETRY_SCHEMA,
    schemaVersion: 1,
    meta: {
      id: metaId,
      runId,
      createdAt,
      producedBy,
    },
    scope: "run",
    data: { ...(data && typeof data === "object" ? data : {}), status },
  };

  if (spec?.meta?.correlationId) {
    record.meta.correlationId = spec.meta.correlationId;
  }
  if (spec?.meta?.source) {
    record.data.source = spec.meta.source;
  }
  if (errors.length > 0) {
    record.data.errors = errors;
  }
  if (artifactRefs.length > 0) {
    record.data.artifactRefs = artifactRefs;
  }

  return record;
}
