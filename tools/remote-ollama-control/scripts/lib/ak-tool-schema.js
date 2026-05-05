'use strict';

const AFFINITY_ENUM = [
  'fire', 'water', 'earth', 'wind',
  'life', 'decay', 'corrode', 'fortify',
  'light', 'dark'
];

const AK_CREATE_TOOL = {
  type: 'function',
  function: {
    name: 'ak_create',
    description:
      'Create agent-kernel game elements (delvers, wardens, rooms, traps, hazards, resources) ' +
      'for a dungeon scenario. Rooms are generic containers — affinity pressure belongs in ' +
      'traps or hazards, not in room specs.',
    parameters: {
      type: 'object',
      required: ['text', 'budgetTokens', 'runId', 'outDir'],
      properties: {
        text: {
          type: 'string',
          description: 'Freeform authoring text describing what to create.'
        },
        budgetTokens: {
          type: 'integer',
          description: 'Hard budget cap in tokens (typically 1500).',
          minimum: 1
        },
        runId: {
          type: 'string',
          description: 'Unique identifier for this generation run.'
        },
        outDir: {
          type: 'string',
          description: 'Output directory for generated artifacts.'
        },
        emitIntermediates: {
          type: 'boolean',
          description: 'Persist intermediate sidecar artifacts.',
          default: true
        },
        dungeonAffinity: {
          type: 'string',
          description: 'Overall dungeon affinity theme.',
          enum: AFFINITY_ENUM
        },
        room: {
          type: 'array',
          items: { type: 'string' },
          description: 'Room specs (repeatable): size=<small|medium|large>;count=<n>'
        },
        floorTile: {
          type: 'array',
          items: { type: 'string' },
          description: 'Floor tile specs (repeatable): count=<n>[;id=<id>]'
        },
        trap: {
          type: 'array',
          items: { type: 'string' },
          description: 'Trap specs (repeatable): x=<n>;y=<n>;affinity=<kind>[;expression=<push|pull|emit|draw>][;stacks=<n>][;blocking=<true|false>]'
        },
        hazard: {
          type: 'array',
          items: { type: 'string' },
          description: 'Hazard specs (repeatable): affinity=<kind>;expression=<push|pull|emit|draw>;proximityRadius=<n>[;mana=one-time:<amount>|regen:<cur>:<max>:<regen>]'
        },
        resource: {
          type: 'array',
          items: { type: 'string' },
          description: 'Resource specs (repeatable): tier=<level|permanent>;stat=<kind>;delta=<n>;dropRate=<n>'
        },
        delver: {
          type: 'array',
          items: { type: 'string' },
          description: 'Delver specs (repeatable): count=<n>;affinity=<kind>;motivation=<kind>[;affinities=<kind>:<expr>:<stacks>,...][;vitals=<vital>:<max>:<regen>,...]'
        },
        warden: {
          type: 'array',
          items: { type: 'string' },
          description: 'Warden specs (repeatable): count=<n>;affinity=<kind>;motivation=<kind>[;affinities=<kind>:<expr>:<stacks>,...][;vitals=<vital>:<max>:<regen>,...]'
        }
      }
    }
  }
};

module.exports = { AK_CREATE_TOOL, AFFINITY_ENUM };
