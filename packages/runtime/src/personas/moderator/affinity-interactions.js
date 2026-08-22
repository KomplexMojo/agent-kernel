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
      // ── ACTOR INDEX IS THE TIE-BREAK (maintainer decision, 2026-08-14) ──
      //
      // Lower index is always the source, and pairs are emitted in ascending
      // index order. Two consequences, both deliberate:
      //
      //  1. The matrix is NOT symmetric — source and target effects differ per
      //     cell — so which actor is "source" changes the outcome. Index order
      //     makes that reproducible.
      //  2. Resolution MUTATES what later pairs depend on. A pair that cancels
      //     both actors to zero clears their affinities, and any later pair
      //     involving either of them then fails core's precondition. So with
      //     three mutually overlapping actors the planner returns three pairs
      //     and exactly one resolves — the lowest-indexed one wins.
      //
      // ⇒ *Whichever pair resolves first consumes what it cancels.* That is
      // arbitrary in the sense that nothing about the affinities decides it, and
      // ratified anyway: it is deterministic, which is what replay requires, and
      // no alternative tie-break (strongest stacks, nearest, oldest) is more
      // principled without a rule saying why. Revisit only with such a rule.
      pairs.push({ sourceIndex: source.index, targetIndex: target.index, distance });
    }
  }
  return pairs;
}
