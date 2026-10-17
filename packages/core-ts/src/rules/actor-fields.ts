import type { ActorEffectSuppression } from './actor-cast.ts';
import type { createActorRegistry } from '../state/actor-registry.ts';
import type { ActorPosition, ActorAffinityEntry, ActorRecord } from '../state/actor-types.ts';
import { affinityKey, equippedActorAffinities } from '../state/actor-inventory.ts';
import { AFFINITY_KIND_BY_CODE, AFFINITY_EXPRESSION_BY_CODE } from '../affinity-readers.ts';
import { getOppositeAffinityKind, resolveAffinityRelationshipCode, AffinityRelationship, scaleAffinityVitalEffect } from '../state/affinity.ts';
import { computeAffinityIntensity, computeAffinityRadius, cancelAffinityOverlap,
  deriveAffinityInteractionCell, AffinityEffect, OPPOSITE_EXPOSURE_AMPLIFICATION } from '../state/affinity-spatial.ts';
import { evaluateActorAffinityReceiver, getActorAffinityEffect, type ActorVitalChange } from './actor-affinity.ts';
import { changeActorVital } from '../state/actor-vitals.ts';
import { resolveActorExposures, type ActorExposureSource } from './actor-exposure.ts';
import { litActorAffinities } from './actor-upkeep.ts';

const KIND_CODES = Object.fromEntries(Object.entries(AFFINITY_KIND_BY_CODE).map(([code, name]) => [name, Number(code)]));
const EXPRESSION_CODES = Object.fromEntries(Object.entries(AFFINITY_EXPRESSION_BY_CODE).map(([code, name]) => [name, Number(code)]));
export interface ActorFieldCell extends ActorAffinityEntry { sourceId: string; position: ActorPosition; intensity: number }
type Registry = ReturnType<typeof createActorRegistry>;

/** One field per lit slot: exposure budgets are keyed by source and affinity. */
export function fieldSlotKey(sourceId: string, pair: Pick<ActorAffinityEntry, 'kind' | 'expression'>): string {
  return `${sourceId}|${pair.kind}:${pair.expression}`;
}

/**
 * Receiver rules over every equipped slot: a matching draw absorbs first (the
 * exposure resolver routes it into mana), then a same-kind slot that the
 * interaction table makes immune takes nothing, then any opposite slot doubles
 * damage and drain.
 */
function receiverExposureAmount(receiver: ActorRecord, cell: ActorFieldCell, amount: number, operation: string): number {
  const equipped = equippedActorAffinities(receiver);
  if (!equipped.length) return amount;
  if (equipped.some(pair => pair.kind === cell.kind && pair.expression === 'draw')
    && (cell.expression === 'push' || cell.expression === 'emit')) return amount;
  const relationships = equipped.map(pair => {
    const relationship = resolveAffinityRelationshipCode(KIND_CODES[cell.kind], KIND_CODES[pair.kind]);
    return { relationship, interaction: deriveAffinityInteractionCell(EXPRESSION_CODES[cell.expression], EXPRESSION_CODES[pair.expression], relationship) };
  });
  if (relationships.some(({ relationship, interaction }) => relationship === AffinityRelationship.Same
    && interaction?.targetEffect === AffinityEffect.None)) return 0;
  if (relationships.some(({ relationship }) => relationship === AffinityRelationship.Opposite)
    && (operation === 'damage' || operation === 'drain')) return amount * OPPOSITE_EXPOSURE_AMPLIFICATION;
  return amount;
}

/** Receiver-local exposure before finite source budgets and vital routing. No mutation. */
export function actorFieldExposureAmount(receiver: ActorRecord, cell: ActorFieldCell, localCells: readonly ActorFieldCell[]): number {
  if (receiver.lifecycle !== 'alive' || receiver.id === cell.sourceId) return 0;
  const amount = scaleAffinityVitalEffect(cell.intensity, cell.stacks);
  const operation = getActorAffinityEffect(cell.kind, cell.expression).operation;
  if (operation === 'neutralize') {
    return localCells.some(pending => pending.sourceId === receiver.id
      && pending.kind === cell.kind && pending.expression === 'emit') ? amount : 0;
  }
  return receiverExposureAmount(receiver, cell, amount, operation);
}

/** Receiver-local forecast from projected cells, before other receivers consume exposure.
 * Uses residual observed stacks as a conservative source budget. Does not project new fields.
 */
