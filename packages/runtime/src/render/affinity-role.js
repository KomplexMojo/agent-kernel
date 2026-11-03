/**
 * The attack / defence / support label of an affinity expression, for every interface (#704, Darren
 * 2026-11-03). The table decides (core `affinityRole`); this only gives the UI a runtime import,
 * since the UI never imports core-ts.
 */
import { affinityRole, hasAttackOption } from "../../../core-ts/src/state/affinity-table.ts";

export { affinityRole, hasAttackOption };

export const ROLE_TAG = Object.freeze({ attack: "ATK", defence: "DEF", support: "SUP" });
export const ROLE_NAME = Object.freeze({ attack: "attack", defence: "defence", support: "support" });
