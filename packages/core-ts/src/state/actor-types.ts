// Mechanical actor data belongs to core; runtime owns only artifact envelopes.
export type AffinityKind = "fire" | "water" | "earth" | "wind" | "growth" | "decay" | "corrode" | "fortify" | "light" | "dark";
export type AffinityExpression = "push" | "pull" | "emit" | "draw";
export interface ActorVitalRecord { current: number; max: number; regen: number }
export interface ActorVitalGrant {
  key: "health" | "mana" | "stamina";
  delta: number;
  regen?: number;
}
export type ActorHoldingPermanence = "consumable" | "level" | "permanent";

export interface ActorPosition {
  x: number;
  y: number;
}

export type ActorAlignment = "external" | "dungeon";
export type ActorLifecycle = "alive" | "defeated" | "exited";
export type ActorVitalKind = "health" | "durability" | "mana" | "stamina";
export type ActorAffinityKey = `${AffinityKind}:${AffinityExpression}`;

/** Capabilities are explicit after Configurator normalization, never label-derived. */
export interface ActorCapabilities {
  canMove: boolean;
  canCast: boolean;
  canEquip: boolean;
  canTake: boolean;
  canExit: boolean;
  blocksMovement: boolean;
  blocksSight: boolean;
}

/** One entry per (kind, expression); mana exists only in the actor's vitals. */
export interface ActorAffinityEntry {
  kind: AffinityKind;
  expression: AffinityExpression;
  /** Range: how far the affinity reaches (#340). */
  stacks: number;
  /** Strength per hit or per tile (#340); absent reads as 1, which is how older entries load. */
  intensity?: number;
}

/** A claim transfers one stack, regardless of the defeated source's stack count. */
export interface ActorAffinityHolding {
  id: string;
  kind: "affinity";
  affinity: AffinityKind;
  expression: AffinityExpression;
  claimedBy: string | null;
}

/** Explicit rewards are separate from the source's current living vital pools. */
export interface ActorVitalHolding {
  id: string;
  kind: "vital";
  vitals: ActorVitalGrant[];
  permanenceMode: ActorHoldingPermanence;
  claimedBy: string | null;
}

/**
 * Slot-unlock loot: taking it opens `slots` more equipped-affinity slots, up to
 * the hard cap. Permanent by nature; the Configurator puts it only on floor resources.
 */
export interface ActorSlotHolding {
  id: string;
  kind: "slot";
  slots: number;
  claimedBy: string | null;
}

export type ActorHolding = ActorAffinityHolding | ActorVitalHolding | ActorSlotHolding;

export interface ActorRecordBase {
  id: string;
  alignment: ActorAlignment;
  position: ActorPosition;
  lifecycle: ActorLifecycle;
  /** Consecutive completed ticks on exit terrain; omitted means zero. */
  exitDwell?: number;
  /**
   * True while the actor's lasting affinity (emit, draw) is off because it could
   * not pay its per-turn mana upkeep; it comes back on when mana is full again.
   * Omitted means false.
   */
  affinityExhausted?: boolean;
  /**
   * The lasting affinities that are off, when only some equipped slots are. Omitted
   * while `affinityExhausted` is true means every equipped slot is off.
   */
  exhaustedAffinityKeys?: ActorAffinityKey[];
  /**
   * The actor whose push raised this barrier (#413). Its owner walks through it; it
   * pays its invested mana down a turn at a time, then erodes. Omitted on authored actors.
   */
  raisedBy?: string;
  /**
   * #420: turns left soaked by a `soak`-trait affinity; each move costs more stamina while
   * soaked. Omitted means dry.
   */
  soaked?: number;
  /** How many affinities the actor can equip at once, 1..6; omitted means 1. */
  affinitySlots?: number;
  capabilities: ActorCapabilities;
  motivations: string[];
  affinities: ActorAffinityEntry[];
  /** Null means unequipped; an entry must exist for a non-null key. Always the first equipped key. */
  activeAffinityKey: ActorAffinityKey | null;
  /**
   * Every equipped key in equip order, written only when more than one is equipped;
   * omitted means `[activeAffinityKey]`, or nothing when that is null.
   */
  equippedAffinityKeys?: ActorAffinityKey[];
  /**
   * #230: equipped affinities run below the stacks held, by key. Each value is
   * 1..held-1; an equipped key without an entry runs at everything held.
   */
  equippedAffinityStacks?: Partial<Record<ActorAffinityKey, number>>;
  /**
   * #345: equipped affinities run below the intensity held, by key. Each value is
   * 1..held-1; an equipped key without an entry runs at all the intensity it holds.
   */
  equippedAffinityIntensity?: Partial<Record<ActorAffinityKey, number>>;
  holdings: ActorHolding[];
}

/**
 * Single mechanical boundary record for every authored preset. Core must validate
 * numeric bounds, unique IDs/pairs/holdings, and active-key membership at load.
 * The selected defeat vital must exist; the other vitals are optional.
 */
export type ActorRecord = ActorRecordBase & (
  | { defeatVital: "health"; vitals: Partial<Record<ActorVitalKind, ActorVitalRecord>> & { health: ActorVitalRecord } }
  | { defeatVital: "durability"; vitals: Partial<Record<ActorVitalKind, ActorVitalRecord>> & { durability: ActorVitalRecord } }
);


/** Row-major terrain. Destructible barriers are actors, not terrain codes. */
export type TerrainKind = "wall" | "floor" | "spawn" | "exit";
export interface ActorRegistrySnapshot {
  dimensions: { width: number; height: number };
  terrain: TerrainKind[];
  actors: ActorRecord[];
}

/** Mechanical action vocabulary; runtime supplies artifact envelopes. */
export type ActorAction = { actorId: string; tick: number } & (
  | { kind: "wait"; params?: never }
  // `via` makes it a sprint (#437): two steps in one turn, `via` then `target`.
  | { kind: "move"; params: { target: ActorPosition; via?: ActorPosition } }
  | { kind: "cast_affinity"; params: { targetId: string; target?: never; affinityKey?: ActorAffinityKey }
    | { target: ActorPosition; targetId?: never; affinityKey?: ActorAffinityKey } }
  | { kind: "equip_affinity"; params: { affinityKey: ActorAffinityKey; replaceKey?: ActorAffinityKey; stacks?: number; intensity?: number } }
  | { kind: "unequip_affinity"; params: { affinityKey: ActorAffinityKey } }
  | { kind: "take"; params: { targetId: string; holdingId: string } }
);
