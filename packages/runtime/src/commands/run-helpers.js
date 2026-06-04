import { VITAL_KEYS } from "../contracts/domain-constants.js";

const DEFAULT_VITALS = Object.freeze({
  health: Object.freeze({ current: 10, max: 10, regen: 0 }),
  mana: Object.freeze({ current: 0, max: 0, regen: 0 }),
  stamina: Object.freeze({ current: 0, max: 0, regen: 0 }),
  durability: Object.freeze({ current: 0, max: 0, regen: 0 }),
});

export function normalizeArgList(value) {
  if (value === undefined || value === null) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

function cloneVitalRecords(source = DEFAULT_VITALS) {
  return VITAL_KEYS.reduce((acc, key) => {
    const record = source[key] || { current: 0, max: 0, regen: 0 };
    acc[key] = {
      current: Number.isFinite(record.current) ? record.current : 0,
      max: Number.isFinite(record.max) ? record.max : 0,
      regen: Number.isFinite(record.regen) ? record.regen : 0,
    };
    return acc;
  }, {});
}

function parseCoordinate(value, label) {
  const parts = String(value).split(",");
  if (parts.length < 2) {
    throw new Error(`${label} expects x,y`);
  }
  const x = Number(parts[0]);
  const y = Number(parts[1]);
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    throw new Error(`${label} expects numeric x,y`);
  }
  return { x, y };
}

function parseActorSpec(value) {
  const parts = String(value).split(",");
  if (parts.length < 3) {
    throw new Error("--actor expects id,x,y[,kind]");
  }
  const id = parts[0];
  const x = Number(parts[1]);
  const y = Number(parts[2]);
  if (!id) {
    throw new Error("--actor requires id");
  }
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    throw new Error("--actor expects numeric x,y");
  }
  const rawKind = (parts[3] || "motivated").toLowerCase();
  let kind;
  if (rawKind === "motivated") {
    kind = "motivated";
  } else if (rawKind === "ambulatory") {
    kind = "ambulatory";
  } else if (rawKind === "stationary") {
    kind = "stationary";
  } else {
    throw new Error(`--actor kind must be motivated/ambulatory/stationary, got ${rawKind}`);
  }
  return { id, position: { x, y }, kind };
}

function parseVitalSpec(value, withActorId) {
  const parts = String(value).split(",");
  const offset = withActorId ? 1 : 0;
  if (parts.length < 4 + offset) {
    throw new Error(withActorId ? "--vital expects actorId,vital,current,max,regen" : "--vital-default expects vital,current,max,regen");
  }
  const actorId = withActorId ? parts[0] : null;
  const vital = parts[offset].toLowerCase();
  const current = Number(parts[offset + 1]);
  const max = Number(parts[offset + 2]);
  const regen = Number(parts[offset + 3]);
  if (!VITAL_KEYS.includes(vital)) {
    throw new Error(`Unknown vital ${vital}`);
  }
  if (!Number.isFinite(current) || !Number.isFinite(max) || !Number.isFinite(regen)) {
    throw new Error("Vital values must be numeric");
  }
  return { actorId, vital, current, max, regen };
}

export function resolveVitalDefaults(rawSpecs = []) {
  if (!Array.isArray(rawSpecs) || rawSpecs.length === 0) {
    return null;
  }
  const vitalDefaults = cloneVitalRecords();
  rawSpecs.forEach((spec) => {
    const vital = parseVitalSpec(spec, false);
    vitalDefaults[vital.vital] = {
      current: vital.current,
      max: vital.max,
      regen: vital.regen,
    };
  });
  return vitalDefaults;
}

function getGridBounds(layoutData) {
  if (!layoutData) {
    return null;
  }
  if (Number.isFinite(layoutData.width) && Number.isFinite(layoutData.height)) {
    return { width: Number(layoutData.width), height: Number(layoutData.height) };
  }
  if (Array.isArray(layoutData.tiles)) {
    const height = layoutData.tiles.length;
    const width = layoutData.tiles.reduce((max, row) => Math.max(max, String(row).length), 0);
    return { width, height };
  }
  return null;
}

