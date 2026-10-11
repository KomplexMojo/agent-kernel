import { INITIAL_STATE_SCHEMA, SIM_CONFIG_SCHEMA } from '../../contracts/artifacts.ts';
import { normalizeActorRoster } from './unified-actors.js';
import { resolveActorTurnCosts } from './affinity-rules.js';

const LAYOUT_FIELDS = new Set(['width', 'height', 'terrain', 'rooms', 'connectivity',
  'bounds', 'entryRoomId', 'exitRoomId', 'spawnApproach', 'exitApproach', 'render']);
const LEFTOVER_LAYOUT_FIELDS = new Set(['hazards', 'resources', 'tiles', 'kinds', 'actors',
  'spawn', 'exit', 'legend']);
function cloneLayoutData(layout) {
  if (!layout || typeof layout !== 'object' || Array.isArray(layout)) {
    throw new Error(`invalid normalized layout: expected object, received ${typeof layout}`);
  }
  const geometry = { ...layout };
  delete geometry.budgetScaffold;
  for (const key of LEFTOVER_LAYOUT_FIELDS) delete geometry[key];
  const unknown = Object.keys(geometry).filter(key => !LAYOUT_FIELDS.has(key));
  if (unknown.length) throw new Error(`unsupported normalized layout fields: ${unknown.join(', ')}`);
  normalizeActorRoster({ actors: [], dimensions: { width: geometry.width, height: geometry.height }, terrain: geometry.terrain });
  return structuredClone(geometry);
}

export function buildSimConfigArtifact({
  meta, planRef, budgetReceiptRef, seed = 0, layout, flags, executionPolicy,
  constraints, affinityRules, movementStamina,
} = {}) {
  const artifact = {
    schema: SIM_CONFIG_SCHEMA, schemaVersion: 1, meta, planRef, seed,
    layout: { kind: 'grid', data: cloneLayoutData(layout) },
    actionCosts: resolveActorTurnCosts({ rules: affinityRules, movementStamina }),
  };
  if (budgetReceiptRef) artifact.budgetReceiptRef = budgetReceiptRef;
  if (executionPolicy) artifact.executionPolicy = executionPolicy;
  if (flags) artifact.flags = flags;
  if (constraints) artifact.constraints = constraints;
  return structuredClone(artifact);
}

export function buildInitialStateArtifact({
  meta, simConfigRef, actors, dimensions, terrain, ...unsupported
} = {}) {
  const keys = Object.keys(unsupported);
  if (keys.length) throw new Error(`unsupported initial-state inputs: ${keys.join(', ')}`);
  const roster = normalizeActorRoster({ actors, dimensions, terrain });
  return structuredClone({ schema: INITIAL_STATE_SCHEMA, schemaVersion: 1,
    meta, simConfigRef, actors: roster.actors, presentation: roster.presentation });
}
