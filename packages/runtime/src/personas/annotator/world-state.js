/**
 * AM.0b — the end-of-run world-state snapshot (closes F11).
 *
 * A run emitted tick-frames, effects, an action log and a summary: a complete
 * record of what was DECIDED, and nothing about what HAPPENED. The unified
 * snapshot is the live actor registry: positions, vitals, equipment, defeat
 * and claims. Hazard and resource cells are actors in that list, not parallel
 * collections.
 *
 * This is Annotator work: capturing and normalizing run observability is its
 * chartered role. Like `summarizeRun`, it is a pure derivation and persistence
 * stays with the caller — the runtime performs no IO.
 *
 * It reads the live registry rather than replaying frames, so it reports the
 * world as core holds it. That is the point: a snapshot derived from the same
 * ledger whose truthfulness is in question would prove nothing.
 */
import { WORLD_STATE_SCHEMA } from "../../contracts/artifacts.ts";

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

/**
 * Build the WorldStateArtifact from the live unified registry.
 *
 * @param {object} args
 * @param {object} args.registry     actor registry whose snapshot is the world
 * @param {object} args.meta         ArtifactMeta supplied by the caller
 * @param {object} [args.simConfigRef]
 * @param {object} [args.presentation]
 * @param {number} [args.tick]
 * @returns {object} WorldStateArtifactV2
 */
export function buildWorldState({
  registry, meta, simConfigRef = null, presentation = null, tick = 0,
} = {}) {
  if (!registry || typeof registry.snapshot !== "function") {
    throw new Error("unified world-state snapshot requires an actor registry");
  }
  if (!meta) throw new Error("buildWorldState requires meta.");
  const snapshot = registry.snapshot();
  const artifact = {
    schema: WORLD_STATE_SCHEMA,
    schemaVersion: 2,
    meta,
    tick: Number.isFinite(tick) ? tick : 0,
    dimensions: snapshot.dimensions,
    actors: snapshot.actors,
    presentation: cloneJson(presentation && typeof presentation === "object" && !Array.isArray(presentation)
      ? presentation
      : {}),
  };
  if (simConfigRef) artifact.simConfigRef = simConfigRef;
  return artifact;
}
