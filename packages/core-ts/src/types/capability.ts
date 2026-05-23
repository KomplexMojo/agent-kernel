export interface ActionCost {
  mana: number;
  stamina: number;
}

export interface Capability {
  movementCost: number;
  actionCostMana: number;
  actionCostStamina: number;
}
