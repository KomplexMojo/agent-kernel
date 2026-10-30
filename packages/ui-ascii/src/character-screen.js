/**
 * Draws the character sheet and maps keys to its intents. Pure: takes the runtime sheet's
 * `view()` and returns a string, so it renders the same in a test as on a terminal or in a
 * browser tab. The sheet decides what a choice costs and whether it stands; this only lays
 * the rows out.
 */
import { GAME_AFFINITY_COLOR_HEX, GAME_COLOR_PALETTE } from "../../runtime/src/contracts/game-elements.js";
import { SHEET_INTENT } from "../../runtime/src/runner/character-sheet.js";
import { paint } from "./screen.js";

const KEY_INTENTS = Object.freeze({
  "\u001b[A": SHEET_INTENT.UP, k: SHEET_INTENT.UP, w: SHEET_INTENT.UP,
  "\u001b[B": SHEET_INTENT.DOWN, j: SHEET_INTENT.DOWN, s: SHEET_INTENT.DOWN,
  "\u001b[D": SHEET_INTENT.LEFT, h: SHEET_INTENT.LEFT, a: SHEET_INTENT.LEFT,
  "\u001b[C": SHEET_INTENT.RIGHT, l: SHEET_INTENT.RIGHT, d: SHEET_INTENT.RIGHT, "\t": SHEET_INTENT.RIGHT,
  "+": SHEET_INTENT.INC, "=": SHEET_INTENT.INC, "-": SHEET_INTENT.DEC, _: SHEET_INTENT.DEC,
  "]": SHEET_INTENT.INC_BIG, "[": SHEET_INTENT.DEC_BIG,
  x: SHEET_INTENT.CLEAR_SLOT, r: SHEET_INTENT.RESET,
  "\r": SHEET_INTENT.CONFIRM, "\n": SHEET_INTENT.CONFIRM,
  q: SHEET_INTENT.CANCEL, "\u001b": SHEET_INTENT.CANCEL, "\u0003": SHEET_INTENT.CANCEL,
});

/** The sheet intent for one key, or null. */
export function sheetIntentForKey(key) {
  return KEY_INTENTS[key] ?? null;
}

export const SHEET_HELP_LINES = Object.freeze([
  "↑↓ (w s j k) row   ←→ (a d h l, Tab) field   + − change (kind, role: none, then each)   ] [ by 5",
  "x set slot to none   r reset   Enter play   q or Esc back",
]);

const pad = (text, width) => String(text).padEnd(width);
const BAR_WIDTH = 20;

function allowanceBar(total, allowance, color) {
  const filled = Math.min(BAR_WIDTH, Math.round((total / Math.max(1, allowance)) * BAR_WIDTH));
  const bar = "█".repeat(filled) + "░".repeat(BAR_WIDTH - filled);
  return paint(bar, total > allowance ? GAME_COLOR_PALETTE.items.hazard : GAME_COLOR_PALETTE.items.resource, color);
}

function cell(text, width, { selected, hex, color }) {
  const body = pad(selected ? `[${text}]` : ` ${text} `, width);
  return hex ? paint(body, hex, color) : body;
}

const WIDTHS = { kind: 10, expression: 8, range: 6, intensity: 6, mana: 11, max: 7, regen: 7 };

/** @param {object} view the character sheet's `view()`; @param {{ color?: false|string, title?: string }} options */
export function renderCharacterScreen(view, { color = false, title = "Your delver" } = {}) {
  const lines = [];
  lines.push(`${title.toUpperCase()}    Budget ${view.total} / ${view.allowance}  ${allowanceBar(view.total, view.allowance, color)}`);
  lines.push("─".repeat(78));
  lines.push(`Motivation   ${view.motivation.name} (the playable right)${" ".repeat(34)}${String(view.motivation.price).padStart(5)}`);
  lines.push("");
  lines.push(`Affinities: ${view.equipSlots} equipped, then the pack (equip one in play for a turn; none is not bought)`);
  lines.push(`    ${pad("", 3)}${pad(" kind", WIDTHS.kind)}${pad(" form", WIDTHS.expression)}${pad(" range", WIDTHS.range)}${pad(" int", WIDTHS.intensity)}${pad(" mana", WIDTHS.mana)}${"price".padStart(8)}`);
  for (const row of view.rows.filter((entry) => entry.kind === "slot")) {
    if (row.packed && row.label === String(view.equipSlots + 1)) lines.push("    pack (carried, not equipped)");
    const mark = row.active ? ">" : " ";
    const cells = row.fields.map((field, index) => cell(field.value, WIDTHS[field.name], {
      selected: row.active && view.cursor.field === index,
      hex: field.name === "kind" ? GAME_AFFINITY_COLOR_HEX[field.value] : null,
      color,
    }));
    // The slot's mana, a guide: per tick for an emit or draw, per cast for a push or pull.
    const mana = row.mana ? paint(pad(` ${row.mana.amount}/${row.mana.per}`, WIDTHS.mana), row.mana.overMax ? GAME_COLOR_PALETTE.items.hazard : null, row.mana.overMax && color) : pad("", WIDTHS.mana);
    lines.push(`  ${mark} ${pad(row.label, 3)}${cells.join("")}${mana}${String(row.price).padStart(8)}`);
  }
  if (view.manaPerTick > 0) lines.push(`    emits and draws together: ${view.manaPerTick} mana a tick, against mana regen ${view.rows.find((row) => row.id === "vital-mana")?.fields[1].value}`);
  lines.push("");
  lines.push(`    ${pad("Vitals", 14)}${pad(" max", WIDTHS.max)}${pad(" regen", WIDTHS.regen)}${"price".padStart(26)}`);
  for (const row of view.rows.filter((entry) => entry.kind === "vital")) {
    const mark = row.active ? ">" : " ";
    const cells = row.fields.map((field, index) => cell(field.value, WIDTHS[field.name], { selected: row.active && view.cursor.field === index, color }));
    lines.push(`  ${mark} ${pad(row.label, 14)}${cells.join("")}${String(row.price).padStart(26)}`);
  }
  lines.push("");
  lines.push(`    ${pad("Minions (each follows you and takes orders)", 58)}${"price".padStart(8)}`);
  for (const row of view.rows.filter((entry) => entry.kind === "minion")) {
    const mark = row.active ? ">" : " ";
    const role = cell(row.fields[0].value, 10, { selected: row.active, color });
    lines.push(`  ${mark} ${pad(row.label, 3)}${role}${pad(row.loadout ?? "", 45)}${String(row.price).padStart(8)}`);
  }
  lines.push("─".repeat(78));
  if (view.problems.length > 0) view.problems.forEach((problem) => lines.push(paint(`! ${problem}`, GAME_COLOR_PALETTE.items.hazard, color)));
  else lines.push(`Ready: ${view.remaining} tokens left. Every price is the Allocator's.`);
  lines.push(...SHEET_HELP_LINES);
  return lines.join("\n");
}
