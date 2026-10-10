/**
 * Draws one screen as text. Pure: takes the play session's view and returns a
 * string, so it renders the same in a test as on a terminal.
 *
 * Nothing here decides meaning. Board glyphs come from core's frame buffer;
 * vital labels, order and colours come from runtime's HUD model
 * (`render/actor-hud-model.js`); other actors' letters come from the ASCII
 * snapshot vocabulary (`render/visualization-snapshot.js`). This module only
 * lays them out.
 */
import { asciiGlyphForRole } from "../../runtime/src/render/visualization-snapshot.js";
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

/**
 * Core's frame buffer draws only the player, so other actors (`view.actors`,
 * present once NPCs take turns) are drawn over it. The player's own cell is
 * never overwritten.
 */
export function overlayActors(rows, actors, playerPosition) {
  if (!Array.isArray(actors) || actors.length === 0) return rows;
  const grid = rows.map((row) => row.split(""));
  for (const actor of actors) {
    const { x, y } = actor?.position || {};
    if (!grid[y] || grid[y][x] === undefined) continue;
    if (playerPosition && playerPosition.x === x && playerPosition.y === y) continue;
    grid[y][x] = asciiGlyphForRole(actor.role);
  }
  return grid.map((cells) => cells.join(""));
}

/** Vitals the actor actually has: a 0/0 pool is absent, not empty. */
function presentVitals(player) {
  return (player?.vitals || []).filter((vital) => vital.max > 0);
}

export function statusLine(status, message) {
  if (message) return message;
  if (status?.exited) return "You escaped! Press Enter for the next level, r to replay, q to quit.";
  if (status?.atExit) return "You reached the exit. Press . to step through.";
  return "Find the exit (E).";
}

/**
 * @param {object} args
 * @param {object} args.view        createPlaySession().view()
 * @param {string} args.levelName
 * @param {number} [args.levelIndex]
 * @param {number} [args.levelCount]
 * @param {number} [args.turns]
 * @param {string} [args.message]   overrides the default status line
 * @param {boolean} [args.showHelp]
 * @param {boolean} [args.color]    emit ANSI colour
 */
export function renderScreen({
  view,
  levelName,
  levelIndex = 0,
  levelCount = 1,
  turns = 0,
  message = "",
  showHelp = true,
  color = false,
}) {
  const lines = [];
  lines.push(`agent-kernel maze — ${levelName} (${levelIndex + 1}/${levelCount})`);
  lines.push("");
  for (const row of overlayActors(view.rows, view.actors, view.player?.position)) lines.push(`  ${row}`);
  lines.push("");
  const vitals = presentVitals(view.player).map((vital) => vitalBar(vital, color));
  if (vitals.length > 0) lines.push(vitals.join("   "));
  lines.push(`Tick ${view.tick}   Turns ${turns}`);
  lines.push(statusLine(view.status, message));
  if (showHelp) {
    lines.push("");
    lines.push(...HELP_LINES);
  }
  return lines.join("\n");
}
