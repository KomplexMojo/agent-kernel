/**
 * The attack / defence / support label of an affinity expression, for every interface (#704, Darren
 * 2026-11-03). The table decides (core `affinityRole`); this only gives the UI a runtime import,
 * since the UI never imports core-ts.
 */
import { AFFINITY_TABLE, affinityRole, hasAttackOption } from "../../../core-ts/src/state/affinity-table.ts";

export { affinityRole, hasAttackOption };

export const ROLE_TAG = Object.freeze({ attack: "ATK", defence: "DEF", support: "SUP" });
export const ROLE_NAME = Object.freeze({ attack: "attack", defence: "defence", support: "support" });

/** The affinity kinds whose table row carries a trait (soak, spread, raise), for scenario templates (#739). */
export function affinityTraitKinds() {
  return AFFINITY_TABLE.filter((row) => row.trait).map((row) => ({ kind: row.kind, trait: row.trait }));
}
