/**
 * AM.8 — which affinity fields MEET during a tick (closes F6).
 *
 * core has always been able to resolve an interaction:
 * `resolveMotivatedActorAffinityInteraction` reads two actors' affinity state,
 * looks the pair up in the 48-cell matrix (source effect, target effect, visual
 * state, whether the cell cancels stacks) and reports the outcome. It had one
 * consumer — `configurator/affinity-interaction-core.js`, at DESIGN time — and
 * none during play. Two actors could stand inside each other's auras for an
 * entire run and nothing would ever be resolved between them.
 *
 * Deciding WHICH pairs meet is Moderator work: affinity resolution is its
 * chartered authority (§29/§81). Applying the outcome is core's. This module
 * only answers "who is touching whom", as data, in a stable order.
 *
 * Overlap uses core's own radius formula, so a pair this reports is a pair core
 * agrees is in contact — the same discipline the Actor's cast proposal follows.
 * Proposing contact core would not recognize would produce recorded interactions
 * that changed nothing.
 */

/**
 * @param {object} args
 * @param {Array<{index:number,x:number,y:number,kind:number,expression:number,stacks:number}>} args.actors
 * @param {(expression:number, stacks:number) => number} args.computeRadius
 *   core's `computeAffinityRadius`, injected rather than reimplemented — the
 *   radius curve is core's, and a second copy of it here would be a second
 *   authority for where a field ends.
 * @returns {Array<{sourceIndex:number,targetIndex:number,distance:number}>}
 */
export function planAffinityInteractions({ actors = [], computeRadius } = {}) {
  if (typeof computeRadius !== "function") return [];
  const active = actors
    .filter((entry) => entry
      && Number.isInteger(entry.index)
      && entry.kind > 0
      && entry.expression > 0
      && entry.stacks >= 1)
    .slice()
    .sort((a, b) => a.index - b.index);

  const pairs = [];
  for (let i = 0; i < active.length; i += 1) {
    for (let j = i + 1; j < active.length; j += 1) {
      const source = active[i];
      const target = active[j];
      const distance = Math.max(
        Math.abs(source.x - target.x),
        Math.abs(source.y - target.y),
      );
      const reach = computeRadius(source.expression, source.stacks)
        + computeRadius(target.expression, target.stacks);
      if (distance > reach) continue;
      // Lower index is always the source, so a pair resolves identically
      // regardless of iteration order. The matrix is not symmetric — source and
      // target effects differ per cell — so which actor is "source" is a
      // decision, not a detail, and it must be reproducible.
      pairs.push({ sourceIndex: source.index, targetIndex: target.index, distance });
    }
  }
  return pairs;
}
