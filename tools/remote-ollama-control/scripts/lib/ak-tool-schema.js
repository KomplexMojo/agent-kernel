'use strict';

const AFFINITY_ENUM = [
  'fire', 'water', 'earth', 'wind',
  'life', 'decay', 'corrode', 'fortify',
  'light', 'dark'
];

const EXPRESSION_ENUM = ['push', 'pull', 'emit', 'draw'];
const MOTIVATION_ENUM = ['attacking', 'defending', 'exploring', 'patrolling', 'guarding'];
const SIZE_ENUM = ['small', 'medium', 'large'];
const PRIORITY_ENUM = ['high', 'medium', 'low'];

const VITAL_CONFIG = {
  type: 'object',
  properties: {
    max: { type: 'integer', minimum: 1, description: 'Maximum value' },
    regen: { type: 'integer', minimum: 0, description: 'Regen per tick' }
  },
  required: ['max']
};

const ACTOR_AFFINITY_ITEM = {
  type: 'object',
  properties: {
    kind: { type: 'string', enum: AFFINITY_ENUM },
    expression: { type: 'string', enum: EXPRESSION_ENUM },
    stacks: { type: 'integer', minimum: 1, default: 1 }
  },
  required: ['kind', 'expression']
};

const ACTOR_SPEC = {
  type: 'object',
  properties: {
    count: { type: 'integer', minimum: 1 },
    affinity: { type: 'string', enum: AFFINITY_ENUM },
    motivation: { type: 'string', enum: MOTIVATION_ENUM },
    vitals: {
      type: 'object',
      description: 'Vital stat settings',
      properties: {
        health: VITAL_CONFIG,
        stamina: VITAL_CONFIG,
        mana: VITAL_CONFIG
      }
    },
    affinities: {
      type: 'array',
      items: ACTOR_AFFINITY_ITEM,
      description: 'Additional affinity expressions beyond the primary'
    },
    goals: {
      type: 'object',
      description: 'Goal priorities keyed by goal name',
      additionalProperties: { type: 'string', enum: PRIORITY_ENUM }
    }
  },
  required: ['count', 'affinity', 'motivation']
};

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
          description: 'Rooms to create.',
          items: {
            type: 'object',
            properties: {
              size: { type: 'string', enum: SIZE_ENUM },
              count: { type: 'integer', minimum: 1, default: 1 }
            },
            required: ['size']
          }
        },
        floorTile: {
          type: 'array',
          description: 'Floor tile groups.',
          items: {
            type: 'object',
            properties: {
              count: { type: 'integer', minimum: 1 },
              id: { type: 'string' }
            },
            required: ['count']
          }
        },
        trap: {
          type: 'array',
          description: 'Traps to place.',
          items: {
            type: 'object',
            properties: {
              x: { type: 'integer', description: 'Grid x coordinate' },
              y: { type: 'integer', description: 'Grid y coordinate' },
              affinity: { type: 'string', enum: AFFINITY_ENUM },
              expression: { type: 'string', enum: EXPRESSION_ENUM },
              stacks: { type: 'integer', minimum: 1 },
              blocking: { type: 'boolean', default: false }
            },
            required: ['x', 'y', 'affinity']
          }
        },
        hazard: {
          type: 'array',
          description: 'Hazard zones.',
          items: {
            type: 'object',
            properties: {
              affinity: { type: 'string', enum: AFFINITY_ENUM },
              expression: { type: 'string', enum: EXPRESSION_ENUM },
              proximityRadius: { type: 'integer', minimum: 1 }
            },
            required: ['affinity', 'expression', 'proximityRadius']
          }
        },
        resource: {
          type: 'array',
          description: 'Resource drops.',
          items: {
            type: 'object',
            properties: {
              tier: { type: 'string', enum: ['level', 'permanent'] },
              stat: { type: 'string', enum: ['health', 'stamina', 'mana'] },
              delta: { type: 'number' },
              dropRate: { type: 'number', minimum: 0, maximum: 1 }
            },
            required: ['tier', 'stat', 'delta']
          }
        },
        delver: {
          type: 'array',
          description: 'Delver actors to create.',
          items: ACTOR_SPEC
        },
        warden: {
          type: 'array',
          description: 'Warden actors to create.',
          items: ACTOR_SPEC
        }
      }
    }
  }
};

module.exports = { AK_CREATE_TOOL, AFFINITY_ENUM, EXPRESSION_ENUM, MOTIVATION_ENUM };
