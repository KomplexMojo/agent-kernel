import type { createActorRegistry } from '../state/actor-registry.ts';
import type { ActorAffinityEntry, ActorAffinityKey, ActorPosition, ActorRecord } from '../state/actor-types.ts';
import { affinityIntensity, affinityKey, equippedActorAffinities } from '../state/actor-inventory.ts';
import { actorAffinityMagnitude, getActorAffinityEffect, resolveActorAffinity, type ActorVitalChange } from './actor-affinity.ts';
import { receiverAbsorbsAffinity, receiverAffinityAmount } from './actor-receiver.ts';
import { affinityTableRow } from '../state/affinity-table.ts';
import { lineOfSightSteps } from '../state/visibility.ts';

/** Configurator-authored per-kind base prices for the escalating cast curve (#232). */
export type ActorCastManaBases = Partial<Record<ActorAffinityKey, number>>;
/** The cast prices a turn carries: the bases of the escalating curve, never a tier table. */
export type ActorCastPrices = { castManaBase: ActorCastManaBases };

/**
 * The mana a push or pull costs (maintainer, 2026-10-13, #232; #340): the kind's base
 * times its intensity times the triangular number r(r+1)/2 of its range, with no cap,
 * so every tile of reach costs more than the last and a harder hit costs in step with
 * its intensity. The curve is the rule; the base is the Configurator's tuning.
 */
export function actorCastManaPrice(base: number, range: number, intensity = 1): number {
  return base * intensity * range * (range + 1) / 2;
}

const isPrice = (value: unknown): boolean => Number.isSafeInteger(value) && (value as number) >= 0;

/** Throws unless `prices` is a valid base map. */
export function assertActorCastPrices(prices: ActorCastPrices): void {
  if (!prices || typeof prices !== 'object' || !prices.castManaBase || typeof prices.castManaBase !== 'object'
    || Array.isArray(prices.castManaBase) || !Object.values(prices.castManaBase).every(isPrice)) {
    throw new Error('invalid authored cast prices');
  }
}

/** The authored price of one cast; undefined when the key has no price. */
function castManaCost(prices: ActorCastPrices, pair: ActorAffinityEntry): number | undefined {
  const base = prices.castManaBase[affinityKey(pair)];
  return base === undefined ? undefined : actorCastManaPrice(base, pair.stacks, affinityIntensity(pair));
}
export interface ActorDisplacement { actorId: string; from: ActorPosition; to: ActorPosition }
export interface ActorSoak { actorId: string; turns: number }
export interface ActorCastResult {
  accepted: boolean;
  changes: ActorVitalChange[];
  /** #420: whom a soaking cast soaked, and for how many turns. */
  soaked?: ActorSoak[];
  /** #419: where a displacing cast moved its target; empty when it moved nothing. */
  displaced?: ActorDisplacement[];
  /** Why the cast was refused, as a ValidationError name; absent when accepted. */
  rejection?: string;
}

/** Only push and pull are cast; emit and draw work on their own while equipped. */
export function isCastableExpression(expression: string): boolean {
  return expression === 'push' || expression === 'pull';
}

/** How far a cast reaches, in tiles (Chebyshev): one per stack of range it runs at (#231, #340). */
export function actorCastRange(pair: ActorAffinityEntry): number {
  return pair.stacks;
}

/** The actor's equipped push and pull slots, keyed, with how far each reaches. */
export function actorCastableAffinities(actor: ActorRecord): Partial<Record<ActorAffinityKey, { range: number }>> {
  return Object.fromEntries(equippedActorAffinities(actor)
    .filter(pair => isCastableExpression(pair.expression))
    .map(pair => [affinityKey(pair), { range: actorCastRange(pair) }]));
}

/**
 * The equipped slot a cast uses: the one it names, else the first equipped push
 * or pull. A ValidationError name when there is none to use.
 */
