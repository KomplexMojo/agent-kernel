const BUILD_SPEC_SCHEMA = "agent-kernel/BuildSpec";
const GAMEPLAY_BUNDLE_SCHEMA = "agent-kernel/GameplayBundle";
const SIM_CONFIG_SCHEMA = "agent-kernel/SimConfigArtifact";
const INITIAL_STATE_SCHEMA = "agent-kernel/InitialStateArtifact";

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasGameplayArtifacts(payload) {
  if (!Array.isArray(payload?.artifacts)) return false;
  const schemas = payload.artifacts.map((entry) => entry?.schema);
  return schemas.includes(SIM_CONFIG_SCHEMA) || schemas.includes(INITIAL_STATE_SCHEMA);
}

export function classifyIngestionPayload(payload) {
  if (Array.isArray(payload)) {
    return "card_set";
  }
  if (!isPlainObject(payload)) {
    return "unknown";
  }
  if (payload.schema === BUILD_SPEC_SCHEMA) {
    return "build_spec";
  }
  if (payload.schema === GAMEPLAY_BUNDLE_SCHEMA || hasGameplayArtifacts(payload)) {
    return "run_bundle";
  }
  if (Array.isArray(payload.cardSet)) {
    return "card_set";
  }
  if (Array.isArray(payload.rooms) || Array.isArray(payload.actors)) {
    return "summary";
  }
  return "unknown";
}

export function createPhaserSurfaceIngestion({ cardBuilder, gameplay } = {}) {
  async function ingest(payload) {
    const kind = classifyIngestionPayload(payload);
    switch (kind) {
      case "build_spec": {
        const result = await cardBuilder.loadBuildSpec(payload);
        return { ...result, ok: result?.ok === true, surface: "card-builder", kind };
      }
      case "card_set": {
        const cards = Array.isArray(payload) ? payload : payload.cardSet;
        const applied = cardBuilder.setCards(cards);
        return { ok: applied === true, surface: "card-builder", kind };
      }
      case "summary": {
        const applied = cardBuilder.loadSummary?.(payload);
        return { ok: applied === true, surface: "card-builder", kind };
      }
      case "run_bundle": {
        if (!Array.isArray(payload.artifacts)) {
          return { ok: false, reason: "malformed_run_bundle", surface: "gameplay", kind };
        }
        const loaded = await gameplay.loadRun(payload);
        return { ok: loaded !== false, surface: "gameplay", kind };
      }
      default:
        return { ok: false, reason: "unknown_payload", kind };
    }
  }

  return { ingest };
}
