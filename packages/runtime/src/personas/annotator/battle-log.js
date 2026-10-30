/**
 * #554 — the battle log: what happened this tick, as the Annotator records it.
 *
 * Pure derivation from what the tick applied (casts, takes, lifecycle changes), the same way
 * `buildTelemetry` derives records from observations. A lasting field that starts hurting someone
 * is logged once, when it starts (`field`). Entries are data; the words for them live
 * in runtime render (`render/battle-log-lines.js`). Observation only: nothing reads these back
 * into a decision. No vitals: a cast shows its affinity and whether it struck (#497). A take names
 * what it gave (a vital grant, an affinity, a slot): that is the loot, not anyone's vitals.
 */
import { BATTLE_LOG_ENTRY_SCHEMA } from "../../contracts/artifacts.ts";
import { requireClock } from "../_shared/require-clock.js";
import { affinityTableRow } from "../../../../core-ts/src/state/affinity-table.ts";

const PERSONA = "annotator";

/** A field that harms what stands in it: any draw (it drains), or an emit of a damaging kind (core's table). */
function harmfulField(field) {
  return field.expression === "draw" || (field.expression === "emit" && affinityTableRow(field.kind)?.outward === "damage");
}

/** The key of one field contact, so a field that keeps hitting is logged when it starts, not every tick. */
export function fieldHitKey(hit) {
  return `${hit.sourceId}>${hit.targetId}:${hit.kind}:${hit.expression}`;
}

/** This tick's harmful field contacts (`battle.fieldHits`), one per source, target, kind and form. */
export function fieldHitsOf(battle) {
  const hits = [];
  for (const reading of Array.isArray(battle?.fieldHits) ? battle.fieldHits : []) {
    for (const field of reading.fields ?? []) {
      const hit = { sourceId: field.sourceId, targetId: reading.targetId, kind: field.kind, expression: field.expression };
      if (harmfulField(field) && !hits.some((other) => fieldHitKey(other) === fieldHitKey(hit))) hits.push(hit);
    }
  }
  return hits;
}

/**
 * @param {object} args
 * @param {object} args.battle         `{ tick, casts, takes, lifecycles, exitedActorIds, defeated }` from the observation;
 *   `defeated` is `{ [actorId]: { defeatVital, fields: [{ sourceId, kind }] } }`
 * @param {object} [args.previous]     the lifecycles the Annotator saw last tick, `{ [actorId]: lifecycle }`
 * @param {string[]} [args.previousFieldHits]  last tick's field contacts (`fieldHitKey`), so an ongoing one is not repeated
 */
export function buildBattleLogEntries({ battle, previous = {}, previousFieldHits = [], runId = "run", clock } = {}) {
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
  // Playtest 2026-10-30: a lasting field (emit, draw) hurting someone is logged when it starts.
  for (const hit of fieldHitsOf(battle)) {
    if (!previousFieldHits.includes(fieldHitKey(hit))) drafts.push({ event: "field", ...hit });
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
