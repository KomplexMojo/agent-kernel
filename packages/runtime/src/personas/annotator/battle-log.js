/**
 * #554 — the battle log: what happened this tick, as the Annotator records it.
 *
 * Pure derivation from what the tick applied (casts, takes, lifecycle changes), the same way
 * `buildTelemetry` derives records from observations. Entries are data; the words for them live
 * in runtime render (`render/battle-log-lines.js`). Observation only: nothing reads these back
 * into a decision. No vitals: a cast shows its affinity and whether it struck (#497). A take names
 * what it gave (a vital grant, an affinity, a slot): that is the loot, not anyone's vitals.
 */
import { BATTLE_LOG_ENTRY_SCHEMA } from "../../contracts/artifacts.ts";
import { requireClock } from "../_shared/require-clock.js";

const PERSONA = "annotator";

/**
 * @param {object} args
 * @param {object} args.battle         `{ tick, casts, takes, lifecycles, exitedActorIds, defeated }` from the observation;
 *   `defeated` is `{ [actorId]: { defeatVital, fields: [{ sourceId, kind }] } }`
 * @param {object} [args.previous]     the lifecycles the Annotator saw last tick, `{ [actorId]: lifecycle }`
 */
export function buildBattleLogEntries({ battle, previous = {}, runId = "run", clock } = {}) {
  if (!battle || typeof battle !== "object") return [];
  const tick = Number.isInteger(battle.tick) ? battle.tick : 0;
  const casts = Array.isArray(battle.casts) ? battle.casts : [];
  const drafts = [];
  for (const cast of casts) {
    drafts.push({
      event: "cast",
      sourceId: cast.sourceId,
      ...(cast.targetId ? { targetId: cast.targetId } : {}),
      kind: cast.kind,
      expression: cast.expression,
      struck: Boolean(cast.targetId && cast.targetId !== cast.sourceId),
    });
  }
  for (const take of Array.isArray(battle.takes) ? battle.takes : []) {
    drafts.push({ event: "take", sourceId: take.actorId, targetId: take.targetId, ...(take.taken ? { taken: take.taken } : {}) });
  }
  const lifecycles = battle.lifecycles && typeof battle.lifecycles === "object" ? battle.lifecycles : {};
  for (const [id, lifecycle] of Object.entries(lifecycles)) {
    if ((previous[id] ?? "alive") === "alive" && lifecycle === "defeated") {
      const hit = casts.filter((cast) => cast.targetId === id && cast.sourceId !== id).at(-1);
      // No cast landed: the field it stood in did it (another actor's emit).
      const reading = battle.defeated?.[id];
      const field = hit ? null : reading?.fields?.[0];
      drafts.push({
        event: "defeat",
        targetId: id,
        ...(reading?.defeatVital ? { defeatVital: reading.defeatVital } : {}),
        ...(hit ? { sourceId: hit.sourceId, kind: hit.kind, expression: hit.expression } : {}),
        ...(field ? { sourceId: field.sourceId, kind: field.kind, expression: "emit" } : {}),
      });
    }
  }
  for (const id of Array.isArray(battle.exitedActorIds) ? battle.exitedActorIds : []) {
    drafts.push({ event: "exit", targetId: id });
  }
  const createdAt = drafts.length > 0 ? requireClock(clock, PERSONA)() : null;
  return drafts.map((draft, index) => ({
    schema: BATTLE_LOG_ENTRY_SCHEMA,
    schemaVersion: 1,
    meta: { id: `battlelog_${tick}_${index}`, runId, createdAt, producedBy: PERSONA },
    tick,
    ...draft,
  }));
}
