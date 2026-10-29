/**
 * #554 — the words for battle-log entries, so every UI (ASCII, phone app, later Phaser) shows
 * identical lines. Pure: entries in, text out. The Annotator derives the entries; this only words
 * them, and never adds what the entry does not carry (no vitals, #497).
 */

/**
 * @param {object} entry   an `agent-kernel/BattleLogEntry`
 * @param {object} [who]
 * @param {string} [who.seatId]               the actor the player is playing: named "you"
 * @param {(id: string) => (string|null)} [who.labelOf]  the glyph label of an actor, when it has one
 */
export function battleLogLine(entry, { seatId, labelOf = () => null } = {}) {
  const name = (id) => {
    if (id === seatId) return "you";
    const label = labelOf(id);
    return label ? `${label} ${id}` : id;
  };
  const cap = (text) => text.charAt(0).toUpperCase() + text.slice(1);
  const attack = entry.kind ? `${entry.kind} ${entry.expression}` : null;
  switch (entry.event) {
    case "cast": {
      const source = name(entry.sourceId);
      if (entry.struck) return `${cap(source)} cast ${attack} and struck ${name(entry.targetId)}.`;
      return `${cap(source)} cast ${attack}${entry.targetId ? ` at ${name(entry.targetId)}` : ""}.`;
    }
    case "take":
      return `${cap(name(entry.sourceId))} took from ${name(entry.targetId)}.`;
    case "defeat": {
      const by = entry.sourceId ? ` by ${name(entry.sourceId)}${attack ? `'s ${attack}` : ""}` : "";
      return `${cap(name(entry.targetId))} ${entry.targetId === seatId ? "were" : "was"} defeated${by}.`;
    }
    case "exit":
      return `${cap(name(entry.targetId))} left by the exit.`;
    default:
      return "";
  }
}
