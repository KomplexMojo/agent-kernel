'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const { canonicalJson, loadExecutionCatalog } = require('./execution-catalog');

const RESULT_SCHEMA_VERSION = 'agent-kernel-execution-result/v1';
const REQUIRED_FILES = Object.freeze({
  simConfig: 'sim-config.json',
  initialState: 'initial-state.json',
  tickFrames: 'tick-frames.json',
  effectLog: 'effects-log.json',
  runSummary: 'run-summary.json',
  actionLog: 'action-log.json',
});

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function clamp(value, minimum = 0, maximum = 1) {
  return Math.max(minimum, Math.min(maximum, value));
}

function metric(value, unit, evidence = 'artifact') {
  return Number.isFinite(value)
    ? { status: 'available', value, unit, evidence }
    : { status: 'evidence_unavailable', unit, evidence, reason: 'public artifacts do not expose this metric' };
}

function unavailable(unit, reason, evidence = 'artifact') {
  return { status: 'evidence_unavailable', unit, evidence, reason };
}

function position(value) {
  const candidate = value?.to || value?.position || value;
  return Number.isInteger(candidate?.x) && Number.isInteger(candidate?.y)
    ? { x: candidate.x, y: candidate.y }
    : null;
}

function targetId(value) {
  const target = value?.targetId ?? value?.targetActorId ?? value?.target;
  return typeof target === 'string' ? target : isObject(target) && typeof target.id === 'string' ? target.id : null;
}

function artifactStats(artifacts) {
  const frames = Array.isArray(artifacts.tickFrames) ? artifacts.tickFrames : [];
  const actors = Array.isArray(artifacts.initialState?.actors) ? artifacts.initialState.actors : [];
  const actions = frames.flatMap((frame) => Array.isArray(frame?.acceptedActions)
    ? frame.acceptedActions.map((action) => ({ ...action, frameTick: frame.tick })) : []);
  const moves = actions.filter((action) => action.kind === 'move').map((action) => ({
    actorId: action.actorId,
    tick: action.tick ?? action.frameTick,
    to: position(action.params),
  })).filter((move) => move.to);
  const events = frames.flatMap((frame) => Array.isArray(frame?.emittedEvents)
    ? frame.emittedEvents.map((event) => ({ ...event, frameTick: frame.tick })) : []);
  const effects = frames.flatMap((frame) => Array.isArray(frame?.emittedEffects)
    ? frame.emittedEffects.map((effect) => ({ ...effect, frameTick: frame.tick })) : []);
  const fulfilled = frames.flatMap((frame) => Array.isArray(frame?.fulfilledEffects)
    ? frame.fulfilledEffects.map((entry) => ({ ...entry, frameTick: frame.tick })) : []);
  const rejections = frames.flatMap((frame) => Array.isArray(frame?.preCoreRejections)
    ? frame.preCoreRejections.map((entry) => ({ ...entry, frameTick: frame.tick })) : []);
  const requestedTicks = artifacts.requestedTicks ?? artifacts.runSummary?.metrics?.ticks ?? frames.length;
  const rooms = Array.isArray(artifacts.simConfig?.layout?.data?.rooms) ? artifacts.simConfig.layout.data.rooms : [];
  const tiles = artifacts.simConfig?.layout?.data?.tiles;
  const walkable = Array.isArray(tiles)
    ? tiles.reduce((count, row) => count + [...String(row)].filter((cell) => !['#', 'B'].includes(cell)).length, 0)
    : null;
  const roomFor = (point) => rooms.find((room) => point && point.x >= room.x && point.x < room.x + room.width
    && point.y >= room.y && point.y < room.y + room.height)?.id;
  const moveKeys = new Set(moves.map((move) => `${move.to.x},${move.to.y}`));
  const visitedRooms = new Set(moves.map((move) => roomFor(move.to)).filter(Boolean));
  const actorActions = new Map(actors.map((actor) => [actor.id, 0]));
  for (const action of actions) actorActions.set(action.actorId, (actorActions.get(action.actorId) || 0) + 1);
  const activeTicks = new Set(actions.map((action) => action.tick ?? action.frameTick));
  const progressTicks = [...new Set(moves.map((move) => move.tick))].sort((a, b) => a - b);
  let longestStall = 0;
  let prior = 0;
  for (const tick of [...progressTicks, requestedTicks]) {
    longestStall = Math.max(longestStall, tick - prior - (tick === requestedTicks ? 0 : 1));
    prior = tick;
  }
  const damage = [...events, ...effects].reduce((sum, entry) => {
    const value = entry?.data?.damage ?? entry?.data?.amount;
    const isDamage = String(entry?.kind || '').toLowerCase().includes('damage');
    return sum + (isDamage && Number.isFinite(value) && value > 0 ? value : 0);
  }, 0);
  const interactions = [...actions, ...events, ...effects].filter((entry) => targetId(entry.params || entry.data || entry));
  const firstInteractionTick = interactions.reduce((minimum, entry) => Math.min(
    minimum, entry.tick ?? entry.frameTick ?? requestedTicks + 1,
  ), requestedTicks + 1);
  const stationary = actors.filter((actor) => actor.kind === 'stationary' || actor.motivation?.kind === 'stationary');
  const stationaryMoved = stationary.filter((actor) => moves.some((move) => move.actorId === actor.id)).length;
  const counts = [...actorActions.values()];
  const maximumActions = Math.max(0, ...counts);
  const minimumActions = counts.length ? Math.min(...counts) : 0;
  const fulfilledCount = fulfilled.filter((entry) => entry.status === 'fulfilled').length;
  const effectKinds = new Set([...effects, ...fulfilled.map((entry) => entry.effect)].map((entry) => entry?.kind).filter(Boolean));
  const actionKinds = new Set(actions.map((action) => action.kind).filter(Boolean));
  const interactionEdges = new Set(interactions.map((entry) => {
    const source = entry.actorId || entry.sourceId || entry.data?.sourceId || 'unknown';
    return `${source}->${targetId(entry.params || entry.data || entry)}`;
  }));
  const rejectionSignatures = rejections.map((entry) => `${entry.action?.actorId || '?'}:${entry.action?.kind || '?'}:${entry.reason}`);
  const repeatedRejections = rejectionSignatures.length - new Set(rejectionSignatures).size;
  const actorActivity = Object.fromEntries(statsActorActivity(actors, actions, requestedTicks));
  const interactionClasses = {
    movement: moves.length,
    combat: [...actions, ...events, ...effects].filter((entry) => /attack|damage|combat|cast/i.test(entry.kind || '')).length,
    hazard: [...events, ...effects].filter((entry) => /hazard|push|pull|draw|emit/i.test(entry.kind || '')).length,
    resource: [...events, ...effects].filter((entry) => /resource|pickup|consume/i.test(entry.kind || '')).length,
  };
  const artifactBytes = artifacts.artifactBytes ?? Buffer.byteLength(JSON.stringify({
    frames, effectLog: artifacts.effectLog, runSummary: artifacts.runSummary, actionLog: artifacts.actionLog,
  }));
  return {
    frames, actors, actions, moves, events, effects, fulfilled, rejections, requestedTicks, rooms, tiles,
    walkable, moveKeys, visitedRooms, actorActions, activeTicks, longestStall, damage, interactions, firstInteractionTick,
    stationary, stationaryMoved, counts, maximumActions, minimumActions, fulfilledCount, effectKinds,
    actionKinds, interactionEdges, repeatedRejections, actorActivity, interactionClasses, artifactBytes,
  };
}