export function applyTileOverrides(simConfig, { walls = [], barriers = [], floors = [] } = {}) {
  if (!walls.length && !barriers.length && !floors.length) {
    return { simConfig, mutated: false };
  }
  const layout = simConfig?.layout;
  if (!layout || layout.kind !== "grid") {
    throw new Error("tile overrides require a grid layout");
  }
  const data = layout.data;
  if (!Array.isArray(data?.tiles)) {
    throw new Error("tile overrides require layout.data.tiles");
  }
  const rows = data.tiles.map((row) => String(row).split(""));
  const height = rows.length;
  const width = rows.reduce((max, row) => Math.max(max, row.length), 0);

  function setCell({ x, y }, char) {
    if (y < 0 || y >= height || x < 0 || x >= rows[y].length) {
      throw new Error(`tile override out of bounds at ${x},${y}`);
    }
    rows[y][x] = char;
  }

  walls.forEach((spec) => setCell(parseCoordinate(spec, "--tile-wall"), "#"));
  barriers.forEach((spec) => setCell(parseCoordinate(spec, "--tile-barrier"), "B"));
  floors.forEach((spec) => setCell(parseCoordinate(spec, "--tile-floor"), "."));

  data.tiles = rows.map((row) => row.join(""));
  data.width = data.width ?? width;
  data.height = data.height ?? height;
  data.legend = data.legend || {};
  if (!data.legend["#"]) data.legend["#"] = { tile: "wall" };
  if (!data.legend["."]) data.legend["."] = { tile: "floor" };
  if (barriers.length && !data.legend.B) data.legend.B = { tile: "barrier" };
  data.render = data.render || {};
  if (barriers.length && !data.render.barrier) data.render.barrier = "B";
  return { simConfig, mutated: true };
}

export function applyActorOverrides(initialState, simConfig, { actorSpecs = [], vitalSpecs = [], vitalDefaults } = {}) {
  if (!actorSpecs.length && !vitalSpecs.length && !vitalDefaults) {
    return { initialState, mutated: false };
  }
  const actors = Array.isArray(initialState.actors) ? initialState.actors.map((actor) => ({ ...actor })) : [];
  const byId = new Map();
  actors.forEach((actor, index) => {
    if (actor?.id) byId.set(actor.id, index);
  });

  const bounds = getGridBounds(simConfig?.layout?.data);
  if (!bounds) {
    throw new Error("actor overrides require layout bounds");
  }

  actorSpecs.forEach((spec) => {
    const actor = parseActorSpec(spec);
    if (
      actor.position.x < 0
      || actor.position.y < 0
      || actor.position.x >= bounds.width
      || actor.position.y >= bounds.height
    ) {
      throw new Error(`actor ${actor.id} out of bounds at ${actor.position.x},${actor.position.y}`);
    }
    if (byId.has(actor.id)) {
      const index = byId.get(actor.id);
      actors[index] = { ...actors[index], ...actor };
    } else {
      actors.push(actor);
      byId.set(actor.id, actors.length - 1);
    }
  });

  const defaultVitals = vitalDefaults || cloneVitalRecords();

  if (actorSpecs.length || vitalSpecs.length || vitalDefaults) {
    actors.forEach((actor) => {
      const existingVitals = actor.vitals && typeof actor.vitals === "object" ? actor.vitals : {};
      const vitals = {};
      VITAL_KEYS.forEach((key) => {
        const record = defaultVitals[key];
        const existing = existingVitals[key] || {};
        vitals[key] = {
          current: Number.isFinite(existing.current) ? existing.current : record.current,
          max: Number.isFinite(existing.max) ? existing.max : record.max,
          regen: Number.isFinite(existing.regen) ? existing.regen : record.regen,
        };
      });
      actor.vitals = vitals;
    });
  }

  vitalSpecs.forEach((spec) => {
    const vital = parseVitalSpec(spec, true);
    if (!vital.actorId || !byId.has(vital.actorId)) {
      throw new Error(`--vital references unknown actor ${vital.actorId || "unknown"}`);
    }
    const actor = actors[byId.get(vital.actorId)];
    actor.vitals = actor.vitals || cloneVitalRecords(defaultVitals);
    actor.vitals[vital.vital] = { current: vital.current, max: vital.max, regen: vital.regen };
  });

  actors.sort((a, b) => {
    const left = a?.id || "";
    const right = b?.id || "";
    if (left === right) {
      return 0;
    }
    return left < right ? -1 : 1;
  });
  initialState.actors = actors;
  return { initialState, mutated: true };
}