export function previewActorFieldChanges(receiver: ActorRecord, localCells: readonly ActorFieldCell[]): ActorVitalChange[] {
  const actor: ActorRecord = JSON.parse(JSON.stringify(receiver));
  const remaining = new Map<string, number>();
  const changes: ActorVitalChange[] = [];
  const change = (vital: ActorVitalChange['vital'], delta: number): number => {
    const actual = changeActorVital(actor, vital, delta);
    if (actual !== 0) changes.push({ actorId: actor.id, vital, delta: actual });
    return actual;
  };
  // Registry snapshots order sources by stable ID; forecasts preserve that order.
  const ordered = [...localCells].sort((left, right) => left.sourceId < right.sourceId ? -1 : left.sourceId > right.sourceId ? 1 : 0);
  for (const cell of ordered) {
    const slot = fieldSlotKey(cell.sourceId, cell);
    const budget = remaining.get(slot) ?? scaleAffinityVitalEffect(1, cell.stacks);
    const amount = Math.min(budget, actorFieldExposureAmount(actor, cell, localCells));
    remaining.set(slot, budget - amount);
    if (amount <= 0) continue;
    if (cell.expression === 'emit' && equippedActorAffinities(actor)
      .some(pair => pair.kind === cell.kind && pair.expression === 'draw')) {
      change('mana', amount);
    } else {
      evaluateActorAffinityReceiver(cell.kind, cell.expression, amount, change);
    }
  }
  return changes;
}

function projectedIntensity(actor: ActorRecord, pair: ActorAffinityEntry, position: ActorPosition): number {
  const distance = Math.abs(actor.position.x - position.x) + Math.abs(actor.position.y - position.y);
  const expression = EXPRESSION_CODES[pair.expression];
  if (distance > computeAffinityRadius(expression, pair.stacks)) return 0;
  return distance === 0 ? 1 : computeAffinityIntensity(distance, pair.stacks, expression);
}

type FieldSource = { actor: ActorRecord; pair: ActorAffinityEntry };
function activeFieldSources(actors: readonly ActorRecord[]): FieldSource[] {
  return [...actors].sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0)
    .flatMap(actor => litActorAffinities(actor).map(pair => ({ actor, pair })));
}

/** Project a cell from the supplied actors, including hypothetical active equipment.
 * Reads only those actors; it cannot infer unobserved sources or apply a field pulse.
 */
export function projectActorFieldsAt(actors: readonly ActorRecord[], position: ActorPosition): ActorFieldCell[] {
  return projectSourcesAt(activeFieldSources(actors), position);
}

function sourceContributionsAt(sources: readonly FieldSource[], position: ActorPosition): ActorFieldCell[] {
  return sources.flatMap(({ actor, pair }) => {
    const intensity = projectedIntensity(actor, pair, position);
    return intensity > 0 ? [{ ...pair, sourceId: actor.id, position: { ...position }, intensity }] : [];
  });
}

function projectSourcesAt(sources: readonly FieldSource[], position: ActorPosition): ActorFieldCell[] {
  return resolveFieldOverlap(sourceContributionsAt(sources, position));
}

/** Replace only this actor's contribution; other sources need not be visible actors. */
export function projectActorEquipmentFields(actor: ActorRecord, position: ActorPosition,
  contributions: readonly ActorFieldCell[]): ActorFieldCell[] {
  const others = contributions.filter(cell => cell.sourceId !== actor.id
    && cell.position.x === position.x && cell.position.y === position.y);
  return resolveFieldOverlap([...others, ...sourceContributionsAt(activeFieldSources([actor]), position)]);
}

function resolveFieldOverlap(contributions: readonly ActorFieldCell[]): ActorFieldCell[] {
  const emitters = new Map<number, ActorFieldCell>();
  const draws: ActorFieldCell[] = [];
  const ordered = [...contributions].sort((a, b) => a.sourceId < b.sourceId ? -1 : a.sourceId > b.sourceId ? 1 : 0);
  for (const contribution of ordered) {
    const cell = { ...contribution, position: { ...contribution.position } };
    const code = KIND_CODES[cell.kind];
    if (cell.expression === 'draw') draws.push(cell);
    else if (!emitters.has(code) || emitters.get(code)!.intensity < cell.intensity) emitters.set(code, cell);
  }
  for (const [code, source] of emitters) {
    const opposite = getOppositeAffinityKind(code);
    const target = emitters.get(opposite);
    if (!target || opposite <= code) continue;
    const net = cancelAffinityOverlap(source.intensity, source.stacks, target.intensity, target.stacks);
    source.intensity = net.sourceIntensity; source.stacks = net.sourceStacks;
    target.intensity = net.targetIntensity; target.stacks = net.targetStacks;
  }
  return [...emitters.values(), ...draws].filter(cell => cell.intensity > 0);
}