export function selectActorCastAffinity(actor: ActorRecord, key?: ActorAffinityKey): ActorAffinityEntry | string {
  const equipped = equippedActorAffinities(actor);
  if (key !== undefined) {
    const named = equipped.find(pair => affinityKey(pair) === key);
    if (!named) return 'AffinityNotEquipped';
    return isCastableExpression(named.expression) ? named : 'AffinityNotCastable';
  }
  if (!equipped.length) return 'NoActiveAffinity';
  return equipped.find(pair => isCastableExpression(pair.expression)) ?? 'AffinityNotCastable';
}

/**
 * Focused effect primitive. Every cast is a direct effect (#354): a pull steals like any
 * other inward use; nothing is suppressed or carried to a later action.
 */
/** #420: extra stamina each move costs while soaked. */
export const SOAK_MOVE_STAMINA = 1;

/** #420: the `soak` trait soaks what it lands on for its intensity in turns. */
export function soakTurns(pair: Pick<ActorAffinityEntry, 'kind'> & Partial<ActorAffinityEntry>, intensity: number): number {
  return affinityTableRow(pair.kind)?.trait === 'soak' && intensity > 0 ? intensity : 0;
}

type DisplaceRegistry = Pick<ReturnType<typeof createActorRegistry>, 'getActor' | 'explainMove' | 'moveActor' | 'getActorsAt'>;
type SoakRegistry = Pick<ReturnType<typeof createActorRegistry>, 'soakActor'>;

/**
 * #419, #482 (Darren, 2026-10-26): every kind's landed push moves the target away from the
 * caster and every pull toward it, one cell a step (king moves, along the sign of each axis),
 * as many steps as the cast's intensity. A step goes only into a free cell: a wall, the board's
 * edge, any living actor (the caster included) or a target that cannot move stops it there,
 * with no extra harm. Costs the target no stamina.
 */
function displaceTarget(registry: DisplaceRegistry, sourceId: string, targetId: string,
  pair: ActorAffinityEntry): ActorDisplacement[] {
  const source = registry.getActor(sourceId)!;
  const from = registry.getActor(targetId)?.position;
  if (!from) return [];
  const away = pair.expression === 'push' ? 1 : -1;
  const step = { x: Math.sign(from.x - source.position.x) * away, y: Math.sign(from.y - source.position.y) * away };
  if (step.x === 0 && step.y === 0) return [];
  let at = from;
  for (let moved = 0; moved < Math.max(1, affinityIntensity(pair)); moved += 1) {
    const next = { x: at.x + step.x, y: at.y + step.y };
    if (registry.explainMove(targetId, next) !== null
      || registry.getActorsAt(next).some(other => other.lifecycle === 'alive')) break;
    registry.moveActor(targetId, next);
    at = next;
  }
  return at === from ? [] : [{ actorId: targetId, from: { ...from }, to: { ...at } }];
}

