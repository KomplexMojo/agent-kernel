export interface ActionCost {
  mana: i32;
  stamina: i32;
}

export interface Capability {
  movementCost: i32;
  actionCostMana: i32;
  actionCostStamina: i32;
}
