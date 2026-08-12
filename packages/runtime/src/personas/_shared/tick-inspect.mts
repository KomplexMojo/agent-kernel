// Pure helpers to summarize tick/persona history for inspect/replay.

function countPhases(history) {
  return history.reduce((acc, entry) => {
    acc[entry.phase] = (acc[entry.phase] || 0) + 1;
    return acc;
  }, {});
}

function summarizePersonaStates(history) {
  const lastState = {};
  const changes = {};
  for (const entry of history) {
    if (!entry.personaViews) continue;
    for (const [name, view] of Object.entries(entry.personaViews)) {
      const prev = lastState[name];
      const next = view?.state;
      if (typeof next !== "string") continue;
      if (prev && prev !== next) {
        changes[name] = (changes[name] || 0) + 1;
      }
      lastState[name] = next;
    }
  }
  return { lastState, changes };
}

export function summarizeTickHistory(history = []) {
  const totalTicks = new Set(history.map((h) => h.tick)).size;
  const phases = countPhases(history);
  const personaSummary = summarizePersonaStates(history);
  const actionsCount = history.reduce((sum, entry) => sum + (entry.actions?.length || 0), 0);
  const effectsCount = history.reduce((sum, entry) => sum + (entry.effects?.length || 0), 0);
  const telemetryCount = history.reduce((sum, entry) => sum + (Array.isArray(entry.telemetry) ? entry.telemetry.length : entry.telemetry ? 1 : 0), 0);
  return {
    ticks: totalTicks,
    phases,
    personaStates: personaSummary.lastState,
    personaStateChanges: personaSummary.changes,
    actionsCount,
    effectsCount,
    telemetryCount,
  };
}
