function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Validate and copy the serializable portion of a persona view. */
export function restorePersonaView(from, { persona, states }) {
  if (from == null) {
    return null;
  }
  if (!isRecord(from) || !states.includes(from.state) || !isRecord(from.context)) {
    throw new TypeError(
      `${persona} restore requires a view with a known state and an object context`,
    );
  }
  return {
    state: from.state,
    context: { ...from.context },
  };
}