export function createDeterministicClock(seed) {
  let baseTime = 0;
  if (typeof seed === "string") {
    const parsed = Date.parse(seed);
    if (Number.isFinite(parsed)) {
      baseTime = parsed;
    }
  } else if (typeof seed === "number" && Number.isFinite(seed)) {
    baseTime = seed;
  }
  let offset = 0;
  return () => new Date(baseTime + offset++).toISOString();
}

export function resolveClockSeed(simConfig, initialState) {
  return simConfig?.meta?.createdAt
    || initialState?.meta?.createdAt
    || null;
}

export function baseVitalsFromActors(actors) {
  const baseVitalsByActorId = {};
  const list = Array.isArray(actors) ? actors : [];
  list.forEach((actor) => {
    if (!actor?.id) {
      return;
    }
    if (actor.vitals) {
      baseVitalsByActorId[actor.id] = actor.vitals;
    }
  });
  return baseVitalsByActorId;
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function isRuntimeDecisionRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) && typeof value.selectedActionId === "string";
}

function isRuntimeDecisionCaptureArtifact(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  if (value.schema !== "agent-kernel/CapturedInputArtifact") {
    return false;
  }
  const payload = value.payload;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return false;
  }
  const envelope = payload.requestEnvelope;
  if (!envelope || typeof envelope !== "object" || Array.isArray(envelope)) {
    return false;
  }
  return envelope.contract === "runtime-decision-v1";
}

function resolveRuntimeDecisionProvider(result) {
  if (typeof result?.provider === "string" && result.provider.trim()) {
    return result.provider.trim();
  }
  if (result?.provider && typeof result.provider.selected === "string" && result.provider.selected.trim()) {
    return result.provider.selected.trim();
  }
  return "solver";
}

export function collectRuntimeDecisionRecords(frames = []) {
  const records = [];
  const list = Array.isArray(frames) ? frames : [];
  list.forEach((frame) => {
    const phase = frame?.phaseDetail || frame?.phase || null;
    const solverResults = Array.isArray(frame?.solverResults) ? frame.solverResults : [];
    solverResults.forEach((result) => {
      if (!isRuntimeDecisionRecord(result?.decision)) {
        return;
      }
      const action = result?.action && typeof result.action === "object" && !Array.isArray(result.action)
        ? result.action
        : null;
      const record = {
        tick: Number.isInteger(frame?.tick) ? frame.tick : action?.tick ?? null,
        phase,
        provider: resolveRuntimeDecisionProvider(result),
        decisionKind: typeof result.decision.decisionKind === "string" ? result.decision.decisionKind : "next_move",
        selectedActionId: result.decision.selectedActionId,
      };
      if (typeof result.decision.selectedTargetId === "string" && result.decision.selectedTargetId.trim()) {
        record.selectedTargetId = result.decision.selectedTargetId.trim();
      }
      if (Number.isFinite(result.decision.confidence)) {
        record.confidence = Number(result.decision.confidence);
      }
      if (Array.isArray(result.decision.rationaleTags) && result.decision.rationaleTags.length > 0) {
        record.rationaleTags = result.decision.rationaleTags.slice();
      }
      if (action) {
        record.action = {
          actorId: action.actorId || null,
          kind: action.kind || null,
          tick: Number.isInteger(action.tick) ? action.tick : record.tick,
          params: cloneJson(action.params || {}),
        };
      }
      if (result?.captureRef && typeof result.captureRef === "object") {
        record.captureRef = cloneJson(result.captureRef);
      }
      records.push(record);
    });
  });
  return records;
}

