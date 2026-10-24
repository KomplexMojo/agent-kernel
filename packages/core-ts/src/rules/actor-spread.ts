import type { createActorRegistry } from '../state/actor-registry.ts';
import type { ActorPosition, ActorSpreadEmber, AffinityKind } from '../state/actor-types.ts';
import { AFFINITY_KIND_BY_CODE } from '../affinity-readers.ts';
import { getOppositeAffinityKind } from '../state/affinity.ts';
import { affinityTableRow } from '../state/affinity-table.ts';
import { projectActorFieldsAt } from './actor-fields.ts';

type Registry = Pick<ReturnType<typeof createActorRegistry>, 'isWall' | 'snapshot' | 'spreadEmbers' | 'replaceSpreadEmbers'>;

const KIND_CODES = Object.fromEntries(Object.entries(AFFINITY_KIND_BY_CODE).map(([code, name]) => [name, Number(code)]));
/** The eight neighbours a creep may move to, in a fixed order the seeded pick indexes. */
const NEIGHBOURS = Object.freeze([[0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1]] as const);

/** Whether a kind's row carries the `spread` trait (#421): the table decides, never a kind name. */
export function affinitySpreads(kind: AffinityKind): boolean {
  return affinityTableRow(kind)?.trait === 'spread';
}

/** FNV-1a over the run seed, the tick and the ember: a pure, seeded pick that never reads a clock. */
function spreadPick(seed: number, tick: number, ember: ActorSpreadEmber, choices: number): number {
  let hash = 0x811c9dc5;
  for (const char of `${seed}|${tick}|${ember.sourceId}|${ember.kind}|${ember.position.x},${ember.position.y}|${ember.intensity}`) {
    hash = Math.imul(hash ^ char.charCodeAt(0), 0x01000193) >>> 0;
  }
  return hash % choices;
}

/**
 * Each new tick, every creeping field moves on (#421): to a seeded random neighbour that is
 * not a wall, one intensity weaker. It goes out at 0, with nowhere to go, or on a cell where
 * a lasting field of the opposite kind is at least as strong. Costs no mana.
 */
export function creepSpreadEmbers(registry: Registry, tick: number, seed: number): void {
  const embers = registry.spreadEmbers();
  if (embers.length === 0) return;
  const alive = registry.snapshot().actors.filter(actor => actor.lifecycle === 'alive');
  const next: ActorSpreadEmber[] = [];
  for (const ember of embers) {
    const intensity = ember.intensity - 1;
    if (intensity <= 0) continue;
    const open: ActorPosition[] = NEIGHBOURS.map(([dx, dy]) => ({ x: ember.position.x + dx, y: ember.position.y + dy }))
      .filter(cell => !registry.isWall(cell));
    if (open.length === 0) continue;
    const cell = open[spreadPick(seed, tick, ember, open.length)];
    const opposite = AFFINITY_KIND_BY_CODE[getOppositeAffinityKind(KIND_CODES[ember.kind])];
    if (projectActorFieldsAt(alive, cell).some(field => field.kind === opposite && field.intensity >= intensity)) continue;
    const { fresh: _landed, ...moved } = ember;
    next.push({ ...moved, intensity, position: cell });
  }
  registry.replaceSpreadEmbers(next);
}
