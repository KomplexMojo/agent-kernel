import type { ActorEffectSuppression } from './actor-cast.ts';
import type { createActorRegistry } from '../state/actor-registry.ts';
import type { ActorPosition, ActorAffinityEntry, ActorRecord } from '../state/actor-types.ts';
import { affinityIntensity, affinityKey, equippedActorAffinities } from '../state/actor-inventory.ts';
import { AFFINITY_KIND_BY_CODE, AFFINITY_EXPRESSION_BY_CODE } from '../affinity-readers.ts';
import { getOppositeAffinityKind } from '../state/affinity.ts';
import { computeAffinityFalloff, computeAffinityRadius, cancelAffinityOverlap } from '../state/affinity-spatial.ts';
import { actorAffinityMagnitude, evaluateActorAffinityReceiver, getActorAffinityEffect, type ActorVitalChange } from './actor-affinity.ts';
import { changeActorVital } from '../state/actor-vitals.ts';
import { resolveActorExposures, type ActorExposureSource } from './actor-exposure.ts';
import { receiverAffinityAmount } from './actor-receiver.ts';
import { litActorAffinities } from './actor-upkeep.ts';

const KIND_CODES = Object.fromEntries(Object.entries(AFFINITY_KIND_BY_CODE).map(([code, name]) => [name, Number(code)]));
const EXPRESSION_CODES = Object.fromEntries(Object.entries(AFFINITY_EXPRESSION_BY_CODE).map(([code, name]) => [name, Number(code)]));
/**
 * One source's field on one tile. `stacks` is the range it was cast at and
 * `intensity` its strength (after any opposite cancellation); `falloff` is the
 * distance shape, 1 at the source easing to 0 at the edge.
 */
export interface ActorFieldCell extends ActorAffinityEntry { sourceId: string; position: ActorPosition; intensity: number; falloff: number }
type Registry = ReturnType<typeof createActorRegistry>;

/** One field per lit slot: exposure budgets are keyed by source and affinity. */
export function fieldSlotKey(sourceId: string, pair: Pick<ActorAffinityEntry, 'kind' | 'expression'>): string {
  return `${sourceId}|${pair.kind}:${pair.expression}`;
}

/** Receiver-local exposure before the source's strength cap and vital routing. No mutation.
 * Vitals are whole numbers (#283): falloff and cancellation make the raw exposure
 * fractional, so it rounds to the nearest point here, the one place every field
 * affinity's exposure passes through. Half rounds up, so the weakest field still lands 1.
 */
export function actorFieldExposureAmount(receiver: ActorRecord, cell: ActorFieldCell, localCells: readonly ActorFieldCell[]): number {
  return Math.round(rawFieldExposureAmount(receiver, cell, localCells));
}

function rawFieldExposureAmount(receiver: ActorRecord, cell: ActorFieldCell, localCells: readonly ActorFieldCell[]): number {
  if (receiver.lifecycle !== 'alive' || receiver.id === cell.sourceId) return 0;
  const amount = cell.falloff * actorAffinityMagnitude(cell.expression, cell.intensity);
  const operation = getActorAffinityEffect(cell.kind, cell.expression).operation;
  if (operation === 'neutralize') {
    return localCells.some(pending => pending.sourceId === receiver.id
      && pending.kind === cell.kind && pending.expression === 'emit') ? amount : 0;
  }
  return receiverAffinityAmount(receiver, cell, amount);
}

/** Receiver-local forecast from projected cells. Other receivers do not change it (#347).
 * Uses residual observed intensity as a conservative source budget. Does not project new fields.
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
    const budget = remaining.get(slot) ?? actorAffinityMagnitude(cell.expression, cell.intensity);
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

function projectedFalloff(actor: ActorRecord, pair: ActorAffinityEntry, position: ActorPosition): number {
  const distance = Math.abs(actor.position.x - position.x) + Math.abs(actor.position.y - position.y);
  const expression = EXPRESSION_CODES[pair.expression];
  if (distance > computeAffinityRadius(expression, pair.stacks)) return 0;
  return distance === 0 ? 1 : computeAffinityFalloff(distance, pair.stacks, expression);
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
    const falloff = projectedFalloff(actor, pair, position);
    return falloff > 0 ? [{ ...pair, sourceId: actor.id, position: { ...position }, intensity: affinityIntensity(pair), falloff }] : [];
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

/** One cell's fields from raw source contributions, opposite pairs cancelled: the tick's own rule. Pure. */
export function resolveActorFieldOverlap(contributions: readonly ActorFieldCell[]): ActorFieldCell[] {
  return resolveFieldOverlap(contributions);
}

