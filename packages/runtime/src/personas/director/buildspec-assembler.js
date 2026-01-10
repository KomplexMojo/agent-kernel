import { mapSummaryToPool } from "./pool-mapper.js";
import { validateBuildSpec } from "../../contracts/build-spec.js";

function defaultMeta({ runId, source, createdAt, summary }) {
  const theme = summary?.dungeonTheme || "unknown";
  const id = runId || `pool_${theme}`;
  return {
    id,
    runId: runId || id,
    createdAt: createdAt || new Date().toISOString(),
    source: source || "director-pool",
  };
}

function deriveLevelGen({ roomCount }) {
  const size = Math.max(5, roomCount * 2 + 5);
  return {
    width: size,
    height: size,
    shape: { profile: "rectangular" },
  };
}

function buildActorsAndGroups(selections) {
  const actors = [];
  const groupCounts = new Map();

  selections
    .filter((sel) => sel.kind === "actor" && sel.instances && sel.instances.length > 0)
    .forEach((sel) => {
      sel.instances.forEach((inst, idx) => {
        actors.push({
          id: inst.id,
          kind: sel.applied?.subType === "static" ? "static" : "ambulatory",
          affinity: inst.affinity,
          motivations: [inst.motivation],
          position: { x: idx, y: 0 },
          vitals: {
            health: { current: 1, max: 1, regen: 0 },
            mana: { current: 0, max: 0, regen: 0 },
            stamina: { current: 0, max: 0, regen: 0 },
            durability: { current: 1, max: 1, regen: 0 },
          },
        });
      });
      const key = sel.applied?.motivation || "unknown";
      const prev = groupCounts.get(key) || 0;
      groupCounts.set(key, prev + sel.instances.length);
    });

  const actorGroups = Array.from(groupCounts.entries()).map(([role, count]) => ({ role, count }));

  return { actors, actorGroups };
}

export function buildBuildSpecFromSummary({ summary, catalog, runId, source, createdAt }) {
  const mapped = mapSummaryToPool({ summary, catalog });
  if (!mapped.ok) {
    return { ok: false, errors: mapped.errors, spec: null, selections: mapped.selections || [] };
  }

  const rooms = mapped.selections.filter((sel) => sel.kind === "room");
  const roomCount = rooms.reduce((sum, sel) => sum + (sel.instances?.length || 0), 0);
  const { actors, actorGroups } = buildActorsAndGroups(mapped.selections);

  const spec = {
    schema: "agent-kernel/BuildSpec",
    schemaVersion: 1,
    meta: defaultMeta({ runId, source, createdAt, summary }),
    intent: {
      goal: summary?.goal || `Dungeon plan for ${summary?.dungeonTheme || "unknown"}`,
      tags: summary?.tags || (summary?.dungeonTheme ? [summary.dungeonTheme] : []),
      hints: {
        levelAffinity: summary?.dungeonTheme,
        budgetTokens: summary?.budgetTokens,
      },
    },
    plan: {
      hints: {
        rooms: rooms.map((sel) => ({
          motivation: sel.requested.motivation,
          affinity: sel.requested.affinity,
          count: sel.requested.count,
        })),
      },
    },
    configurator: {
      inputs: {
        levelGen: deriveLevelGen({ roomCount }),
        levelAffinity: summary?.dungeonTheme,
        actors,
        actorGroups,
      },
    },
  };

  const validation = validateBuildSpec(spec);
  if (!validation.ok) {
    return {
      ok: false,
      errors: validation.errors,
      spec,
      selections: mapped.selections,
    };
  }

  return {
    ok: true,
    spec,
    selections: mapped.selections,
  };
}