export function castFocusedActorAffinity(
  registry: Pick<ReturnType<typeof createActorRegistry>, 'getActor' | 'changeVital'> & Partial<DisplaceRegistry> & Partial<SoakRegistry>,
  sourceId: string, targetId: string, manaCosts: ActorCastPrices, castKey?: ActorAffinityKey,
): ActorCastResult {
  assertActorCastPrices(manaCosts);
  const reject = (rejection: string): ActorCastResult => ({ accepted: false, changes: [], rejection });
  const source = registry.getActor(sourceId); const target = registry.getActor(targetId);
  if (source?.lifecycle !== 'alive') return reject('WrongActor');
  if (!source.capabilities.canCast) return reject('InvalidCapability');
  const pair = selectActorCastAffinity(source, castKey);
  if (typeof pair === 'string') return reject(pair);
  if (target?.lifecycle !== 'alive') return reject('InvalidTarget');
  if (Math.max(Math.abs(source.position.x - target.position.x),
    Math.abs(source.position.y - target.position.y)) > actorCastRange(pair)) return reject('TargetOutOfRange');
  const effect = getActorAffinityEffect(pair.kind, pair.expression);
  if (effect.operation === 'drain' && sourceId === targetId) return reject('InvalidTarget');
  const cost = castManaCost(manaCosts, pair);
  if (cost === undefined) return reject('InvalidActionValue');
  if ((source.vitals.mana?.current ?? 0) < cost) return reject('InsufficientMana');
  const changes: ActorVitalChange[] = [];
  const pay = () => { if (cost > 0) changes.push({ actorId: sourceId, vital: 'mana', delta: registry.changeVital(sourceId, 'mana', -cost) }); };
  // #413: a pull on a barrier, of any kind, takes it down.
  if (pair.expression === 'pull' && sourceId !== targetId && isBarrierActor(target)) {
    pay();
    const down = registry.changeVital(targetId, target.defeatVital, -target.vitals[target.defeatVital]!.current);
    return { accepted: true, changes: down !== 0 ? [...changes, { actorId: targetId, vital: target.defeatVital, delta: down }] : changes };
  }
  const amount = actorAffinityMagnitude(pair.expression, affinityIntensity(pair));
  // The receiver rules fields apply (#348): a same-kind draw absorbs into mana, a same-kind
  // slot the interaction table makes immune takes nothing, an opposite slot doubles harm.
  // A cast at oneself meets none of them, as a field never exposes its own source.
  if (sourceId !== targetId && receiverAbsorbsAffinity(target, pair)) {
    pay();
    const mana = registry.changeVital(targetId, 'mana', amount);
    return { accepted: true, changes: mana !== 0 ? [...changes, { actorId: targetId, vital: 'mana', delta: mana }] : changes };
  }
  const received = sourceId === targetId ? amount : receiverAffinityAmount(target, pair, amount);
  // #369: every use costs mana. The price is taken after the effect, so mana the cast brings
  // back to the caster (a mana steal, a mana restore on itself) cannot refund it.
  const effects = resolveActorAffinity(registry, sourceId, targetId, pair.kind, pair.expression, received).changes;
  const paid = cost > 0 ? registry.changeVital(sourceId, 'mana', -cost) : 0;
  // #419: a hit that lands (not a self-cast, not one the receiver takes nothing from) displaces.
  const lands = sourceId !== targetId && received > 0;
  // #420: a landed soak-trait push soaks its target (before any displacement, on the actor hit).
  const turns = lands && pair.expression === 'push' ? soakTurns(pair, affinityIntensity(pair)) : 0;
  const soaked = turns > 0 && registry.soakActor?.(targetId, turns) ? [{ actorId: targetId, turns }] : [];
  const displaced = lands && registry.moveActor
    ? displaceTarget(registry as DisplaceRegistry, sourceId, targetId, pair) : [];
  return { accepted: true, changes: [...changes, ...effects,
    ...(paid !== 0 ? [{ actorId: sourceId, vital: 'mana' as const, delta: paid }] : [])], displaced, soaked };
}

/** A barrier: it stands in the way and never moves (the `barrier` preset, authored or raised). */
export function isBarrierActor(actor: Pick<ActorRecord, 'capabilities'>): boolean {
  return actor.capabilities.blocksMovement && !actor.capabilities.canMove;
}

/**
 * A raised barrier's numbers (#413, Darren 2026-10-18): it is invested with 10 × intensity²
 * mana and has 10 × intensity² durability. It pays `RAISED_BARRIER_UPKEEP` mana a turn; once
 * the investment is spent it erodes `RAISED_BARRIER_EROSION` durability a turn until gone.
 */
export const RAISED_BARRIER_INVESTMENT_PER_INTENSITY_SQUARED = 10;
export const RAISED_BARRIER_UPKEEP = 1;
export const RAISED_BARRIER_EROSION = 1;
/**
 * The movement-kind a raised barrier's cell carries in an observation: it blocks now and
 * erodes in time, so an Actor may route through it when there is no other way (#413).
 */
export const RAISED_BARRIER_TILE_KIND = 2;