function statsActorActivity(actors, actions, requestedTicks) {
  return actors.map((actor) => {
    const ticks = [...new Set(actions.filter((action) => action.actorId === actor.id)
      .map((action) => action.tick ?? action.frameTick).filter(Number.isFinite))].sort((a, b) => a - b);
    let longestGap = 0;
    let prior = 0;
    for (const tick of [...ticks, requestedTicks + 1]) {
      longestGap = Math.max(longestGap, tick - prior - 1);
      prior = tick;
    }
    return [actor.id, { actions: actions.filter((action) => action.actorId === actor.id).length, longestGap }];
  });
}

function extractExecutionMetrics(artifacts, contract) {
  const stats = artifactStats(artifacts);
  const units = Object.fromEntries(Object.entries(contract.metrics).map(([name, value]) => [name, value.unit]));
  const results = Object.fromEntries(Object.entries(units).map(([name, unit]) => [name,
    unavailable(unit, 'no public-artifact extractor is defined for this metric')]));
  const actorCount = stats.actors.length;
  const participation = actorCount ? [...stats.actorActions.values()].filter((count) => count > 0).length / actorCount : NaN;
  const fairness = actorCount && stats.maximumActions
    ? clamp(1 - ((stats.maximumActions - stats.minimumActions) / stats.maximumActions)) : participation;
  const mobile = stats.actors.filter((actor) => !stats.stationary.includes(actor));
  const motivationMatches = stats.actors.filter((actor) => stats.stationary.includes(actor)
    ? !stats.moves.some((move) => move.actorId === actor.id)
    : stats.moves.some((move) => move.actorId === actor.id)).length;
  const subsystemCount = [stats.moves.length > 0, stats.damage > 0 || stats.interactions.length > 0,
    stats.effectKinds.size > 0, [...stats.events, ...stats.effects].some((entry) => /resource|pickup|consume/i.test(entry.kind || ''))]
    .filter(Boolean).length;
  const firstPickup = [...stats.events, ...stats.effects].filter((entry) => /resource|pickup|consume/i.test(entry.kind || ''))
    .reduce((minimum, entry) => Math.min(minimum, entry.tick ?? entry.frameTick ?? stats.requestedTicks + 1), stats.requestedTicks + 1);
  const firstActionTick = stats.actions.reduce((minimum, entry) => Math.min(
    minimum, entry.tick ?? entry.frameTick ?? stats.requestedTicks + 1,
  ), stats.requestedTicks + 1);
  const maxActorStarvation = Math.max(0, ...Object.values(stats.actorActivity).map((entry) => entry.longestGap));
  Object.assign(results, {
    first_action_tick: metric(firstActionTick, units.first_action_tick),
    accepted_move_count: metric(stats.moves.length, units.accepted_move_count),
    max_progress_stall: metric(stats.longestStall, units.max_progress_stall),
    visited_room_count: metric(stats.visitedRooms.size, units.visited_room_count),
    movement_count: metric(stats.moves.length, units.movement_count),
    decision_count: metric(stats.actions.length, units.decision_count),
    max_actor_starvation: metric(maxActorStarvation, units.max_actor_starvation),
    unique_tile_coverage: metric(stats.walkable ? stats.moveKeys.size / stats.walkable : NaN, units.unique_tile_coverage),
    active_tick_ratio: metric(stats.requestedTicks ? stats.activeTicks.size / stats.requestedTicks : NaN, units.active_tick_ratio),
    no_stall_margin: metric(stats.longestStall, units.no_stall_margin),
    room_coverage: metric(stats.rooms.length ? stats.visitedRooms.size / stats.rooms.length : NaN, units.room_coverage),
    checkpoint_progress: metric(stats.walkable ? stats.moveKeys.size / stats.walkable : NaN, units.checkpoint_progress),
    patrol_recurrence: metric(Math.max(0, stats.moves.length - stats.moveKeys.size), units.patrol_recurrence),
    stationary_fidelity: metric(stats.stationary.length ? 1 - (stats.stationaryMoved / stats.stationary.length) : NaN, units.stationary_fidelity),
    participation: metric(participation, units.participation),
    roster_fairness: metric(fairness, units.roster_fairness),
    motivation_fidelity: metric(actorCount ? motivationMatches / actorCount : NaN, units.motivation_fidelity),
    contact_latency: metric(stats.firstInteractionTick, units.contact_latency),
    interaction_damage: metric(stats.damage, units.interaction_damage),
    combat_activity: metric(stats.actions.filter((action) => /attack|cast/i.test(action.kind || '')).length + stats.damage, units.combat_activity),
    target_interaction: metric(stats.interactionEdges.size, units.target_interaction),
    damage_progress: metric(stats.damage > 0 ? clamp(stats.damage / Math.max(1, ...stats.actors.map((actor) => actor.vitals?.health?.max || 0))) : 0, units.damage_progress),
    behavioral_diversity: metric(stats.actionKinds.size, units.behavioral_diversity),
    interaction_graph: metric(stats.interactionEdges.size, units.interaction_graph),
    impact_evidence: metric(stats.fulfilledCount + (stats.damage > 0 ? 1 : 0), units.impact_evidence),
    target_correctness: metric(stats.fulfilled.length ? stats.fulfilled.filter((entry) => targetId(entry.effect?.data || entry.result || entry.effect)).length / stats.fulfilled.length : NaN, units.target_correctness),
    reroute_progress: metric(stats.moves.length ? clamp(stats.moveKeys.size / Math.max(1, stats.moves.length)) : 0, units.reroute_progress),
    rejection_quality: metric(stats.rejections.length ? 1 - (stats.repeatedRejections / stats.rejections.length) : 1, units.rejection_quality),
    pickup_latency: metric(firstPickup, units.pickup_latency),
    subsystem_coverage: metric(subsystemCount, units.subsystem_coverage),
    activity_throughput: metric(stats.requestedTicks ? stats.actions.length / stats.requestedTicks : NaN, units.activity_throughput),
    artifact_growth: metric(stats.requestedTicks ? stats.artifactBytes / stats.requestedTicks : NaN, units.artifact_growth),
    determinism: artifacts.replayTickFrames ? metric(normalizedFrameHash(stats.frames) === normalizedFrameHash(artifacts.replayTickFrames) ? 1 : 0, units.determinism) : unavailable(units.determinism, 'same-seed replay frames were not supplied'),
    structural_validity: metric(1, units.structural_validity),
    performance: metric(artifacts.wallTimeMs && stats.requestedTicks ? artifacts.wallTimeMs / stats.requestedTicks : NaN, units.performance),
    liveness: metric(stats.requestedTicks ? stats.activeTicks.size / stats.requestedTicks : NaN, units.liveness),
    spatial_progress: metric(stats.walkable ? stats.moveKeys.size / stats.walkable : NaN, units.spatial_progress),
  });
  return { metrics: results, stats };
}

