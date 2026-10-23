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
import {
  ASCII_REMEMBERED_FLOOR_MONO,
  asciiActorCellStyle,
  asciiFieldCellStyle,
  asciiRememberedCellStyle,
  buildAsciiCellStyles,
} from "../../runtime/src/render/ascii-cell-style.js";
import { PLAY_SIGHT, PLAYER_MOTIVATION } from "../../runtime/src/runner/play-session.js";
import { ASCII_AIM_GLYPH, ASCII_ENTITY_GLYPHS, ASCII_TERRAIN_GLYPHS, asciiGlyphForActor } from "../../runtime/src/render/visualization-snapshot.js";
import { HELP_LINES } from "./keymap.js";

const BAR_WIDTH = 10;
const RESET = "\u001b[0m";

/**
 * The colour depth a `color` option asks for: `"256"` for xterm-256 terminals
 * (macOS Terminal reads 24-bit codes as separate attributes, #286), anything
 * else truthy for 24-bit.
 */
function depthOf(color) {
  return color === "256" ? "256" : "truecolor";
}

const CUBE_LEVELS = [0, 95, 135, 175, 215, 255];

/** The nearest xterm-256 index for an RGB colour: the 6×6×6 cube or the grey ramp. */
export function xterm256Index(r, g, b) {
  const nearestLevel = (channel) => CUBE_LEVELS.reduce((best, level, i) =>
    (Math.abs(level - channel) < Math.abs(CUBE_LEVELS[best] - channel) ? i : best), 0);
  const [cr, cg, cb] = [r, g, b].map(nearestLevel);
  const cube = [CUBE_LEVELS[cr], CUBE_LEVELS[cg], CUBE_LEVELS[cb]];
  const greyStep = Math.max(0, Math.min(23, Math.round(((r + g + b) / 3 - 8) / 10)));
  const grey = 8 + greyStep * 10;
  const distance = (target) => (target[0] - r) ** 2 + (target[1] - g) ** 2 + (target[2] - b) ** 2;
  return distance([grey, grey, grey]) < distance(cube) ? 232 + greyStep : 16 + 36 * cr + 6 * cg + cb;
}

/** ANSI for a palette hex at a colour depth; layer 38 is foreground, 48 background. */
function ansiForHex(hex, layer = 38, depth = "truecolor") {
  const match = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(String(hex || ""));
  if (!match) return "";
  const [r, g, b] = match.slice(1).map((part) => parseInt(part, 16));
  if (depth === "256") return `\u001b[${layer};5;${xterm256Index(r, g, b)}m`;
  return `\u001b[${layer};2;${r};${g};${b}m`;
}

function paint(text, hex, color) {
  if (!color) return text;
  const code = ansiForHex(hex, 38, depthOf(color));
  return code ? `${code}${text}${RESET}` : text;
}

/**
 * Colour one board row cell by cell; characters with no style stay plain.
 * `cellStyles` (column -> style) overrides the per-character style, which is
 * how an actor's affinity colours its cell. `sightRow` (the play session's
 * fog of war) dims the cells the player only remembers. `fieldRow` (the view's
 * per-cell affinity fields) tints `floorChar` cells by the fields on them.
 */
export function paintBoardRow(row, styles, cellStyles = null, sightRow = null, depth = "truecolor", fieldRow = null, floorChar = null) {
  let out = "";
  let open = null;
  for (let x = 0; x < row.length; x += 1) {
    const char = row[x];
    // Floor shows the affinity fields on it (#287); actors and traps keep their own fill.
    const tile = char === floorChar ? asciiFieldCellStyle(styles[char] || null, fieldRow?.[x]) : styles[char] || null;
    const base = cellStyles?.get(x) || tile;
    const style = sightRow?.[x] === PLAY_SIGHT.REMEMBERED ? asciiRememberedCellStyle(base) : base;
    const code = style ? `${ansiForHex(style.bg, 48, depth)}${ansiForHex(style.fg, 38, depth)}` : "";
    if (code !== open) {
      out += open ? RESET : "";
      out += code;
      open = code || null;
    }
    out += char;
  }
  return open ? `${out}${RESET}` : out;
}

/** Without colour, remembered floor is drawn blank so it never reads as floor in sight (#284). */
function monoBoardRow(row, sightRow, floorChar) {
  if (!sightRow || !floorChar) return row;
  return [...row].map((char, x) => (char === floorChar && sightRow[x] === PLAY_SIGHT.REMEMBERED
    ? ASCII_REMEMBERED_FLOOR_MONO : char)).join("");
}

/** `current/max (+regen)`: the regen is what the vital gains each turn before any upkeep or harm. */
function vitalAmount(vital) {
  return `${vital.current}/${vital.max} (+${vital.regen})`;
}

