import type {
  ActorRecord, ActorAffinityEntry, ActorHolding, ActorPresentation,
  ActionV1, InitialStateArtifactV1, WorldStateArtifactV2,
} from '../../../packages/runtime/src/contracts/artifacts.ts';
import {
  ACTION_SCHEMA, INITIAL_STATE_SCHEMA, WORLD_STATE_SCHEMA,
} from '../../../packages/runtime/src/contracts/artifacts.ts';

const actor: ActorRecord = {
  id: 'a', alignment: 'external', position: { x: 1, y: 2 }, lifecycle: 'alive',
  defeatVital: 'health', vitals: { health: { current: 10, max: 10, regen: 0 } },
  capabilities: {
    canMove: true, canCast: true, canEquip: true, canTake: true, canExit: true,
    blocksMovement: true, blocksSight: false,
  },
  motivations: ['attacking', 'patrolling'],
  affinities: [
    { kind: 'fire', expression: 'emit', stacks: 1 },
    { kind: 'fire', expression: 'draw', stacks: 2 },
  ],
  activeAffinityKey: 'fire:draw', holdings: [],
};
const object: ActorRecord = {
  ...actor, id: 'b', alignment: 'dungeon', defeatVital: 'durability',
  vitals: { durability: { current: 3, max: 3, regen: 0 } },
};
const holding: ActorHolding = {
  id: 'fire:emit', kind: 'affinity', affinity: 'fire', expression: 'emit', claimedBy: null,
};
const presentation: ActorPresentation = { category: 'barrier' };
const meta = { id: 's', runId: 'r', createdAt: '2026-09-07T00:00:00Z', producedBy: 'test' };
const initial: InitialStateArtifactV1 = {
  schema: INITIAL_STATE_SCHEMA, schemaVersion: 1, meta,
  simConfigRef: { id: 'c', schema: 'config', schemaVersion: 1 },
  actors: [actor, object], presentation: { b: presentation },
};
const snapshot: WorldStateArtifactV2 = {
  schema: WORLD_STATE_SCHEMA, schemaVersion: 2, meta, tick: 0,
  dimensions: { width: 5, height: 5 }, actors: [actor, object], presentation: {},
};
const envelope = { schema: ACTION_SCHEMA, schemaVersion: 1, actorId: 'a', tick: 0 } as const;
const actions: ActionV1[] = [
  { ...envelope, kind: 'wait' },
  { ...envelope, kind: 'move', params: { target: { x: 2, y: 2 } } },
  { ...envelope, kind: 'cast_affinity', params: { targetId: 'b' } },
  { ...envelope, kind: 'equip_affinity', params: { affinityKey: 'fire:emit' } },
  { ...envelope, kind: 'take', params: { targetId: 'b', holdingId: holding.id } },
];
// @ts-expect-error conventional attacks are not simulation actions
const attack: ActionV1 = { ...envelope, kind: 'attack' };
// @ts-expect-error telemetry belongs to effects, not gameplay actions
const telemetry: ActionV1 = { ...envelope, kind: 'emit_telemetry' };
// @ts-expect-error taking requires the named holding, not only a target
const incompleteTake: ActionV1 = { ...envelope, kind: 'take', params: { targetId: 'b' } };
// @ts-expect-error equip requires an affinity/expression pair, not a bare affinity
const invalidEquip: ActionV1 = { ...envelope, kind: 'equip_affinity', params: { affinityKey: 'fire' } };
// @ts-expect-error casters cannot supply an arbitrary stack count
const inflatedCast: ActionV1 = { ...envelope, kind: 'cast_affinity', params: { targetId: 'b', stacks: 999 } };
// @ts-expect-error mana is owned by the actor, never an affinity entry
const pool: ActorAffinityEntry = { kind: 'fire', expression: 'emit', stacks: 1, mana: 10 };
// @ts-expect-error affinity loot has no transferable stack quantity
const inflatedLoot: ActorHolding = { ...holding, stacks: 8 };
// @ts-expect-error category metadata is not mechanical actor state
const categorized: ActorRecord = { ...actor, category: 'warden' };
// @ts-expect-error a health-governed actor must have a health vital
const missingDefeatVital: ActorRecord = { ...actor, defeatVital: 'health', vitals: {} };
// @ts-expect-error core identity is a stable string, not an array index
const numericId: ActorRecord = { ...actor, id: 1 };
// @ts-expect-error snapshots contain one registry, not a separate hazard collection
const splitState: WorldStateArtifactV2 = { ...snapshot, hazards: [] };
// @ts-expect-error historical world-state envelope shapes are not accepted
const oldSnapshot: WorldStateArtifactV2 = { ...snapshot, schemaVersion: 1 };
void [initial, snapshot, actions];