/** #534: `raiseScale` is the raising kind's table column (2 for earth, 1 for the rest). */
export function raisedBarrierStats(intensity: number, raiseScale = 1): { mana: number; durability: number } {
  const amount = RAISED_BARRIER_INVESTMENT_PER_INTENSITY_SQUARED * intensity * intensity * raiseScale;
  return { mana: amount, durability: amount };
}

/**
 * The cells a raise covers (#413): `range` cells in a line across the cast, centred on the
 * target tile, alternating sides (target, one side, the other, ...). A side stops at the
 * first cell `isOpen` refuses.
 */
export function raisedBarrierCells(from: ActorPosition, target: ActorPosition, range: number,
  isOpen: (cell: ActorPosition) => boolean = () => true): ActorPosition[] {
  if (range <= 0 || !isOpen(target)) return [];
  const dx = Math.sign(target.x - from.x); const dy = Math.sign(target.y - from.y);
  const across = { x: -dy, y: dx };
  const cells = [{ x: target.x, y: target.y }];
  const open = [true, true];
  for (let step = 1; cells.length < range && (open[0] || open[1]); step += 1) {
    for (const [side, sign] of [[0, 1], [1, -1]] as const) {
      if (!open[side] || cells.length >= range) continue;
      const cell = { x: target.x + sign * step * across.x, y: target.y + sign * step * across.y };
      if ((across.x === 0 && across.y === 0) || !isOpen(cell)) { open[side] = false; continue; }
      cells.push(cell);
    }
  }
  return cells;
}

export interface ActorTileCastResult extends ActorCastResult {
  raised: string[];
  /** #463: the cells the cast crossed, the struck actor's cell included; empty for a self-cast. */
  path?: ActorPosition[];
  /** #463: the actor the cast struck, if any. */
  struckId?: string;
}

type TileCastRegistry = Pick<ReturnType<typeof createActorRegistry>, 'getActor' | 'changeVital' | 'getActorsAt'
  | 'isMovementBlocked' | 'isWall' | 'raiseBarrierAt' | 'leaveCastTrail'>;

// The checks a cast and a raise at a tile share: a living caster that can cast, its slot, and reach.
function tileCastPair(registry: TileCastRegistry, sourceId: string, target: ActorPosition,
  castKey?: ActorAffinityKey): ActorAffinityEntry | string {
  const source = registry.getActor(sourceId);
  if (source?.lifecycle !== 'alive') return 'WrongActor';
  if (!source.capabilities.canCast) return 'InvalidCapability';
  const pair = selectActorCastAffinity(source, castKey);
  if (typeof pair === 'string') return pair;
  if (!target || !Number.isSafeInteger(target.x) || !Number.isSafeInteger(target.y)) return 'InvalidTarget';
  if (Math.max(Math.abs(source.position.x - target.x), Math.abs(source.position.y - target.y)) > actorCastRange(pair)) {
    return 'TargetOutOfRange';
  }
  return pair;
}

/**
 * A cast aimed at a tile: free aim (#414, #461). It travels the line sight uses from the caster
 * and stops at the first living actor, which it hits as a cast at that actor does (a friendly
 * included, #336; a pull on a barrier takes it down), or at a wall, landing on the last free
 * cell. A push that meets no actor leaves a one-turn field of its kind and intensity on every
 * cell it crossed (`leaveCastTrail`): light lights it, a harmful kind harms whoever is in it
 * when the tick's fields resolve. A pull that meets no actor does nothing. The price is the
 * same whether it hits or not. A cast at the caster's own tile is a cast at itself.
 */