function vitalBar(vital, color) {
  const filled = Math.round(Math.max(0, Math.min(1, vital.fraction)) * BAR_WIDTH);
  const bar = "█".repeat(filled) + "░".repeat(BAR_WIDTH - filled);
  return `${vital.label} ${paint(bar, vital.colorHex, color)} ${vitalAmount(vital)}`;
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
  if (status?.defeated) return "You were defeated. Press r to try the level again, q to quit.";
  if (status?.atExit) return "You reached the exit. Press . to step through.";
  const exit = `Find the exit (${ASCII_TERRAIN_GLYPHS.exit}).`;
  return traps ? `${exit} Mind the traps (${ASCII_ENTITY_GLYPHS.hazard}).` : exit;
}

/**
 * One HUD row per equipped slot, in equip order, then the free ones; a lasting
 * affinity that ran out of mana says it is off. A hint when nothing is equipped.
 */
export function affinityLines(player, { hints = true } = {}) {
  if (!player) return [];
  const known = Array.isArray(player.affinities) ? player.affinities : [];
  const equipped = player.equippedAffinityKeys || [];
  const slots = Math.max(player.affinitySlots ?? 1, equipped.length);
  if (equipped.length === 0) {
    if (known.length === 0) return ["Affinity: none"];
    const hint = hints ? " (press i to equip)" : "";
    return [slots === 1 ? `Slot 1: empty${hint}` : `Slots: all ${slots} empty${hint}`];
  }
  const off = Array.isArray(player.exhaustedAffinityKeys) ? player.exhaustedAffinityKeys
    : (player.affinityExhausted ? equipped : []);
  return Array.from({ length: slots }, (_, i) => {
    const key = equipped[i];
    const pair = key && known.find((entry) => `${entry.kind}:${entry.expression}` === key);
    if (!pair) return `Slot ${i + 1}: empty`;
    const note = off.includes(key) ? "  (off until mana is full)" : "";
    return `Slot ${i + 1}: ${pair.kind} ${pair.expression} ${slotLevelLabel(player, pair)}${note}`;
  });
}

/**
 * An affinity's range and intensity as `r6 ×2` (#345). A slot run below what is held shows
 * running/held for that number (#230): `r1/6 ×2`, `r6 ×1/2`.
 */
export function slotLevelLabel(player, pair) {
  const key = `${pair.kind}:${pair.expression}`;
  const heldIntensity = pair.intensity ?? 1;
  const level = (running, held) => (Number.isInteger(running) && running < held ? `${running}/${held}` : `${held}`);
  return `r${level(player?.equippedAffinityStacks?.[key], pair.stacks)}`
    + ` ×${level(player?.equippedAffinityIntensity?.[key], heldIntensity)}`;
}

/** An actor's motivation stack, in brackets after its name (#310); nothing when it has none. */
export function motivationNote(motivations) {
  return Array.isArray(motivations) && motivations.length > 0 ? ` (${motivations.join(", ")})` : "";
}

/**
 * What you can read of an actor you see (#416): its motivations once light reveals it, `(?)`
 * while nothing does (the view leaves its properties out).
 */
export function revealNote(actor) {
  return actor?.revealed === 0 ? " (?)" : motivationNote(actor?.motivations);
}

/**
 * A revealed actor's properties, for the target picker (#416): health and each affinity as
 * `kind expression rR ×I`. Values light could not reach read `n+`; hidden ones `?`.
 */
export function revealedDetail(actor) {
  if (!actor || actor.revealed === 0) return " HP ?";
  const health = actor.vitals?.health;
  const parts = [...(health ? [`HP ${health.current}/${health.max}`] : []),
    ...(actor.affinities ?? []).map((pair) => `${pair.kind} ${pair.expression} r${pair.stacks} ×${pair.intensity ?? 1}`)];
  return parts.length ? ` ${parts.join(", ")}` : "";
}

function memberNote(status) {
  if (status?.defeated) return " (defeated)";
  if (status?.exited) return " (escaped)";
  return "";
}

/**
 * Who you can play, when there is more than one: the seated member in brackets, each
 * by the short label the view gives it (Tab plays the next).
 */
export function partyLine(party) {
  if (!Array.isArray(party) || party.length < 2) return null;
  return `Party: ${party.map((member) => {
    // Every member is user_controlled; the rest of its stack is what says how it acts alone.
    const own = (member.motivations ?? []).filter((motivation) => motivation !== PLAYER_MOTIVATION);
    const name = `${member.label ?? "?"} ${member.id}${motivationNote(own)}${memberNote(member.status)}`;
    return member.active ? `[${name}]` : name;
  }).join("  ")}`;
}

/**
 * One plain line about the seated actor (who, vitals, tick), for a status line outside
 * the game such as Claude Code's (`ak play-session` writes it to a file).
 */