function normalizedFrameHash(frames) {
  const normalized = (Array.isArray(frames) ? frames : []).map(({ meta, ...frame }) => frame);
  return crypto.createHash('sha256').update(canonicalJson(normalized)).digest('hex');
}

function finitePublicValues(value) {
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(finitePublicValues);
  if (isObject(value)) return Object.values(value).every(finitePublicValues);
  return true;
}

function evaluateInvariants(artifacts, scenario, stats) {
  const frameTicks = stats.frames.map((frame) => frame.tick);
  const requiredDetails = ['observe', 'decide', 'apply', 'emit', 'summarize'];
  const nonInitFrames = stats.frames.filter((frame) => frame.phaseDetail !== 'init');
  const monotonicTicks = frameTicks.every((tick, index) => Number.isInteger(tick)
    && (index === 0 || tick >= frameTicks[index - 1]));
  const phasesComplete = Array.from({ length: stats.requestedTicks }, (_, index) => index + 1).every((tick) => {
    const details = nonInitFrames.filter((frame) => frame.tick === tick).map((frame) => frame.phaseDetail);
    return details.length === requiredDetails.length && requiredDetails.every((detail, offset) => details[offset] === detail);
  });
  const monotonic = monotonicTicks && phasesComplete
    && stats.frames.every((frame) => typeof frame.phase === 'string' && frame.phase.length > 0);
  const width = artifacts.simConfig?.layout?.data?.width;
  const height = artifacts.simConfig?.layout?.data?.height;
  const legal = (point) => point && point.x >= 0 && point.y >= 0 && point.x < width && point.y < height
    && (!Array.isArray(stats.tiles) || !['#', 'B'].includes(String(stats.tiles[point.y])?.[point.x]));
  const knownActors = new Set(stats.actors.map((actor) => actor.id));
  const effectValid = stats.fulfilled.every((entry) => isObject(entry.effect)
    && ['fulfilled', 'deferred', 'rejected'].includes(entry.status));
  const checks = {
    run_completed: artifacts.runSummary?.outcome === 'success'
      && Math.max(0, ...frameTicks) === stats.requestedTicks,
    tick_monotonicity: monotonic,
    actor_legality: Number.isInteger(width) && Number.isInteger(height)
      ? [...stats.actors.map((actor) => position(actor.position)), ...stats.moves.map((move) => move.to)].every(legal) : null,
    finite_bounds: finitePublicValues([artifacts.initialState, stats.frames]) ? null : false,
    effect_integrity: effectValid && stats.actions.every((action) => knownActors.has(action.actorId)),
    participation: stats.actors.length ? [...stats.actorActions.values()].every((count) => count > 0) : null,
    stationary_fidelity: stats.stationary.length ? stats.stationaryMoved === 0 : null,
    artifact_reconciliation: Number.isInteger(artifacts.runSummary?.metrics?.ticks)
      ? artifacts.runSummary.metrics.ticks === stats.requestedTicks
        && (!Number.isInteger(artifacts.runSummary?.metrics?.frames) || artifacts.runSummary.metrics.frames === stats.frames.length)
        && (!Array.isArray(artifacts.effectLog) || !Number.isInteger(artifacts.runSummary?.metrics?.effects)
          || artifacts.runSummary.metrics.effects === artifacts.effectLog.length) : null,
    unique_actor_ids: stats.actors.length === knownActors.size,
    deterministic_replay: artifacts.replayTickFrames
      ? normalizedFrameHash(stats.frames) === normalizedFrameHash(artifacts.replayTickFrames) : null,
  };
  return Object.fromEntries(scenario.invariants.map((name) => {
    const passed = checks[name];
    return [name, passed === null || passed === undefined
      ? { status: 'evidence_unavailable', reason: 'public artifacts do not prove this invariant across the run' }
      : { status: passed ? 'passed' : 'failed' }];
  }));
}