function resolveFieldOverlap(contributions: readonly ActorFieldCell[]): ActorFieldCell[] {
  const emitters = new Map<number, ActorFieldCell>();
  const draws: ActorFieldCell[] = [];
  const ordered = [...contributions].sort((a, b) => a.sourceId < b.sourceId ? -1 : a.sourceId > b.sourceId ? 1 : 0);
  for (const contribution of ordered) {
    const cell = { ...contribution, position: { ...contribution.position } };
    const code = KIND_CODES[cell.kind];
    if (cell.expression === 'draw') draws.push(cell);
    else if (!emitters.has(code) || strongerField(cell, emitters.get(code)!)) emitters.set(code, cell);
  }
  for (const [code, source] of emitters) {
    const opposite = getOppositeAffinityKind(code);
    const target = emitters.get(opposite);
    if (!target || opposite <= code) continue;
    const net = cancelAffinityOverlap(source.intensity, target.intensity);
    source.intensity = net.sourceIntensity; target.intensity = net.targetIntensity;
  }
  return [...emitters.values(), ...draws].filter(cell => cell.intensity > 0 && cell.falloff > 0);
}

/** The stronger of two same-kind fields on a tile: more intensity, then less falloff lost. */
function strongerField(cell: ActorFieldCell, current: ActorFieldCell): boolean {
  return cell.intensity !== current.intensity ? cell.intensity > current.intensity : cell.falloff > current.falloff;
}

/** Current-position projection. No equipment, vitality, or historical field mutation. */
export function projectActorFields(registry: Pick<Registry, 'snapshot'>): { fields: ActorFieldCell[]; contributions: ActorFieldCell[]; sources: ActorExposureSource[] } {
  const snapshot = registry.snapshot();
  const actors = snapshot.actors.filter(actor => actor.lifecycle === 'alive');
  const sources = activeFieldSources(actors);
  const exposures = new Map(sources.map(({ actor, pair }) => [fieldSlotKey(actor.id, pair), {
    sourceId: actor.id, affinityKey: affinityKey(pair), budget: actorAffinityMagnitude(pair.expression, affinityIntensity(pair)), targets: [],
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

/** Net intensity one side of an opposed pair must win by on an actor's tile to overwhelm it (#289, #340). */
export const OVERWHELM_NET_INTENSITY = 2;
/** Regen multiplier when a harmful (damaging) affinity overwhelms: regen of its vital stops. */
export const OVERWHELM_HARM_REGEN_SCALE = 0;
/** Regen multiplier when a restoring affinity overwhelms: regen of its vital doubles. */
export const OVERWHELM_RESTORE_REGEN_SCALE = 2;

export interface ActorOverwhelm { actorId: string; kind: string; vital: string; regenScale: number }

/**
 * Overwhelm (maintainer, 2026-10-15, #289), one rule for every opposed pair: when an
 * emitted affinity from OTHER sources beats its opposite on an actor's tile by
 * `OVERWHELM_NET_INTENSITY` or more (the opposite counted from every source, the actor's
 * own included), the actor's regen of that affinity's vital is scaled for this turn:
 * stopped when the affinity's emit damages (`MATRIX`), doubled when it restores. Each
 * side is the strongest single source's intensity of that kind reaching the tile, as in
 * cancellation (#290). An actor's own emission never overwhelms it. Read-only.
 */
export function readActorOverwhelms(registry: Pick<Registry, 'snapshot'>): ActorOverwhelm[] {
  const actors = registry.snapshot().actors.filter(actor => actor.lifecycle === 'alive');
  const sources = activeFieldSources(actors).filter(({ pair }) => pair.expression === 'emit');
  const out: ActorOverwhelm[] = [];
  for (const actor of actors) {
    const local = sourceContributionsAt(sources, actor.position);
    const strongest = (kind: string, includeSelf: boolean) => Math.max(0, ...local
      .filter(cell => cell.kind === kind && (includeSelf || cell.sourceId !== actor.id)).map(cell => cell.intensity));
    for (const kind of new Set(local.map(cell => cell.kind))) {
      const opposite = AFFINITY_KIND_BY_CODE[getOppositeAffinityKind(KIND_CODES[kind])];
      if (!opposite || strongest(kind, false) - strongest(opposite, true) < OVERWHELM_NET_INTENSITY) continue;
      const effect = getActorAffinityEffect(kind as ActorAffinityEntry['kind'], 'emit');
      if (effect.operation === 'neutralize') continue;
      out.push({ actorId: actor.id, kind, vital: effect.vital,
        regenScale: effect.operation === 'restore' ? OVERWHELM_RESTORE_REGEN_SCALE : OVERWHELM_HARM_REGEN_SCALE });
    }
  }
  return out;
}
