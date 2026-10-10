/**
 * Draws one screen as text. Pure: takes the play session's view and returns a
 * string, so it renders the same in a test as on a terminal.
 *
 * Nothing here decides meaning. Board glyphs come from core's frame buffer;
 * vital labels, order and colours come from runtime's HUD model
 * (`render/actor-hud-model.js`). This module only lays them out.
 */
import { HELP_LINES } from "./keymap.js";

const BAR_WIDTH = 10;
const RESET = "\u001b[0m";

function ansiForHex(hex) {
  const match = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(String(hex || ""));
  if (!match) return "";
  const [r, g, b] = match.slice(1).map((part) => parseInt(part, 16));
  return `\u001b[38;2;${r};${g};${b}m`;
}

function paint(text, hex, color) {
  if (!color) return text;
  const code = ansiForHex(hex);
  return code ? `${code}${text}${RESET}` : text;
}

function vitalBar(vital, color) {
  const filled = Math.round(Math.max(0, Math.min(1, vital.fraction)) * BAR_WIDTH);
  const bar = "█".repeat(filled) + "░".repeat(BAR_WIDTH - filled);
  return `${vital.label} ${paint(bar, vital.colorHex, color)} ${vital.current}/${vital.max}`;
}

/** Vitals the actor actually has: a 0/0 pool is absent, not empty. */
function presentVitals(player) {
  return (player?.vitals || []).filter((vital) => vital.max > 0);
}

export function statusLine(status, message) {
  if (message) return message;
  if (status === "escaped") return "You escaped! Press Enter for the next level, r to replay, q to quit.";
  if (status === "at_exit") return "You reached the exit. Press . to step through.";
  return "Find the exit (E).";
}

/**
 * @param {object} args
 * @param {object} args.view        createPlaySession().view()
 * @param {string} args.levelName
 * @param {number} [args.levelIndex]
 * @param {number} [args.levelCount]
 * @param {number} [args.moves]
 * @param {string} [args.message]   overrides the default status line
 * @param {boolean} [args.showHelp]
 * @param {boolean} [args.color]    emit ANSI colour
 */
export function renderScreen({
  view,
  levelName,
  levelIndex = 0,
  levelCount = 1,
  moves = 0,
  message = "",
  showHelp = true,
  color = false,
}) {
  const lines = [];
  lines.push(`agent-kernel maze — ${levelName} (${levelIndex + 1}/${levelCount})`);
  lines.push("");
  for (const row of view.rows) lines.push(`  ${row}`);
  lines.push("");
  const vitals = presentVitals(view.player).map((vital) => vitalBar(vital, color));
  if (vitals.length > 0) lines.push(vitals.join("   "));
  lines.push(`Tick ${view.tick}   Moves ${moves}`);
  lines.push(statusLine(view.status, message));
  if (showHelp) {
    lines.push("");
    lines.push(...HELP_LINES);
  }
  return lines.join("\n");
}