function thresholdFraction(value, threshold) {
  if (!threshold || !Number.isFinite(value)) return null;
  if (threshold.direction === 'min') return threshold.value > 0 ? clamp(value / threshold.value) : Number(value >= threshold.value);
  if (threshold.direction === 'max') return value <= threshold.value ? 1 : threshold.value > 0 ? clamp(threshold.value / value) : 0;
  if (threshold.direction === 'exact') return Number(value === threshold.value);
  if (threshold.direction === 'range') return Number(value >= threshold.value[0] && value <= threshold.value[1]);
  return null;
}

function scoreObjectives(scenario, metrics) {
  const objectives = {};
  let weighted = 0;
  let availableWeight = 0;
  for (const [name, objective] of Object.entries(scenario.objectives)) {
    const entry = metrics[name];
    if (objective.evidence === 'observation' || entry?.status !== 'available') {
      objectives[name] = { status: 'evidence_unavailable', weight: objective.weight,
        reason: objective.evidence === 'observation' ? 'observation checkpoint evidence is required' : entry?.reason };
      continue;
    }
    const threshold = scenario.thresholds[name];
    let fraction = thresholdFraction(entry.value, threshold);
    if (fraction === null) {
      if (entry.unit === 'ratio' || entry.unit === 'actions_per_tick') fraction = clamp(entry.value);
      else if (['count', 'ticks', 'tiles'].includes(entry.unit)) fraction = clamp(entry.value);
    }
    if (fraction === null) {
      objectives[name] = { status: 'evidence_unavailable', weight: objective.weight,
        reason: 'the catalog declares no scoring target for this metric' };
      continue;
    }
    const points = objective.weight * fraction;
    weighted += points;
    availableWeight += objective.weight;
    objectives[name] = { status: 'scored', weight: objective.weight, points, fraction, value: entry.value };
  }
  return {
    status: availableWeight === 100 ? 'scored' : 'evidence_unavailable',
    value: availableWeight === 100 ? weighted : null,
    availableScore: weighted,
    availableWeight,
    objectives,
  };
}

function compareGateValue(value, operator, threshold) {
  if (operator === 'min') return value >= threshold;
  if (operator === 'max') return value <= threshold;
  if (operator === 'exact') return value === threshold;
  if (operator === 'range') return value >= threshold[0] && value <= threshold[1];
  throw new Error(`unsupported scalar gate operator: ${operator}`);
}

function gateEvidenceUnavailable(reason) {
  return { status: 'evidence_unavailable', reason };
}

function evaluateGatePredicateForResult(predicate, result) {
  if (['all', 'any'].includes(predicate.operator)) {
    const children = predicate.predicates.map((child) => evaluateGatePredicateForResult(child, result));
    if (predicate.operator === 'all') {
      if (children.some((child) => child.status === 'failed')) return { status: 'failed', children };
      if (children.some((child) => child.status === 'evidence_unavailable')) {
        return { status: 'evidence_unavailable', reason: 'one or more child predicates lack evidence', children };
      }
      return { status: 'passed', children };
    }
    if (children.some((child) => child.status === 'passed')) return { status: 'passed', children };
    if (children.some((child) => child.status === 'evidence_unavailable')) {
      return { status: 'evidence_unavailable', reason: 'no child passed and one or more lack evidence', children };
    }
    return { status: 'failed', children };
  }
  if (predicate.source === 'invariant') {
    const evidence = result.invariants?.[predicate.ref];
    if (!evidence || evidence.status === 'evidence_unavailable') {
      return gateEvidenceUnavailable(evidence?.reason || `invariant ${predicate.ref} is unavailable`);
    }
    const actual = evidence.status === 'passed';
    return { status: actual === predicate.threshold ? 'passed' : 'failed', actual, expected: predicate.threshold };
  }
  if (['rate', 'changed_in_direction'].includes(predicate.operator)) {
    return gateEvidenceUnavailable(`${predicate.operator} requires population evidence`);
  }
  const evidence = result.metrics?.[predicate.ref];
  if (!evidence || evidence.status !== 'available') {
    return gateEvidenceUnavailable(evidence?.reason || `metric ${predicate.ref} is unavailable`);
  }
  if (evidence.unit !== predicate.unit) {
    return gateEvidenceUnavailable(`metric ${predicate.ref} unit ${evidence.unit} is not comparable to ${predicate.unit}`);
  }
  const passed = compareGateValue(evidence.value, predicate.operator, predicate.threshold);
  return { status: passed ? 'passed' : 'failed', actual: evidence.value, expected: predicate.threshold };
}

function gateResult(gate, evaluation) {
  return { id: gate.id, description: gate.description, scope: gate.scope, ...evaluation };
}

