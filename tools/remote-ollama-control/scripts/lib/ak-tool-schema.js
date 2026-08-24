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
              blocking: { type: 'boolean', description: 'Whether the hazard blocks movement through its tile' },
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
          description:
            'Resource pickups carrying a vital payload, an affinity payload, or both. A vital '
            + 'payload is permanenceMode + vital + (delta or regen). An affinity payload is '
            + 'affinity + expression + stacks + mana. permanenceMode belongs to the vital payload '
            + 'and must not appear on an affinity-only resource.',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              permanenceMode: {
                type: 'string',
                enum: ['consumable', 'level', 'permanent'],
                description:
                  'Part of the VITAL payload — it governs how long the vital delta persists. '
                  + 'Required whenever vital is set, and must be omitted on an affinity-only resource.'
              },
              vital: { type: 'string', enum: ['health', 'mana', 'stamina'] },
              regen: { type: 'integer', minimum: 0 },
              affinity: { type: 'string', enum: AFFINITY_ENUM },
              expression: { type: 'string', enum: EXPRESSION_ENUM },
              stacks: { type: 'integer', minimum: 1 },
              mana: { type: 'integer', minimum: 0, description: 'Affinity-payload mana pool. An integer here, unlike hazard.mana.' },
              manaRegen: { type: 'integer', minimum: 0 },
              delta: { type: 'number', description: 'Amount of the vital to apply' }
            },
            // These branches restate the contract parseResourceSpec actually enforces. The previous
            // pair -- {required:['vital']} and {required:[affinity,expression,stacks,mana]} --
            // advertised two shapes the CLI rejects, and the run of 2026-08-23 lost 57 of 700
            // attempts to them: a vital payload without permanenceMode, and an affinity payload
            // carrying one. Both were reported as bad enum VALUES for fields that were simply
            // absent, which is why it read as model error for months.
            anyOf: [
              {
                // A vital payload, optionally alongside an affinity payload. permanenceMode is
                // required here because the parser reads it as the declaration of a vital payload
                // and then validates it as an enum -- absent, it fails as "must be one of".
                required: ['permanenceMode', 'vital'],
                anyOf: [{ required: ['delta'] }, { required: ['regen'] }]
              },
              {
                // An affinity payload alone. The parser treats ANY of permanenceMode/vital/delta/
                // regen as "a vital payload follows" and then demands the whole set, so none of
                // them may appear on an affinity-only resource.
                required: ['affinity', 'expression', 'stacks', 'mana'],
                not: {
                  anyOf: [
                    { required: ['permanenceMode'] },
                    { required: ['vital'] },
                    { required: ['delta'] },
                    { required: ['regen'] }
                  ]
                }
              }
            ],
            // Descriptive for clients that honour it; the anyOf above is the enforcing half.
            dependentRequired: {
              affinity: ['expression', 'stacks', 'mana'],
              manaRegen: ['mana']
            }
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

module.exports = { AK_CREATE_TOOL, AFFINITY_ENUM, EXPRESSION_ENUM, MOTIVATION_ENUM, GOAL_KIND_ENUM };