export function collectRuntimeDecisionCaptureRecords(frames = []) {
  const records = [];
  const list = Array.isArray(frames) ? frames : [];
  const seen = new Set();
  list.forEach((frame) => {
    const tick = Number.isInteger(frame?.tick) ? frame.tick : null;
    const artifacts = Array.isArray(frame?.personaArtifacts) ? frame.personaArtifacts : [];
    artifacts.forEach((artifact, index) => {
      if (!isRuntimeDecisionCaptureArtifact(artifact)) {
        return;
      }
      const adapter = typeof artifact?.source?.adapter === "string" && artifact.source.adapter.trim()
        ? artifact.source.adapter.trim()
        : "unknown";
      const captureId = typeof artifact?.meta?.id === "string" && artifact.meta.id.trim()
        ? artifact.meta.id.trim()
        : `runtime_capture_${tick ?? "unknown"}_${index + 1}`;
      const dedupeKey = `${captureId}:${adapter}`;
      if (seen.has(dedupeKey)) {
        return;
      }
      seen.add(dedupeKey);

      const payload = artifact.payload && typeof artifact.payload === "object" ? artifact.payload : {};
      const responseParsed = payload.responseParsed && typeof payload.responseParsed === "object"
        ? payload.responseParsed
        : null;
      const decision = responseParsed?.decision && typeof responseParsed.decision === "object"
        ? responseParsed.decision
        : responseParsed && typeof responseParsed === "object"
          ? responseParsed
          : null;
      const envelope = payload.requestEnvelope && typeof payload.requestEnvelope === "object"
        ? payload.requestEnvelope
        : {};

      const record = {
        tick,
        adapter,
        captureRef: {
          id: captureId,
          schema: artifact.schema,
          schemaVersion: artifact.schemaVersion,
        },
      };
      if (decision && typeof decision.selectedActionId === "string" && decision.selectedActionId.trim()) {
        record.selectedActionId = decision.selectedActionId.trim();
      }
      if (decision && typeof decision.decisionKind === "string" && decision.decisionKind.trim()) {
        record.decisionKind = decision.decisionKind.trim();
      } else if (typeof envelope.decisionKind === "string" && envelope.decisionKind.trim()) {
        record.decisionKind = envelope.decisionKind.trim();
      }
      const actorId = envelope?.actor?.id;
      if (typeof actorId === "string" && actorId.trim()) {
        record.actorId = actorId.trim();
      }
      records.push(record);
    });
  });
  return records;
}

export function summarizeRuntimeDecisions(frames = []) {
  const decisions = collectRuntimeDecisionRecords(frames);
  const byActor = {};
  const byActionKind = {};
  decisions.forEach((decision) => {
    const actorId = decision.action?.actorId || "unknown";
    const actionKind = decision.action?.kind || "unknown";
    byActor[actorId] = (byActor[actorId] || 0) + 1;
    byActionKind[actionKind] = (byActionKind[actionKind] || 0) + 1;
  });
  return {
    total: decisions.length,
    decisionDrivenActions: decisions.filter((decision) => decision.action?.kind).length,
    byActor,
    byActionKind,
    decisions,
  };
}

export function summarizeRuntimeDecisionCaptures(frames = []) {
  const captures = collectRuntimeDecisionCaptureRecords(frames);
  const byAdapter = {};
  const byActor = {};
  captures.forEach((capture) => {
    const adapter = capture.adapter || "unknown";
    byAdapter[adapter] = (byAdapter[adapter] || 0) + 1;
    const actorId = capture.actorId || "unknown";
    byActor[actorId] = (byActor[actorId] || 0) + 1;
  });
  return {
    total: captures.length,
    withSelectedActionId: captures.filter((capture) => typeof capture.selectedActionId === "string" && capture.selectedActionId.length > 0).length,
    byAdapter,
    byActor,
    captures,
  };
}

