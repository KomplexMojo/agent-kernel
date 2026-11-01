/**
 * Materialize destroyable earth barrier actors for cells planned by level layout.
 * Parity with a delver earth push raise (intensity × raiseScale) without `raisedBy`,
 * so they are dungeon furniture: pullable, nobody walks through as owner.
 */
import { raisedBarrierStats } from "../../../../core-ts/src/rules/actor-cast.ts";
import { affinityTableRow } from "../../../../core-ts/src/state/affinity-table.ts";

export const INTERIOR_BARRIER_INTENSITY = 2;
export const INTERIOR_BARRIER_STACKS = 2;

/** Authored barrier actor stubs for `normalizeActorDefinition` / initial-state assembly. */
export function buildInteriorBarrierActors(cells = [], {
  intensity = INTERIOR_BARRIER_INTENSITY,
  stacks = INTERIOR_BARRIER_STACKS,
} = {}) {
  if (!Array.isArray(cells) || cells.length === 0) return [];
  const raiseScale = affinityTableRow("earth")?.raiseScale ?? 2;
  const { durability } = raisedBarrierStats(intensity, raiseScale);
  return cells.map((cell) => {
    const x = cell?.x;
    const y = cell?.y;
    if (!Number.isInteger(x) || !Number.isInteger(y)) {
      throw new Error("interior barrier cell requires integer x,y");
    }
    return {
      category: "barrier",
      id: `barrier_${x}_${y}`,
      position: { x, y },
      vitals: {
        durability: { current: durability, max: durability, regen: 0 },
      },
      affinities: [{ kind: "earth", expression: "push", stacks, intensity }],
      activeAffinityKey: "earth:push",
    };
  });
}