function declaredVariants(scenario) {
  const variants = new Set();
  const visit = (predicate) => {
    if (['all', 'any'].includes(predicate.operator)) return predicate.predicates.forEach(visit);
    if (predicate.operator === 'changed_in_direction') {
      variants.add(predicate.baselineVariant);
      variants.add(predicate.candidateVariant);
    }
    return undefined;
  };
  scenario.requiredGates.forEach((gate) => visit(gate.predicate));
  return [...variants];
}

function populationKeys(profile, scenario) {
  const variants = declaredVariants(scenario);
  const variantValues = variants.length ? variants : [null];
  return profile.seeds.flatMap((seed) => Array.from({ length: profile.repeats }, (_, offset) => offset + 1)
    .flatMap((repeat) => variantValues.map((variant) => `${seed}:${repeat}:${variant || ''}`)));
}

function indexPopulation(results) {
  const index = new Map();
  const duplicates = new Set();
  for (const result of results) {
    const key = `${result.run.seed}:${result.run.repeat}:${result.run.variant || ''}`;
    if (index.has(key)) duplicates.add(key);
    else index.set(key, result);
  }
  return { index, duplicates };
}

function evaluateSeedPopulationGate(gate, results, expectedKeys, indexed) {
  const missing = expectedKeys.filter((key) => !indexed.index.has(key));
  if (missing.length || indexed.duplicates.size) {
    return gateResult(gate, gateEvidenceUnavailable(`seed population incomplete: ${missing.length} missing, ${indexed.duplicates.size} duplicate`));
  }
  const evaluations = results.map((result) => evaluateGatePredicateForResult(gate.predicate, result));
  if (evaluations.some((entry) => entry.status === 'failed')) return gateResult(gate, { status: 'failed' });
  if (evaluations.some((entry) => entry.status === 'evidence_unavailable')) {
    return gateResult(gate, gateEvidenceUnavailable('one or more declared seed/repeat results lack gate evidence'));
  }
  return gateResult(gate, { status: 'passed' });
}

function rateGroups(results, denominator, profile, variants) {
  if (denominator === 'seeds') return profile.seeds.map((seed) => ({ id: String(seed), values: results.filter((result) => result.run.seed === seed) }));
  if (denominator === 'repeats') return Array.from({ length: profile.repeats }, (_, offset) => offset + 1)
    .map((repeat) => ({ id: String(repeat), values: results.filter((result) => result.run.repeat === repeat) }));
  return variants.map((variant) => ({ id: variant, values: results.filter((result) => result.run.variant === variant) }));
}

function evaluateRateGate(gate, results, profile, scenario) {
  const predicate = gate.predicate;
  const groups = rateGroups(results, predicate.denominator, profile, declaredVariants(scenario));
  if (!groups.length || groups.some((group) => group.values.length === 0)) {
    return gateResult(gate, gateEvidenceUnavailable(`declared ${predicate.denominator} population is incomplete`));
  }
  let passed = 0;
  for (const group of groups) {
    const evaluations = group.values.map((result) => evaluateGatePredicateForResult({
      source: predicate.source, ref: predicate.ref, unit: predicate.unit,
      operator: predicate.condition.operator, threshold: predicate.condition.threshold,
    }, result));
    if (evaluations.some((entry) => entry.status === 'evidence_unavailable')) {
      return gateResult(gate, gateEvidenceUnavailable(`rate evidence unavailable for ${predicate.denominator} ${group.id}`));
    }
    if (evaluations.every((entry) => entry.status === 'passed')) passed += 1;
  }
  const actual = passed / groups.length;
  return gateResult(gate, { status: actual >= predicate.threshold ? 'passed' : 'failed', actual,
    expected: predicate.threshold, numerator: passed, denominator: groups.length });
}

function evaluateAggregateMetricGate(gate, results) {
  const predicate = gate.predicate;
  if (predicate.ref !== 'seed_sensitivity') {
    return gateResult(gate, gateEvidenceUnavailable(`no aggregate reducer is defined for metric ${predicate.ref}`));
  }
  const bySeed = new Map();
  for (const result of results) if (!bySeed.has(result.run.seed)) bySeed.set(result.run.seed, result.run.frameHash);
  const actual = new Set(bySeed.values()).size;
  return gateResult(gate, { status: compareGateValue(actual, predicate.operator, predicate.threshold) ? 'passed' : 'failed',
    actual, expected: predicate.threshold });
}

function evaluatePairedGate(gate, results, profile) {
  const predicate = gate.predicate;
  for (const seed of profile.seeds) {
    for (let repeat = 1; repeat <= profile.repeats; repeat += 1) {
      const baseline = results.filter((result) => result.run.seed === seed && result.run.repeat === repeat
        && result.run.variant === predicate.baselineVariant);
      const candidate = results.filter((result) => result.run.seed === seed && result.run.repeat === repeat
        && result.run.variant === predicate.candidateVariant);
      if (baseline.length !== 1 || candidate.length !== 1) {
        return gateResult(gate, gateEvidenceUnavailable(`paired variants missing or duplicated for seed ${seed}, repeat ${repeat}`));
      }
      const left = baseline[0].metrics?.[predicate.ref];
      const right = candidate[0].metrics?.[predicate.ref];
      if (left?.status !== 'available' || right?.status !== 'available'
        || left.unit !== predicate.unit || right.unit !== predicate.unit) {
        return gateResult(gate, gateEvidenceUnavailable(`paired metric ${predicate.ref} is unavailable or non-comparable`));
      }
      const changed = predicate.threshold === 'increase' ? right.value > left.value : right.value < left.value;
      if (!changed) return gateResult(gate, { status: 'failed', seed, repeat, baseline: left.value, candidate: right.value });
    }
  }
  return gateResult(gate, { status: 'passed' });
}