/** Current-position projection. No equipment, vitality, or historical field mutation. */
export function projectActorFields(registry: Pick<Registry, 'snapshot'>): { fields: ActorFieldCell[]; contributions: ActorFieldCell[]; sources: ActorExposureSource[] } {
  const snapshot = registry.snapshot();
  const actors = snapshot.actors.filter(actor => actor.lifecycle === 'alive');
  const sources = activeFieldSources(actors);
  const exposures = new Map(sources.map(({ actor, pair }) => [fieldSlotKey(actor.id, pair), {
    sourceId: actor.id, affinityKey: affinityKey(pair), budget: scaleAffinityVitalEffect(1, pair.stacks), targets: [],
  } as ActorExposureSource]));
  const fields: ActorFieldCell[] = [];
  const contributions: ActorFieldCell[] = [];
  for (let y = 0; y < snapshot.dimensions.height; y++) {
    for (let x = 0; x < snapshot.dimensions.width; x++) {
      const position = { x, y };
      const local = sourceContributionsAt(sources, position);
      contributions.push(...local);
      const cells = resolveFieldOverlap(local);
      fields.push(...cells);
      for (const receiver of actors.filter(actor => actor.position.x === x && actor.position.y === y)) {
        for (const cell of cells) {
          const amount = actorFieldExposureAmount(receiver, cell, cells);
          if (amount > 0) exposures.get(fieldSlotKey(cell.sourceId, cell))!.targets.push({ targetId: receiver.id, amount });
        }
      }
    }
  }
  return { fields, contributions, sources: [...exposures.values()] };
}

/** One field pass; Moderator remains responsible for calling once after ordered actions. */
export function resolveActorFields(registry: Registry, suppressions: ActorEffectSuppression[] = []) {
  for (const entry of suppressions) {
    if (!entry || !Number.isFinite(entry.amount) || entry.amount < 0 || !registry.getActor(entry.sourceId)
      || !registry.getActor(entry.targetId)) throw new Error('invalid field suppression');
  }
  const projection = projectActorFields(registry);
  const pending = new Map(projection.sources.map(source => [`${source.sourceId}|${source.affinityKey}`, source]));
  const applied: { sourceId: string; targetId: string; amount: number }[] = [];
  for (const entry of suppressions) {
    const source = pending.get(`${entry.targetId}|${entry.affinityKey}`);
    if (!source) continue;
    const amount = Math.min(source.budget, entry.amount);
    source.budget -= amount;
    if (amount > 0) applied.push({ sourceId: entry.sourceId, targetId: entry.targetId, amount });
  }
  const result = resolveActorExposures(registry, projection.sources);
  // Re-observe after immediate defeats; this projects state without applying a second pulse.
  return { ...result, suppressions: [...applied, ...result.suppressions],
    fields: projectActorFields(registry).fields.filter(field => (pending.get(fieldSlotKey(field.sourceId, field))?.budget ?? 0) > 0) };
}

/** Net stacks one side of an opposed pair must win by on an actor's tile to overwhelm it (#289). */
export const OVERWHELM_NET_STACKS = 2;
/** Regen multiplier when a harmful (damaging) affinity overwhelms: regen of its vital stops. */
export const OVERWHELM_HARM_REGEN_SCALE = 0;
/** Regen multiplier when a restoring affinity overwhelms: regen of its vital doubles. */
export const OVERWHELM_RESTORE_REGEN_SCALE = 2;

export interface ActorOverwhelm { actorId: string; kind: string; vital: string; regenScale: number }

/**
 * Overwhelm (maintainer, 2026-10-15, #289), one rule for every opposed pair: when an
 * emitted affinity from OTHER sources beats its opposite on an actor's tile by
 * `OVERWHELM_NET_STACKS` or more (the opposite counted from every source, the actor's
 * own included), the actor's regen of that affinity's vital is scaled for this turn:
 * stopped when the affinity's emit damages (`MATRIX`), doubled when it restores. Stacks
 * are the strongest single source of each kind reaching the tile, as in cancellation
 * (#290). An actor's own emission never overwhelms it. Read-only.
 */
export function readActorOverwhelms(registry: Pick<Registry, 'snapshot'>): ActorOverwhelm[] {
  const actors = registry.snapshot().actors.filter(actor => actor.lifecycle === 'alive');
  const sources = activeFieldSources(actors).filter(({ pair }) => pair.expression === 'emit');
  const out: ActorOverwhelm[] = [];
  for (const actor of actors) {
    const local = sourceContributionsAt(sources, actor.position);
    const strongest = (kind: string, includeSelf: boolean) => Math.max(0, ...local
      .filter(cell => cell.kind === kind && (includeSelf || cell.sourceId !== actor.id)).map(cell => cell.stacks));
    for (const kind of new Set(local.map(cell => cell.kind))) {
      const opposite = AFFINITY_KIND_BY_CODE[getOppositeAffinityKind(KIND_CODES[kind])];
      if (!opposite || strongest(kind, false) - strongest(opposite, true) < OVERWHELM_NET_STACKS) continue;
      const effect = getActorAffinityEffect(kind as ActorAffinityEntry['kind'], 'emit');
      if (effect.operation === 'neutralize') continue;
      out.push({ actorId: actor.id, kind, vital: effect.vital,
        regenScale: effect.operation === 'restore' ? OVERWHELM_RESTORE_REGEN_SCALE : OVERWHELM_HARM_REGEN_SCALE });
    }
  }
  return out;
}
