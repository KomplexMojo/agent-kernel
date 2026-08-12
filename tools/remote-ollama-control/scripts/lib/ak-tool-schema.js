'use strict';

const AFFINITY_ENUM = [
  'fire', 'water', 'earth', 'wind',
  'life', 'decay', 'corrode', 'fortify',
  'light', 'dark'
];

const EXPRESSION_ENUM = ['push', 'pull', 'emit', 'draw'];

const MOTIVATION_ENUM = [
  'random', 'stationary', 'exploring', 'patrolling',
  'attacking', 'defending', 'stealthy', 'friendly',
  'reflexive', 'goal_oriented', 'strategy_focused', 'user_controlled'
];

const SIZE_ENUM = ['small', 'medium', 'large'];
const PRIORITY_ENUM = ['high', 'medium', 'low'];
const GOAL_KIND_ENUM = ['max_mana', 'mana_regen', 'maximize_spend'];
const RESOURCE_STAT_ENUM = ['vitalMax', 'vitalRegen', 'affinity', 'affinityStack', 'pushExpression'];

const VITAL_CONFIG = {
  type: 'object',
  properties: {
    max: { type: 'integer', minimum: 1, description: 'Maximum value' },
    regen: { type: 'integer', minimum: 0, description: 'Regen per tick (default 0)' }
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

const GOAL_ITEM = {
  type: 'object',
  description: 'Optimization goal — only max_mana, mana_regen, and maximize_spend are supported',
  properties: {
    kind: { type: 'string', enum: GOAL_KIND_ENUM },
    priority: { type: 'string', enum: PRIORITY_ENUM, default: 'high' }
  },
  required: ['kind']
};

const COMMON_ACTOR_PROPS = {
  count: { type: 'integer', minimum: 1, default: 1 },
  affinity: { type: 'string', enum: AFFINITY_ENUM },
  motivation: { type: 'string', enum: MOTIVATION_ENUM },
  vitals: {
    type: 'object',
    description: 'Vital stat settings. Keys: health, stamina, mana, durability.',
    properties: {
      health: VITAL_CONFIG,
      stamina: VITAL_CONFIG,
      mana: VITAL_CONFIG,
      durability: VITAL_CONFIG
    }
  },
  affinities: {
    type: 'array',
    items: ACTOR_AFFINITY_ITEM,
    description: 'Additional affinity expressions beyond the primary'
  }
};

// Delver includes goals; warden does not
const DELVER_SPEC = {
  type: 'object',
  properties: {
    ...COMMON_ACTOR_PROPS,
    goals: {
      type: 'array',
      items: GOAL_ITEM,
      description: 'Optimization goals. Valid kinds: max_mana, mana_regen, maximize_spend.'
    }
  },
  required: ['count', 'affinity', 'motivation']
};

const WARDEN_SPEC = {
  type: 'object',
  description: 'Warden actor. Note: wardens do not support goals.',
  properties: { ...COMMON_ACTOR_PROPS },
  required: ['count', 'affinity', 'motivation']
};

const AK_CREATE_TOOL = {
  type: 'function',
  function: {
    name: 'ak_create',
    description:
      'Create agent-kernel game elements (delvers, wardens, rooms, hazards, resources) ' +
      'for a dungeon scenario. Rooms are generic containers — affinity pressure belongs in ' +
      'hazards, not in room specs.',
    parameters: {
      type: 'object',
      required: ['text', 'runId', 'outDir'],
      properties: {
        text: {
          type: 'string',
          description: 'Freeform authoring text describing what to create.'
        },
        budgetTokens: {
          type: 'integer',
          description: 'Hard budget cap in tokens. Only set this when the request names an explicit token budget; omit it for unconstrained authoring.',
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
        hazard: {
          type: 'array',
          description: 'Hazard zones. Placement is proximity-based — hazards have no coordinates.',
          items: {
            type: 'object',
            properties: {
              affinity: { type: 'string', enum: AFFINITY_ENUM },
              expression: { type: 'string', enum: EXPRESSION_ENUM },
              proximityRadius: { type: 'integer', minimum: 1, description: 'Tiles around the hazard its affinity pressure reaches' },
              stacks: { type: 'integer', minimum: 1, default: 1 },
              mana: {
                type: 'string',
                description: 'Optional mana vital as "one-time:<amount>" or "regen:<current>:<max>:<regen>", e.g. "regen:4:4:1"'
              },
              durability: {
                type: 'string',
                description: 'Optional durability vital, same format as mana'
              }
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
              stat: {
                type: 'string',
                enum: RESOURCE_STAT_ENUM,
                description: 'vitalMax=raise a stat cap, vitalRegen=raise regen, affinity=grant affinity expression, affinityStack=add affinity stacks, pushExpression=grant push'
              },
              delta: { type: 'number', description: 'Amount to apply' },
              dropRate: { type: 'number', minimum: 0, maximum: 100, description: 'Drop chance 0–100' }
            },
            required: ['tier', 'stat', 'delta']
          }
        },
        delver: {
          type: 'array',
          description: 'Delver actors to create.',
          items: DELVER_SPEC
        },
        warden: {
          type: 'array',
          description: 'Warden actors to create. Wardens do not support goals.',
          items: WARDEN_SPEC
        }
      }
    }
  }
};

module.exports = { AK_CREATE_TOOL, AFFINITY_ENUM, EXPRESSION_ENUM, MOTIVATION_ENUM, GOAL_KIND_ENUM, RESOURCE_STAT_ENUM };