function evaluateReplayGate(gate, results, profile) {
  if (gate.predicate.ref !== 'determinism') {
    return gateResult(gate, gateEvidenceUnavailable(`no replay reducer is defined for metric ${gate.predicate.ref}`));
  }
  for (const seed of profile.seeds) {
    const repeats = results.filter((result) => result.run.seed === seed && !result.run.variant)
      .sort((left, right) => left.run.repeat - right.run.repeat);
    if (repeats.length !== profile.repeats
      || repeats.some((result, index) => result.run.repeat !== index + 1)) {
      return gateResult(gate, gateEvidenceUnavailable(`replay population incomplete for seed ${seed}`));
    }
    if (new Set(repeats.map((result) => result.run.frameHash)).size !== 1) {
      return gateResult(gate, { status: 'failed', seed });
    }
  }
  const actual = 1;
  return gateResult(gate, { status: compareGateValue(actual, gate.predicate.operator, gate.predicate.threshold) ? 'passed' : 'failed',
    actual, expected: gate.predicate.threshold });
}

function evaluatePopulationGates(scenario, results, contract) {
  const profile = contract.profiles[scenario.profile];
  const expectedKeys = populationKeys(profile, scenario);
  const indexed = indexPopulation(results);
  const expected = new Set(expectedKeys);
  const missing = expectedKeys.filter((key) => !indexed.index.has(key));
  const unexpected = [...indexed.index.keys()].filter((key) => !expected.has(key));
  if (missing.length || unexpected.length || indexed.duplicates.size) {
    const reason = `declared population incomplete: ${missing.length} missing, ${unexpected.length} unexpected, ${indexed.duplicates.size} duplicate`;
    return scenario.requiredGates.map((gate) => gateResult(gate, gateEvidenceUnavailable(reason)));
  }
  return scenario.requiredGates.map((gate) => {
    if (gate.scope === 'seed') return evaluateSeedPopulationGate(gate, results, expectedKeys, indexed);
    if (gate.scope === 'paired_variant') return evaluatePairedGate(gate, results, profile);
    if (gate.scope === 'replay') return evaluateReplayGate(gate, results, profile);
    if (gate.predicate.operator === 'rate') return evaluateRateGate(gate, results, profile, scenario);
    return evaluateAggregateMetricGate(gate, results);
  });
}

function evaluateExecutionArtifacts({ artifacts, scenario, catalog = loadExecutionCatalog(), seed = 0, repeat = 1, variant }) {
  const selected = typeof scenario === 'string' ? catalog.scenarios.find((entry) => entry.id === scenario) : scenario;
  if (!selected) throw new Error(`unknown execution scenario: ${scenario}`);
  const expectedCheckpointTicks = catalog.contract.profiles[selected.profile]?.checkpoints || [];
  const checkpointStates = Array.isArray(artifacts.worldStateCheckpoints?.states)
    ? artifacts.worldStateCheckpoints.states : [];
  const loadedCheckpointTicks = checkpointStates.map((state) => state.tick)
    .filter((tick) => expectedCheckpointTicks.includes(tick)).sort((a, b) => a - b);
  const missingCheckpointTicks = expectedCheckpointTicks.filter((tick) => !loadedCheckpointTicks.includes(tick));
  const { metrics, stats } = extractExecutionMetrics(artifacts, catalog.contract);
  const invariants = evaluateInvariants(artifacts, selected, stats);
  const failedInvariants = Object.entries(invariants).filter(([, value]) => value.status === 'failed').map(([name]) => name);
  const unavailableInvariants = Object.entries(invariants).filter(([, value]) => value.status === 'evidence_unavailable').map(([name]) => name);
  const score = scoreObjectives(selected, metrics);
  const requiredGates = selected.requiredGates.map((gate) => gate.scope === 'seed'
    ? gateResult(gate, evaluateGatePredicateForResult(gate.predicate, { metrics, invariants }))
    : gateResult(gate, gateEvidenceUnavailable(`${gate.scope} gate requires population aggregation`)));
  const failedGates = requiredGates.filter((gate) => gate.status === 'failed').map((gate) => gate.id);
  const unavailableGates = requiredGates.filter((gate) => gate.status === 'evidence_unavailable').map((gate) => gate.id);
  if (failedInvariants.length) Object.assign(score, { status: 'hard_fail', value: 0, availableScore: 0 });
  const verdictStatus = failedInvariants.length || failedGates.length ? 'failed'
    : unavailableInvariants.length || unavailableGates.length || score.status !== 'scored' ? 'evidence_unavailable'
      : score.value >= catalog.contract.qualification.minimumSeedScore ? 'passed' : 'failed';
  return {
    schemaVersion: RESULT_SCHEMA_VERSION,
    identity: {
      executionSuiteHash: catalog.sha256,
      evaluatorVersion: catalog.evaluatorVersion,
      seedSetHash: catalog.seedSetHash,
      tickProfileHash: catalog.tickProfileHash,
    },
    scenario: { id: selected.id, family: selected.family, profile: selected.profile },
    run: { seed, repeat, ...(variant ? { variant } : {}), requestedTicks: stats.requestedTicks,
      frameHash: normalizedFrameHash(stats.frames) },
    artifactSummary: { frames: stats.frames.length, actions: stats.actions.length, effects: stats.effects.length,
      fulfilledEffects: stats.fulfilled.length, bytes: stats.artifactBytes, actorActivity: stats.actorActivity,
      interactionClasses: stats.interactionClasses,
      worldStateCheckpoints: {
        expectedTicks: [...expectedCheckpointTicks],
        loadedTicks: loadedCheckpointTicks,
        missingTicks: missingCheckpointTicks,
        complete: missingCheckpointTicks.length === 0,
      } },
    metrics,
    invariants,
    requiredGates,
    score,
    verdict: { status: verdictStatus, failedInvariants, unavailableInvariants, failedGates, unavailableGates },
  };
}

