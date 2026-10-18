/**
 * #396 — what the Configurator did with each tactic in the plan (`directives.tactics`).
 *
 * Tactics are compiled into actor roles and placement constraints in later steps of
 * strategic placement (#395). Until a tactic is compiled, the build records it and says
 * so in the placement report, so a tactic that was asked for is never silently dropped.
 */
export function reportTactics(tactics) {
  if (!Array.isArray(tactics)) return [];
  return tactics
    .filter((entry) => entry && typeof entry.tactic === "string")
    .map((entry) => ({
      tactic: entry.tactic,
      ...(entry.params && Object.keys(entry.params).length > 0 ? { params: { ...entry.params } } : {}),
      applied: false,
      note: "recorded but not applied: the Configurator does not compile this tactic yet",
    }));
}