export function compareRuntimeDecisionSummaries(expectedFrames = [], actualFrames = []) {
  const expected = summarizeRuntimeDecisions(expectedFrames);
  const actual = summarizeRuntimeDecisions(actualFrames);
  const max = Math.max(expected.decisions.length, actual.decisions.length);
  let mismatchCount = 0;
  let firstMismatch = null;
  for (let i = 0; i < max; i += 1) {
    const left = expected.decisions[i] || null;
    const right = actual.decisions[i] || null;
    if (JSON.stringify(left) !== JSON.stringify(right)) {
      mismatchCount += 1;
      if (!firstMismatch) {
        firstMismatch = {
          index: i,
          expected: left,
          actual: right,
        };
      }
    }
  }
  return {
    match: mismatchCount === 0,
    mismatches: mismatchCount,
    firstMismatch,
    expectedCount: expected.total,
    actualCount: actual.total,
    expectedDecisionDrivenActions: expected.decisionDrivenActions,
    actualDecisionDrivenActions: actual.decisionDrivenActions,
    expected: expected.decisions,
    actual: actual.decisions,
  };
}

export function compareRuntimeDecisionCaptureSummaries(expectedFrames = [], actualFrames = []) {
  const expected = summarizeRuntimeDecisionCaptures(expectedFrames);
  const actual = summarizeRuntimeDecisionCaptures(actualFrames);
  const max = Math.max(expected.captures.length, actual.captures.length);
  let mismatchCount = 0;
  let firstMismatch = null;
  for (let i = 0; i < max; i += 1) {
    const left = expected.captures[i] || null;
    const right = actual.captures[i] || null;
    if (JSON.stringify(left) !== JSON.stringify(right)) {
      mismatchCount += 1;
      if (!firstMismatch) {
        firstMismatch = {
          index: i,
          expected: left,
          actual: right,
        };
      }
    }
  }
  return {
    match: mismatchCount === 0,
    mismatches: mismatchCount,
    firstMismatch,
    expectedCount: expected.total,
    actualCount: actual.total,
    expectedWithSelectedActionId: expected.withSelectedActionId,
    actualWithSelectedActionId: actual.withSelectedActionId,
    expected: expected.captures,
    actual: actual.captures,
  };
}

export function compareFrameSummaries(expectedSummaries = [], actualSummaries = []) {
  const maxFrames = Math.max(expectedSummaries.length, actualSummaries.length);
  let mismatchCount = 0;
  let firstMismatch = null;
  for (let i = 0; i < maxFrames; i += 1) {
    const expected = expectedSummaries[i];
    const actual = actualSummaries[i];
    if (!expected || !actual) {
      mismatchCount += 1;
      if (!firstMismatch) {
        firstMismatch = {
          index: i,
          reason: !expected ? "missing_expected_frame" : "missing_actual_frame",
          expected: expected || null,
          actual: actual || null,
        };
      }
      continue;
    }
    const matches = JSON.stringify(expected) === JSON.stringify(actual);
    if (!matches) {
      mismatchCount += 1;
      if (!firstMismatch) {
        firstMismatch = { index: i, reason: "frame_mismatch", expected, actual };
      }
    }
  }
  return {
    match: mismatchCount === 0,
    expectedFrames: expectedSummaries.length,
    actualFrames: actualSummaries.length,
    mismatches: mismatchCount,
    firstMismatch,
  };
}

export function summarizeFrame(frame) {
  const emittedEffects = Array.isArray(frame?.emittedEffects) ? frame.emittedEffects.length : 0;
  const fulfilledEffects = Array.isArray(frame?.fulfilledEffects) ? frame.fulfilledEffects.length : 0;
  const runtimeDecisionSummary = summarizeRuntimeDecisions([frame]);
  return {
    tick: frame?.tick,
    phase: frame?.phase,
    phaseDetail: frame?.phaseDetail || null,
    emittedEffects,
    fulfilledEffects,
    runtimeDecisions: runtimeDecisionSummary.total,
    decisionDrivenActions: runtimeDecisionSummary.decisionDrivenActions,
  };
}
