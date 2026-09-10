import { validateActorRecordVitals } from '../../../../core-ts/src/state/actor-vitals.ts';
import { validateActorInventory } from '../../../../core-ts/src/state/actor-inventory.ts';
import { validateActorHoldings } from '../../../../core-ts/src/state/actor-holdings.ts';

const PRESETS = Object.freeze({
  delver: { alignment: 'external', defeatVital: 'health', canMove: true, blocksMovement: true },
  warden: { alignment: 'dungeon', defeatVital: 'health', canMove: true, blocksMovement: true },
  hazard: { alignment: 'dungeon', defeatVital: 'durability', canMove: false, blocksMovement: false },
  resource: { alignment: 'dungeon', defeatVital: 'durability', canMove: false, blocksMovement: false },
  barrier: { alignment: 'dungeon', defeatVital: 'durability', canMove: false, blocksMovement: true },
});
const INPUT_KEYS = new Set(['category', 'id', 'position', 'alignment', 'lifecycle', 'defeatVital',
  'vitals', 'capabilities', 'motivations', 'affinities', 'activeAffinityKey', 'holdings']);

/** Pure authoring helper. Defaults select properties; presentation never selects core rules. */
export function normalizeActorDefinition(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || Object.keys(input).some(key => !INPUT_KEYS.has(key))
    || !Object.hasOwn(PRESETS, input.category)) throw new Error('invalid unified actor definition');
  const request = structuredClone(input);
  const preset = PRESETS[request.category];
  const value = (key, fallback) => Object.hasOwn(request, key) ? request[key] : fallback;
  if (typeof request.id !== 'string' || !request.id.trim() || !request.position
    || Object.keys(request.position).length !== 2
    || !Number.isSafeInteger(request.position.x) || !Number.isSafeInteger(request.position.y)
    || request.position.x < 0 || request.position.y < 0) throw new Error('invalid actor identity/position');
  if (request.capabilities !== undefined && (!request.capabilities || typeof request.capabilities !== 'object'
    || Array.isArray(request.capabilities))) throw new Error('invalid actor capabilities');
  const actor = {
    id: request.id, position: request.position,
    alignment: value('alignment', preset.alignment),
    lifecycle: value('lifecycle', 'alive'), defeatVital: value('defeatVital', preset.defeatVital),
    vitals: request.vitals,
    capabilities: {
      canMove: preset.canMove, canCast: true, canEquip: preset.canMove, canTake: preset.canMove,
      canExit: request.category === 'delver', blocksMovement: preset.blocksMovement,
      blocksSight: request.category === 'barrier', ...request.capabilities,
    },
    motivations: value('motivations', []), affinities: value('affinities', []),
    activeAffinityKey: value('activeAffinityKey', null), holdings: value('holdings', []),
  };
  validateActorRecordVitals(actor);
  validateActorInventory(actor);
  validateActorHoldings(actor);
  return { actor, presentation: { category: request.category } };
}