function aggregateExecutionResults(results, contract = loadExecutionCatalog().contract, scenario = null) {
  if (!Array.isArray(results) || results.length === 0) throw new Error('execution results are required');
  for (const result of results) assertComparableExecutionResults(results[0], result);
  const selected = scenario || loadExecutionCatalog().scenarios.find((entry) => entry.id === results[0].scenario.id);
  if (!selected || results.some((result) => result.scenario.id !== selected.id)) {
    throw new Error('execution aggregate requires one known scenario');
  }
  const scores = results.map((result) => result.score?.value).filter(Number.isFinite).sort((a, b) => a - b);
  const failed = results.filter((result) => result.score?.status === 'hard_fail'
    || result.verdict?.failedInvariants?.length);
  const unavailableResults = results.filter((result) => result.score?.status !== 'scored'
    || result.verdict?.unavailableInvariants?.length);
  const requiredGates = evaluatePopulationGates(selected, results, contract);
  const failedGates = requiredGates.filter((gate) => gate.status === 'failed');
  const unavailableGates = requiredGates.filter((gate) => gate.status === 'evidence_unavailable');
  const mean = scores.length ? scores.reduce((sum, value) => sum + value, 0) / scores.length : null;
  const median = scores.length ? (scores[Math.floor((scores.length - 1) / 2)] + scores[Math.ceil((scores.length - 1) / 2)]) / 2 : null;
  const minimum = scores.length ? scores[0] : null;
  const worstSeed = [...results].sort((left, right) => {
    const leftScore = Number.isFinite(left.score?.value) ? left.score.value : -1;
    const rightScore = Number.isFinite(right.score?.value) ? right.score.value : -1;
    return leftScore - rightScore || left.run.seed - right.run.seed;
  })[0];
  const complete = scores.length === results.length && failed.length === 0 && unavailableResults.length === 0
    && failedGates.length === 0 && unavailableGates.length === 0;
  const qualifies = complete && mean >= contract.qualification.meanScore
    && median >= contract.qualification.medianScore && minimum >= contract.qualification.minimumSeedScore;
  return {
    schemaVersion: 'agent-kernel-execution-aggregate/v1',
    identity: { ...results[0].identity },
    scenario: { ...results[0].scenario },
    runs: results.length,
    requiredGates,
    distribution: { mean, median, minimum, maximum: scores.length ? scores[scores.length - 1] : null },
    worstSeed: { seed: worstSeed.run.seed, repeat: worstSeed.run.repeat, score: worstSeed.score?.value ?? null,
      verdict: worstSeed.verdict.status },
    verdict: { status: failed.length || failedGates.length ? 'failed'
      : unavailableResults.length || unavailableGates.length || !complete ? 'evidence_unavailable'
        : qualifies ? 'passed' : 'failed', qualifies, failedRuns: failed.length,
    unavailableRuns: unavailableResults.length, failedGates: failedGates.map((gate) => gate.id),
    unavailableGates: unavailableGates.map((gate) => gate.id) },
  };
}

function loadExecutionArtifacts(runDir, buildDir = runDir, { checkpointTicks = [] } = {}) {
  const loaded = {};
  let artifactBytes = 0;
  for (const [name, fileName] of Object.entries(REQUIRED_FILES)) {
    const base = ['simConfig', 'initialState'].includes(name) ? buildDir : runDir;
    const filePath = path.join(base, fileName);
    if (!fs.existsSync(filePath)) throw new Error(`missing execution artifact: ${filePath}`);
    const text = fs.readFileSync(filePath, 'utf8');
    artifactBytes += Buffer.byteLength(text);
    try { loaded[name] = JSON.parse(text); } catch (error) { throw new Error(`invalid execution artifact JSON ${filePath}: ${error.message}`); }
  }
  const worldStateCheckpoints = loadWorldStateCheckpoints(runDir, checkpointTicks);
  return { ...loaded, worldStateCheckpoints, artifactBytes: artifactBytes + worldStateCheckpoints.artifactBytes };
}

function checkpointFilename(tick) {
  return `tick-${String(tick).padStart(6, '0')}.json`;
}

function loadWorldStateCheckpoints(runDir, expectedTicks = []) {
  if (!Array.isArray(expectedTicks)
    || expectedTicks.some((tick) => !Number.isSafeInteger(tick) || tick < 0)
    || new Set(expectedTicks).size !== expectedTicks.length
    || expectedTicks.some((tick, index) => index > 0 && tick <= expectedTicks[index - 1])) {
    throw new Error('world-state checkpoint ticks must be unique, strictly ascending non-negative integers');
  }
  const checkpointDir = path.join(runDir, 'world-state-checkpoints');
  const states = [];
  const missingTicks = [];
  let artifactBytes = 0;
  for (const expectedTick of expectedTicks) {
    const filePath = path.join(checkpointDir, checkpointFilename(expectedTick));
    if (!fs.existsSync(filePath)) {
      missingTicks.push(expectedTick);
      continue;
    }
    const text = fs.readFileSync(filePath, 'utf8');
    artifactBytes += Buffer.byteLength(text);
    let state;
    try {
      state = JSON.parse(text);
    } catch (error) {
      throw new Error(`invalid world-state checkpoint JSON ${filePath}: ${error.message}`);
    }
    if (!isObject(state) || state.schema !== 'agent-kernel/WorldStateArtifact' || state.schemaVersion !== 1
      || !isObject(state.meta) || !isObject(state.dimensions)
      || !Array.isArray(state.actors) || !Array.isArray(state.hazards)) {
      throw new Error(`invalid WorldStateArtifact checkpoint: ${filePath}`);
    }
    if (state.tick !== expectedTick) {
      throw new Error(`world-state checkpoint expected tick ${expectedTick}, found ${state.tick}: ${filePath}`);
    }
    states.push(state);
  }
  return {
    expectedTicks: [...expectedTicks],
    loadedTicks: states.map((state) => state.tick),
    missingTicks,
    states,
    artifactBytes,
  };
}

