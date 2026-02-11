import { normalizePoolCatalog } from "../configurator/pool-catalog.js";
import { VITAL_KEYS } from "../../contracts/domain-constants.js";

function snapSelection({ entries, motivation, affinity, tokenHint }) {
  const matching = entries.filter((entry) => entry.motivation === motivation && entry.affinity === affinity);
  if (matching.length === 0) return { applied: null, receipt: { status: "missing", reason: "no_match" } };

  const sorted = [...matching].sort((a, b) => a.cost - b.cost || a.id.localeCompare(b.id));
  let chosen = sorted[0];
  let status = "approved";
  let reason;

  if (Number.isInteger(tokenHint) && tokenHint > 0) {
    const under = sorted.filter((entry) => entry.cost <= tokenHint);
    if (under.length > 0) {
      chosen = under[under.length - 1]; // nearest below/eq
      if (chosen.cost < tokenHint) {
        status = "downTiered";
        reason = "snapped_down";
      }
    } else {
      chosen = sorted[0]; // clamp to cheapest
      status = "clamped";
      reason = "no_entry_under_token_hint";
    }
  }

  return {
    applied: chosen,
    receipt: { status, reason },
  };
}

function deriveId({ motivation, affinity, cost, index }) {
  return `actor_${motivation}_${affinity}_${cost}_${index + 1}`;
}

function normalizePickAffinities(pick) {
  if (Array.isArray(pick?.affinities) && pick.affinities.length > 0) {
    return pick.affinities.map((entry) => ({
      kind: entry.kind,
      expression: entry.expression,
      stacks: entry.stacks,
    }));
  }
  if (pick?.affinity && pick?.expression) {
    return [
      {
        kind: pick.affinity,
        expression: pick.expression,
        stacks: Number.isInteger(pick.stacks) && pick.stacks > 0 ? pick.stacks : 1,
      },
    ];
  }
  return [];
}

function copyActorVitals(vitals) {
  if (!vitals || typeof vitals !== "object" || Array.isArray(vitals)) return undefined;
  const copied = VITAL_KEYS.reduce((acc, key) => {
    if (vitals[key] && typeof vitals[key] === "object" && !Array.isArray(vitals[key])) {
      acc[key] = { ...vitals[key] };
    }
    return acc;
  }, {});
  return Object.keys(copied).length > 0 ? copied : undefined;
}

export function mapSummaryToPool({ summary, catalog }) {
  const { ok, entries, errors } = normalizePoolCatalog(catalog || {});
  if (!ok) {
    return { ok: false, errors, selections: [] };
  }

  const selections = [];

  const applyPick = (pick, kind) => {
    const affinities = normalizePickAffinities(pick);
    const { applied, receipt } = snapSelection({
      entries,
      motivation: pick.motivation,
      affinity: pick.affinity,
      tokenHint: pick.tokenHint,
    });
    if (!applied) {
      selections.push({
        kind,
        requested: pick,
        applied: null,
        receipt: { status: "missing", reason: "no_match" },
      });
      return;
    }
    selections.push({
      kind,
      requested: pick,
      applied: {
        id: applied.id,
        subType: applied.subType,
        motivation: applied.motivation,
        affinity: applied.affinity,
        cost: applied.cost,
      },
      receipt: {
        status: receipt.status,
        reason: receipt.reason,
        count: pick.count,
      },
      instances: Array.from({ length: pick.count }, (_, idx) => {
        const instance = {
          id: deriveId({ motivation: applied.motivation, affinity: applied.affinity, cost: applied.cost, index: idx }),
          baseId: applied.id,
          subType: applied.subType,
          motivation: applied.motivation,
          affinity: applied.affinity,
          cost: applied.cost,
        };
        if (affinities.length > 0) {
          instance.affinities = affinities.map((entry) => ({ ...entry }));
        }
        const copiedVitals = copyActorVitals(pick?.vitals);
        if (copiedVitals) instance.vitals = copiedVitals;
        return instance;
      }),
    });
  };

  const rooms = Array.isArray(summary?.rooms) ? summary.rooms : [];
  rooms.forEach((pick) => applyPick(pick, "room"));

  const actors = Array.isArray(summary?.actors) ? summary.actors : [];
  actors.forEach((pick) => applyPick(pick, "actor"));

  return { ok: true, selections };
}
