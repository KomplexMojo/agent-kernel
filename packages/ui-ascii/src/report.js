/**
 * The playtest report a phone tester sends back, in the format `scripts/game/playtest.mjs`
 * writes and `--open` reads: the same header, findings, final screen and the two trailing
 * comments (the build's identity and the recorded commands, gzipped). Pure and browser-safe;
 * `tests/ui-ascii/ui-ascii-pwa.test.js` holds it to `parseReport`.
 */

const toBase64Url = (bytes) => {
  let text = "";
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

/** The recorded commands as one pasteable line (gzip, base64url): what `decodeReplay` reads. */
export async function encodeReplay(commands) {
  const stream = new Blob([JSON.stringify(commands)]).stream().pipeThrough(new CompressionStream("gzip"));
  return toBase64Url(new Uint8Array(await new Response(stream).arrayBuffer()));
}

export function describeStatus(status) {
  if (!status) return "status unknown";
  if (status.exited) return "reached the exit";
  if (status.defeated) return "defeated";
  return "still playing when quit";
}

/**
 * @param {object} args
 * @param {{id: string, title: string}} args.scenario
 * @param {number} args.seed
 * @param {{A: string, B: string, C: string, D: string}} args.picks
 * @param {string} [args.traits]  e.g. "fire (spread), water (soak)"
 * @param {{totalSpend: number, budgetTokens: number, status: string}} [args.cost]
 * @param {string} args.commit  the commit the level was built from
 * @param {string} args.createdAt  the catalog's createdAt (rebuilds the same level)
 * @param {string} args.playedAt
 * @param {{turns: number, status: object}} args.final
 * @param {string} args.screen  the final screen as plain text
 * @param {string[]} args.notes
 * @param {string} args.replayCode
 * @param {string} [args.device]
 */
export function renderReport({ scenario, seed, picks, traits, cost, commit, createdAt, playedAt, final, screen, notes, replayCode, device }) {
  const { totalSpend = "?", budgetTokens = "?", status: costStatus = "unknown" } = cost ?? {};
  return [
    `# Playtest: ${scenario.title} (${scenario.id}, seed ${seed})`,
    "",
    `- Played: ${playedAt}`,
    `- Commit: ${commit} (pwa)`,
    ...(device ? [`- Device: ${device}`] : []),
    `- Affinities: you ${picks.A} vs ${picks.B}; other pair ${picks.C}/${picks.D}`,
    ...(traits ? [`- Traits: ${traits}`] : []),
    `- Level cost: ${totalSpend} of ${budgetTokens} tokens (${costStatus})`,
    `- Ended: turn ${final?.turns ?? "?"}, ${describeStatus(final?.status)}`,
    "",
    "## Findings",
    "",
    ...(notes.length ? notes.map((note, index) => `${index + 1}. ${note}`) : ["(none written)"]),
    "",
    "## Final screen",
    "",
    "```",
    (screen ?? "").trimEnd(),
    "```",
    "",
    "## Reproduce",
    "",
    "```",
    "bash scripts/game/playtest.sh --open <this file>",
    "```",
    "",
    `<!-- playtest ${JSON.stringify({ scenario: scenario.id, seed, commit, createdAt })} -->`,
    `<!-- replay ${replayCode} -->`,
    "",
  ].join("\n");
}
