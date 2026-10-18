import type { ActorAffinityEntry, ActorRecord } from '../state/actor-types.ts';
import { equippedActorAffinities } from '../state/actor-inventory.ts';
import { AFFINITY_KIND_BY_CODE, AFFINITY_EXPRESSION_BY_CODE } from '../affinity-readers.ts';
import { resolveAffinityRelationshipCode, AffinityRelationship } from '../state/affinity.ts';
import { deriveAffinityInteractionCell, AffinityEffect, OPPOSITE_EXPOSURE_AMPLIFICATION } from '../state/affinity-spatial.ts';
import { getActorAffinityEffect } from './actor-affinity.ts';

const KIND_CODES = Object.fromEntries(Object.entries(AFFINITY_KIND_BY_CODE).map(([code, name]) => [name, Number(code)]));
const EXPRESSION_CODES = Object.fromEntries(Object.entries(AFFINITY_EXPRESSION_BY_CODE).map(([code, name]) => [name, Number(code)]));

type Incoming = Pick<ActorAffinityEntry, 'kind' | 'expression'>;

/** An outward (push or emit) effect of `kind` meets a same-kind draw on the receiver: its mana takes it. */
export function receiverAbsorbsAffinity(receiver: ActorRecord, incoming: Incoming): boolean {
  return (incoming.expression === 'push' || incoming.expression === 'emit')
    && equippedActorAffinities(receiver).some(pair => pair.kind === incoming.kind && pair.expression === 'draw');
}

/**
 * The receiver rules every affinity effect meets, from a field or a cast alike (#348), over
 * every equipped slot: a matching draw absorbs first (the caller routes it into mana), then
 * a same-kind slot that the interaction table makes immune takes nothing, then any opposite
 * slot doubles damage and drain. Returns the amount that reaches the receiver.
 */
export function receiverAffinityAmount(receiver: ActorRecord, incoming: Incoming, amount: number): number {
  const equipped = equippedActorAffinities(receiver);
  if (!equipped.length || receiverAbsorbsAffinity(receiver, incoming)) return amount;
  const operation = getActorAffinityEffect(incoming.kind, incoming.expression).operation;
  const relationships = equipped.map(pair => {
    const relationship = resolveAffinityRelationshipCode(KIND_CODES[incoming.kind], KIND_CODES[pair.kind]);
    return { relationship, interaction: deriveAffinityInteractionCell(EXPRESSION_CODES[incoming.expression], EXPRESSION_CODES[pair.expression], relationship) };
  });
  if (relationships.some(({ relationship, interaction }) => relationship === AffinityRelationship.Same
    && interaction?.targetEffect === AffinityEffect.None)) return 0;
  if (relationships.some(({ relationship }) => relationship === AffinityRelationship.Opposite)
    && (operation === 'damage' || operation === 'drain')) return amount * OPPOSITE_EXPOSURE_AMPLIFICATION;
  return amount;
}
