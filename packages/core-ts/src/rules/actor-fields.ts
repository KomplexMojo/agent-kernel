import type { ActorEffectSuppression } from './actor-cast.ts';
import type { createActorRegistry } from '../state/actor-registry.ts';
import type { ActorPosition, ActorAffinityEntry, ActorRecord } from '../state/actor-types.ts';
import { activeActorAffinity, affinityKey } from '../state/actor-inventory.ts';
import { AFFINITY_KIND_BY_CODE, AFFINITY_EXPRESSION_BY_CODE } from '../affinity-readers.ts';
import { getOppositeAffinityKind, resolveAffinityRelationshipCode, AffinityRelationship, scaleAffinityVitalEffect } from '../state/affinity.ts';
import { computeAffinityIntensity, computeAffinityRadius, cancelAffinityOverlap,
  deriveAffinityInteractionCell, AffinityEffect, OPPOSITE_EXPOSURE_AMPLIFICATION } from '../state/affinity-spatial.ts';
import { getActorAffinityEffect } from './actor-affinity.ts';
import { resolveActorExposures, type ActorExposureSource } from './actor-exposure.ts';

const KIND_CODES = Object.fromEntries(Object.entries(AFFINITY_KIND_BY_CODE).map(([code, name]) => [name, Number(code)]));
const EXPRESSION_CODES = Object.fromEntries(Object.entries(AFFINITY_EXPRESSION_BY_CODE).map(([code, name]) => [name, Number(code)]));
export interface ActorFieldCell extends ActorAffinityEntry { sourceId: string; position: ActorPosition; intensity: number }
type Registry = ReturnType<typeof createActorRegistry>;

function projectedIntensity(actor: ActorRecord, pair: ActorAffinityEntry, position: ActorPosition): number {
  const distance = Math.abs(actor.position.x - position.x) + Math.abs(actor.position.y - position.y);
  const expression = EXPRESSION_CODES[pair.expression];
  if (distance > computeAffinityRadius(expression, pair.stacks)) return 0;
  return distance === 0 ? 1 : computeAffinityIntensity(distance, pair.stacks, expression);
}

/** Current-position projection. No equipment, vitality, or historical field mutation. */
export function projectActorFields(registry: Pick<Registry, 'snapshot'>): { fields: ActorFieldCell[]; sources: ActorExposureSource[] } {
  const snapshot = registry.snapshot();
  const actors = snapshot.actors.filter(actor => actor.lifecycle === 'alive');
  const sources = actors.flatMap(actor => {
    const pair = activeActorAffinity(actor);
    return actor.capabilities.canCast && pair && ['emit', 'draw'].includes(pair.expression) ? [{ actor, pair }] : [];
  });
  const exposures = new Map(sources.map(({ actor, pair }) => [actor.id, {
    sourceId: actor.id, budget: scaleAffinityVitalEffect(1, pair.stacks), targets: [],
  } as ActorExposureSource]));
  const fields: ActorFieldCell[] = [];
  for (let y = 0; y < snapshot.dimensions.height; y++) {
    for (let x = 0; x < snapshot.dimensions.width; x++) {
      const position = { x, y };
      const emitters = new Map<number, ActorFieldCell>();
      const draws: ActorFieldCell[] = [];
      for (const { actor, pair } of sources) {
        const intensity = projectedIntensity(actor, pair, position);
        if (intensity <= 0) continue;
        const cell = { ...pair, sourceId: actor.id, position, intensity };
        const code = KIND_CODES[pair.kind];
        if (pair.expression === 'draw') draws.push(cell);
        else if (!emitters.has(code) || emitters.get(code)!.intensity < intensity) emitters.set(code, cell);
      }
      for (const [code, source] of emitters) {
        const opposite = getOppositeAffinityKind(code);
        const target = emitters.get(opposite);
        if (!target || opposite <= code) continue;
        const net = cancelAffinityOverlap(source.intensity, source.stacks, target.intensity, target.stacks);
        source.intensity = net.sourceIntensity; source.stacks = net.sourceStacks;
        target.intensity = net.targetIntensity; target.stacks = net.targetStacks;
      }
      const cells = [...emitters.values(), ...draws].filter(cell => cell.intensity > 0);
      fields.push(...cells);
      for (const receiver of actors.filter(actor => actor.position.x === x && actor.position.y === y)) {
        const active = activeActorAffinity(receiver);
        for (const cell of cells) {
          if (receiver.id === cell.sourceId) continue;
          let amount = scaleAffinityVitalEffect(cell.intensity, cell.stacks);
          const operation = getActorAffinityEffect(cell.kind, cell.expression).operation;
          if (operation === 'neutralize' && !cells.some(pending => pending.sourceId === receiver.id
            && pending.kind === cell.kind && pending.expression === 'emit')) continue;
          if (active && operation !== 'neutralize') {
            const relationship = resolveAffinityRelationshipCode(KIND_CODES[cell.kind], KIND_CODES[active.kind]);
            const interaction = deriveAffinityInteractionCell(EXPRESSION_CODES[cell.expression], EXPRESSION_CODES[active.expression], relationship);
            // Matching draw absorption is budgeted by the common resolver, never synthesized here.
            if (relationship === AffinityRelationship.Same && interaction?.targetEffect === AffinityEffect.None) amount = 0;
            if (relationship === AffinityRelationship.Opposite && (operation === 'damage' || operation === 'drain')) {
              amount *= OPPOSITE_EXPOSURE_AMPLIFICATION;
            }
          }
          if (amount > 0) exposures.get(cell.sourceId)!.targets.push({ targetId: receiver.id, amount });
        }
      }
    }
  }
  return { fields, sources: [...exposures.values()] };
}

/** One field pass; Moderator remains responsible for calling once after ordered actions. */
export function resolveActorFields(registry: Registry, suppressions: ActorEffectSuppression[] = []) {
  for (const entry of suppressions) {
    if (!entry || !Number.isFinite(entry.amount) || entry.amount < 0 || !registry.getActor(entry.sourceId)
      || !registry.getActor(entry.targetId)) throw new Error('invalid field suppression');
  }
  const projection = projectActorFields(registry);
  const pending = new Map(projection.sources.map(source => [source.sourceId, source]));
  const applied: { sourceId: string; targetId: string; amount: number }[] = [];
  for (const entry of suppressions) {
    const source = pending.get(entry.targetId);
    const actor = registry.getActor(entry.targetId);
    const pair = actor && activeActorAffinity(actor);
    if (!source || !pair || affinityKey(pair) !== entry.affinityKey) continue;
    const amount = Math.min(source.budget, entry.amount);
    source.budget -= amount;
    if (amount > 0) applied.push({ sourceId: entry.sourceId, targetId: entry.targetId, amount });
  }
  const result = resolveActorExposures(registry, projection.sources);
  // Re-observe after immediate defeats; this projects state without applying a second pulse.
  return { ...result, suppressions: [...applied, ...result.suppressions],
    fields: projectActorFields(registry).fields.filter(field => (pending.get(field.sourceId)?.budget ?? 0) > 0) };
}
