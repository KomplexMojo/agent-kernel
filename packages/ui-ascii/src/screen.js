/**
 * Draws one screen as text. Pure: takes the play session's view and returns a
 * string, so it renders the same in a test as on a terminal.
 *
 * Nothing here decides meaning. Board glyphs come from core's frame buffer;
 * vital labels, order and colours come from runtime's HUD model
 * (`render/actor-hud-model.js`); trap and other actors' letters come from the
 * ASCII snapshot vocabulary (`render/visualization-snapshot.js`); every board colour
 * comes from `render/ascii-cell-style.js`, which reads the approved palette.
 * This module only lays them out and turns hex into terminal escape codes.
 */
import { asciiActorCellStyle, buildAsciiCellStyles } from "../../runtime/src/render/ascii-cell-style.js";
import { ASCII_ENTITY_GLYPHS, asciiGlyphForActor } from "../../runtime/src/render/visualization-snapshot.js";
import { HELP_LINES } from "./keymap.js";

const BAR_WIDTH = 10;
const RESET = "\u001b[0m";

/** 24-bit ANSI for a palette hex; layer 38 is foreground, 48 background. */
function ansiForHex(hex, layer = 38) {
  const match = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(String(hex || ""));
  if (!match) return "";
  const [r, g, b] = match.slice(1).map((part) => parseInt(part, 16));
  return `\u001b[${layer};2;${r};${g};${b}m`;
}

function paint(text, hex, color) {
  if (!color) return text;
  const code = ansiForHex(hex);
  return code ? `${code}${text}${RESET}` : text;
}

/**
 * Colour one board row cell by cell; characters with no style stay plain.
 * `cellStyles` (column -> style) overrides the per-character style, which is
 * how an actor's affinity colours its cell.
 */
export function paintBoardRow(row, styles, cellStyles = null) {
  let out = "";
  let open = null;
  for (let x = 0; x < row.length; x += 1) {
    const char = row[x];
    const style = cellStyles?.get(x) || styles[char] || null;
    const code = style ? `${ansiForHex(style.bg, 48)}${ansiForHex(style.fg, 38)}` : "";
    if (code !== open) {
      out += open ? RESET : "";
      out += code;
      open = code || null;
    }
    out += char;
  }
  return open ? `${out}${RESET}` : out;
}

function vitalBar(vital, color) {
  const filled = Math.round(Math.max(0, Math.min(1, vital.fraction)) * BAR_WIDTH);
  const bar = "█".repeat(filled) + "░".repeat(BAR_WIDTH - filled);
  return `${vital.label} ${paint(bar, vital.colorHex, color)} ${vital.current}/${vital.max}`;
}

function overlay(rows, entities, playerPosition, glyphFor) {
  if (!Array.isArray(entities) || entities.length === 0) return rows;
  const grid = rows.map((row) => row.split(""));
  for (const entity of entities) {
    const { x, y } = entity?.position || {};
    if (!grid[y] || grid[y][x] === undefined) continue;
    if (playerPosition && playerPosition.x === x && playerPosition.y === y) continue;
    grid[y][x] = glyphFor(entity);
  }
  return grid.map((cells) => cells.join(""));
}

/**
 * Core's frame buffer draws only the player, so other actors (`view.actors`,
 * present once NPCs take turns) are drawn over it. The player's own cell is
 * never overwritten.
 */
export function overlayActors(rows, actors, playerPosition) {
  return overlay(rows, actors, playerPosition, asciiGlyphForActor);
}

/** Traps (`view.hazards`) are not in core's buffer either; actors stand over them. */
export function overlayHazards(rows, hazards, playerPosition) {
  return overlay(rows, hazards, playerPosition, () => ASCII_ENTITY_GLYPHS.hazard);
}

/**
 * Row -> (column -> style) for every trap and actor with an affinity. Later
 * entries win a shared cell, so actors cover traps and the player covers all.
 */
function actorCellStyles(view) {
  const byRow = new Map();
  const entities = [
    ...(Array.isArray(view.hazards) ? view.hazards : []),
    ...(Array.isArray(view.actors) ? view.actors : []),
    view.player,
  ].filter(Boolean);
  for (const entity of entities) {
    const style = asciiActorCellStyle(entity);
    const { x, y } = entity.position || {};
    if (!style || !Number.isInteger(x) || !Number.isInteger(y)) continue;
    if (!byRow.has(y)) byRow.set(y, new Map());
    byRow.get(y).set(x, style);
  }
  return byRow;
}

/** Vitals the actor actually has: a 0/0 pool is absent, not empty. */
function presentVitals(player) {
  return (player?.vitals || []).filter((vital) => vital.max > 0);
}

export function statusLine(status, message, { traps = false } = {}) {
  if (message) return message;
  if (status?.exited) return "You escaped! Press Enter for the next level, r to replay, q to quit.";
  if (status?.atExit) return "You reached the exit. Press . to step through.";
  return traps ? `Find the exit (E). Mind the traps (${ASCII_ENTITY_GLYPHS.hazard}).` : "Find the exit (E).";
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
  const styles = color ? buildAsciiCellStyles(view.legend) : null;
  const actorCells = color ? actorCellStyles(view) : null;
  const playerPosition = view.player?.position;
  overlayActors(overlayHazards(view.rows, view.hazards, playerPosition), view.actors, playerPosition).forEach((row, y) => {
    lines.push(`  ${styles ? paintBoardRow(row, styles, actorCells.get(y)) : row}`);
  });
  lines.push("");
  const vitals = presentVitals(view.player).map((vital) => vitalBar(vital, color));
  if (vitals.length > 0) lines.push(vitals.join("   "));
  lines.push(`Tick ${view.tick}   Turns ${turns}`);
  lines.push(statusLine(view.status, message, { traps: Array.isArray(view.hazards) && view.hazards.length > 0 }));
  if (showHelp) {
    lines.push("");
    lines.push(...HELP_LINES);
  }
  return lines.join("\n");
}