export function castActorAffinityAtTile(
  registry: TileCastRegistry,
  sourceId: string, target: ActorPosition, manaCosts: ActorCastPrices, castKey?: ActorAffinityKey,
): ActorTileCastResult {
  assertActorCastPrices(manaCosts);
  const reject = (rejection: string): ActorTileCastResult => ({ accepted: false, changes: [], raised: [], rejection });
  const pair = tileCastPair(registry, sourceId, target, castKey);
  if (typeof pair === 'string') return reject(pair);
  const source = registry.getActor(sourceId)!;
  const hit = (targetId: string, path: ActorPosition[]): ActorTileCastResult =>
    ({ ...castFocusedActorAffinity(registry, sourceId, targetId, manaCosts, affinityKey(pair)), raised: [], path, struckId: targetId });
  if (source.position.x === target.x && source.position.y === target.y) return hit(sourceId, []);
  const cost = castManaCost(manaCosts, pair);
  if (cost === undefined) return reject('InvalidActionValue');
  if ((source.vitals.mana?.current ?? 0) < cost) return reject('InsufficientMana');
  const crossed: ActorPosition[] = [];
  for (const { cell, corner } of lineOfSightSteps(source.position, target)) {
    if (corner && (registry.isWall(corner[0]) || registry.isWall(corner[1]))) break;
    const struck = registry.getActorsAt(cell).find(actor => actor.lifecycle === 'alive' && actor.id !== sourceId);
    if (struck) return hit(struck.id, [...crossed, { x: cell.x, y: cell.y }]);
    if (registry.isWall(cell)) break;
    crossed.push(cell);
  }
  if (pair.expression === 'push') {
    registry.leaveCastTrail({ sourceId, kind: pair.kind, stacks: pair.stacks, intensity: affinityIntensity(pair), cells: crossed });
  }
  const paid = cost > 0 ? registry.changeVital(sourceId, 'mana', -cost) : 0;
  return { accepted: true, raised: [], path: crossed,
    changes: paid !== 0 ? [{ actorId: sourceId, vital: 'mana', delta: paid }] : [] };
}

/**
 * Raise barriers at a tile (#413; its own action since #460, Darren 2026-10-24). An equipped
 * push into an empty, open tile within range raises a line of barriers of the caster's kind,
 * owned by the caster, for the push's ordinary price. Anything else is refused.
 */
export function raiseActorBarriersAt(
  registry: TileCastRegistry,
  sourceId: string, target: ActorPosition, manaCosts: ActorCastPrices, castKey?: ActorAffinityKey,
): ActorTileCastResult {
  assertActorCastPrices(manaCosts);
  const reject = (rejection: string): ActorTileCastResult => ({ accepted: false, changes: [], raised: [], rejection });
  const pair = tileCastPair(registry, sourceId, target, castKey);
  if (typeof pair === 'string') return reject(pair);
  const source = registry.getActor(sourceId)!;
  const empty = (cell: ActorPosition) => !registry.isMovementBlocked(cell)
    && !registry.getActorsAt(cell).some(actor => actor.lifecycle === 'alive');
  if (pair.expression !== 'push' || !empty(target)) return reject('InvalidTarget');
  const cost = castManaCost(manaCosts, pair);
  if (cost === undefined) return reject('InvalidActionValue');
  if ((source.vitals.mana?.current ?? 0) < cost) return reject('InsufficientMana');
  const intensity = affinityIntensity(pair);
  const { mana, durability } = raisedBarrierStats(intensity, affinityTableRow(pair.kind)?.raiseScale ?? 1);
  const raised: string[] = [];
  for (const cell of raisedBarrierCells(source.position, target, actorCastRange(pair), empty)) {
    const id = registry.raiseBarrierAt(cell, {
      alignment: source.alignment, lifecycle: 'alive', raisedBy: sourceId, defeatVital: 'durability',
      vitals: { durability: { current: durability, max: durability, regen: 0 }, mana: { current: mana, max: mana, regen: 0 } },
      capabilities: { canMove: false, canCast: false, canEquip: false, canTake: false, canExit: false,
        blocksMovement: true, blocksSight: true },
      motivations: [], affinities: [{ kind: pair.kind, expression: 'push', stacks: 1, intensity }],
      activeAffinityKey: `${pair.kind}:push`, holdings: [],
    });
    if (id) raised.push(id);
  }
  const paid = cost > 0 ? registry.changeVital(sourceId, 'mana', -cost) : 0;
  return { accepted: true, raised, changes: paid !== 0 ? [{ actorId: sourceId, vital: 'mana', delta: paid }] : [] };
}