function validateExecutionResult(result) {
  if (!isObject(result) || result.schemaVersion !== RESULT_SCHEMA_VERSION) {
    throw new Error('invalid execution result schemaVersion');
  }
  const requiredSections = [
    'identity', 'scenario', 'run', 'artifactSummary', 'metrics', 'invariants',
    'requiredGates', 'score', 'verdict',
  ];
  for (const name of requiredSections) {
    if (name === 'requiredGates' ? !Array.isArray(result[name]) : !isObject(result[name])) {
      throw new Error(`invalid execution result ${name}`);
    }
  }
  for (const name of ['executionSuiteHash', 'seedSetHash', 'tickProfileHash']) {
    if (!/^[a-f0-9]{64}$/.test(result.identity?.[name] || '')) throw new Error(`invalid execution result ${name}`);
  }
  if (typeof result.identity.evaluatorVersion !== 'string' || result.identity.evaluatorVersion === '') {
    throw new Error('invalid execution result evaluatorVersion');
  }
  for (const name of ['id', 'family', 'profile']) {
    if (typeof result.scenario[name] !== 'string' || result.scenario[name] === '') {
      throw new Error(`invalid execution result scenario ${name}`);
    }
  }
  if (!Number.isInteger(result.run.seed) || !Number.isInteger(result.run.repeat) || result.run.repeat < 1
    || !Number.isInteger(result.run.requestedTicks) || result.run.requestedTicks < 0
    || ('variant' in result.run && (typeof result.run.variant !== 'string' || result.run.variant === ''))
    || !/^[a-f0-9]{64}$/.test(result.run.frameHash || '')) {
    throw new Error('invalid execution result run');
  }
  for (const name of ['frames', 'actions', 'effects', 'fulfilledEffects', 'bytes']) {
    if (!Number.isFinite(result.artifactSummary[name]) || result.artifactSummary[name] < 0) {
      throw new Error(`invalid execution result artifactSummary ${name}`);
    }
  }
  const checkpoints = result.artifactSummary.worldStateCheckpoints;
  if (!isObject(checkpoints) || !Array.isArray(checkpoints.expectedTicks)
    || !Array.isArray(checkpoints.loadedTicks) || !Array.isArray(checkpoints.missingTicks)
    || typeof checkpoints.complete !== 'boolean') {
    throw new Error('invalid execution result artifactSummary worldStateCheckpoints');
  }
  for (const [name, entry] of Object.entries(result.metrics)) {
    if (!isObject(entry) || !['available', 'evidence_unavailable'].includes(entry.status)
      || typeof entry.unit !== 'string' || !['artifact', 'observation'].includes(entry.evidence)
      || (entry.status === 'available' && !Number.isFinite(entry.value))) {
      throw new Error(`invalid execution result metric ${name}`);
    }
  }
  for (const [name, entry] of Object.entries(result.invariants)) {
    if (!isObject(entry) || !['passed', 'failed', 'evidence_unavailable'].includes(entry.status)) {
      throw new Error(`invalid execution result invariant ${name}`);
    }
  }
  for (const gate of result.requiredGates) {
    if (!isObject(gate) || typeof gate.id !== 'string' || gate.id === ''
      || typeof gate.description !== 'string' || gate.description === ''
      || !['seed', 'aggregate', 'paired_variant', 'replay'].includes(gate.scope)
      || !['passed', 'failed', 'evidence_unavailable'].includes(gate.status)) {
      throw new Error('invalid execution result required gate');
    }
  }
  if (!['scored', 'hard_fail', 'evidence_unavailable'].includes(result.score.status)
    || !(result.score.value === null || Number.isFinite(result.score.value))
    || !Number.isFinite(result.score.availableScore) || !Number.isFinite(result.score.availableWeight)
    || !isObject(result.score.objectives)) {
    throw new Error('invalid execution result score');
  }
  if (!['passed', 'failed', 'evidence_unavailable'].includes(result.verdict.status)
    || !Array.isArray(result.verdict.failedInvariants)
    || !Array.isArray(result.verdict.unavailableInvariants)
    || !Array.isArray(result.verdict.failedGates)
    || !Array.isArray(result.verdict.unavailableGates)) {
    throw new Error('invalid execution result verdict');
  }
  return result;
}

function writeExecutionResult(filePath, result) {
  validateExecutionResult(result);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.tmp-${process.pid}`;
  fs.writeFileSync(temporary, `${JSON.stringify(result, null, 2)}\n`);
  fs.renameSync(temporary, filePath);
  return filePath;
}

function assertComparableExecutionResults(left, right) {
  validateExecutionResult(left);
  validateExecutionResult(right);
  for (const name of ['executionSuiteHash', 'evaluatorVersion', 'seedSetHash', 'tickProfileHash']) {
    if (left.identity[name] !== right.identity[name]) throw new Error(`execution comparison identity mismatch: ${name}`);
  }
  return true;
}

module.exports = {
  RESULT_SCHEMA_VERSION,
  aggregateExecutionResults,
  assertComparableExecutionResults,
  evaluateExecutionArtifacts,
  evaluateGatePredicateForResult,
  extractExecutionMetrics,
  loadExecutionArtifacts,
  loadWorldStateCheckpoints,
  normalizedFrameHash,
  scoreObjectives,
  validateExecutionResult,
  writeExecutionResult,
};