export function hudLine(view, { turns } = {}) {
  const player = view.player;
  const who = player ? `${player.label ? `${player.label} ` : ""}${player.id}` : "nobody seated";
  const vitals = presentVitals(player).map((vital) => `${vital.label} ${vitalAmount(vital)}`).join(" ");
  const state = view.status?.exited ? "escaped" : view.status?.defeated ? "defeated" : view.status?.atExit ? "at the exit" : "";
  return [who, vitals, `tick ${view.tick}${Number.isInteger(turns) ? `, ${turns} ${turns === 1 ? "turn" : "turns"}` : ""}`, state].filter(Boolean).join(" · ");
}

function goalPhrase(goal) {
  if (!goal) return "";
  const place = (at) => (at === "exit" ? "the exit" : `${at.x},${at.y}`);
  switch (goal.kind) {
    case "reach": return `reach ${place(goal.place)}`;
    case "hold": return `hold ${place(goal.place)}`;
    case "lead": return `lead ${goal.target} to ${place(goal.place)}`;
    case "survive": return "survive";
    default: return `${goal.kind} ${goal.target}`;
  }
}

/**
 * Who is under orders and how it is going (Phase 2b), one entry each:
 * `Orders: D3 follow hero-1 (1/2)  D4 defeat W1 (searching)`.
 */
export function ordersLine(orders) {
  if (!Array.isArray(orders) || orders.length === 0) return null;
  return `Orders: ${orders.map((entry) => {
    const doing = entry.status === "done" ? "done" : entry.status === "ignored" ? "ignores its orders" : goalPhrase(entry.doing);
    const step = entry.goals > 1 && entry.status !== "done" ? ` ${entry.goal + 1}/${entry.goals}` : "";
    const how = ["searching", "stalled"].includes(entry.status) ? ` (${entry.status})` : "";
    return `${entry.label ?? entry.id} ${doing}${step}${how}`;
  }).join("  ")}`;
}

/**
 * Everyone in sight right now, by label, so a person or Claude can name them; a source
 * that is off until its mana is full says so, like the player's own slot line (#412).
 */
export function inSightLine(view) {
  const seen = [...(view.actors || []), ...(view.hazards || [])].filter((actor) => actor.label);
  if (seen.length === 0) return null;
  return `In sight: ${seen.map((actor) => `${actor.label} ${actor.id}${revealNote(actor)}`
    + (actor.affinityOff ? " (off until mana is full)" : "")).join("  ")}`;
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
 * @param {boolean|string} [args.color] emit ANSI colour: true or "truecolor" for 24-bit, "256" for xterm-256
 * @param {string[]} [args.panel]   lines of an open panel (affinities, target, loot)
 * @param {string} [args.title]      replaces the game's title line (the run viewer's)
 * @param {string} [args.tickLine]   replaces the "Tick n   Turns n" line
 * @param {string[]} [args.helpLines] replaces the game's key help
 * @param {boolean} [args.hints]     the HUD's "press i" hints (off when watching a run)
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
  panel = null,
  aim = null,
  title = `Deepward — ${levelName} (${levelIndex + 1}/${levelCount})`,
  tickLine = `Tick ${view.tick}   Turns ${turns}`,
  helpLines = HELP_LINES,
  hints = true,
}) {
  const lines = [];
  lines.push(title);
  lines.push("");
  const styles = color ? buildAsciiCellStyles(view.legend) : null;
  const actorCells = color ? actorCellStyles(view) : null;
  const playerPosition = view.player?.position;
  const board = [...overlayActors(overlayHazards(view.rows, view.hazards, playerPosition), view.actors, playerPosition)];
  // The tile a cast is being aimed at (#413).
  if (aim && typeof board[aim.y] === "string" && aim.x >= 0 && aim.x < board[aim.y].length) {
    board[aim.y] = `${board[aim.y].slice(0, aim.x)}${ASCII_AIM_GLYPH}${board[aim.y].slice(aim.x + 1)}`;
  }
  board.forEach((row, y) => {
    lines.push(`  ${styles ? paintBoardRow(row, styles, actorCells.get(y), view.sight?.[y], depthOf(color), view.field?.[y], view.legend?.floor)
      : monoBoardRow(row, view.sight?.[y], view.legend?.floor)}`);
  });
  lines.push("");
  const vitals = presentVitals(view.player).map((vital) => vitalBar(vital, color));
  if (vitals.length > 0) lines.push(vitals.join("   "));
  lines.push(...affinityLines(view.player, { hints }));
  for (const line of [partyLine(view.party), ordersLine(view.orders), inSightLine(view)]) if (line) lines.push(line);
  lines.push(tickLine);
  lines.push(statusLine(view.status, message, { traps: Array.isArray(view.hazards) && view.hazards.length > 0 }));
  if (Array.isArray(panel) && panel.length > 0) {
    lines.push("");
    lines.push(...panel);
  }
  if (showHelp) {
    lines.push("");
    lines.push(...helpLines);
  }
  return lines.join("\n");
}
