/**
 * The game controller: turns intents into play-session commands and tracks
 * presentation state (which level, how many turns, the last message). No
 * terminal IO and no rules — `cli.mjs` owns the terminal, the runtime play
 * session owns the simulation.
 */
import { createGameController } from "../../runtime/src/controls/game-controller.js";
import { createPlaySession } from "../../runtime/src/runner/play-session.js";
import { ROLE_TAG, affinityRole } from "../../runtime/src/render/affinity-role.js";
import { renderScreen, paintBoardRow, revealNote } from "./screen.js";
import { buildAsciiCellStyles } from "../../runtime/src/render/ascii-cell-style.js";
import { buildNotebook, pieQuarters } from "../../runtime/src/render/notebook.js";
import { LEVELS, affinityLabel, aimLabel, castable, equippedKeys, keyLabel, lootLabel, runningLevel } from "../../runtime/src/controls/messages.js";

// The message helpers moved to runtime (#505); this module keeps exporting the ones it always did.
export { affinityLabel, battleLines, allyWarningLines, vitalChangeLine, HOLD_ORDER_TICKS } from "../../runtime/src/controls/messages.js";

/**
 * @param {object} args
 * @param {Array<{name: string, simConfig: object, initialState: object}>} args.levels
 * @param {number} [args.startIndex]
 * @param {Function} [args.createSession] injectable for tests
 * @param {boolean} [args.fog] fog of war: you see only what is in sight (default on)
 * @param {boolean} [args.showHelp] start with the key help shown (default)
 */
export async function createGame(options = {}) {
  const controller = await createGameController({ createSession: createPlaySession, ...options });
  function panelLines(color = false) {
    const { panel, view } = controller.frame();
    if (!panel) return null;
    if (panel.type === "affinities") {
      const player = view.player;
      const equipped = equippedKeys(player);
      return ["Affinities (a number equips or unequips; Tab picks, + / - range, ] / [ intensity; Esc closes):",
        ...panel.items.map((pair, i) => {
          const slot = equipped.indexOf(`${pair.kind}:${pair.expression}`);
          const lowered = ["stacks", "intensity"].some((field) => runningLevel(player, pair, field) < LEVELS[field].held(pair));
          const at = slot >= 0 && lowered
            ? `, running r${runningLevel(player, pair, "stacks")} ×${runningLevel(player, pair, "intensity")}` : "";
          return `${i === panel.index ? ">" : " "} ${i + 1}) ${affinityLabel(pair)}${slot >= 0 ? `  [slot ${slot + 1}${at}]` : ""} ${ROLE_TAG[affinityRole(pair.kind, pair.expression)] ?? ""}`;
        })];
    }
    if (panel.type === "map") {
      // the frame's view
      // #593: the start and exit marks take the board's S and E colours (the `\u001b` codes also reach the phone page).
      const styles = color ? buildAsciiCellStyles(view.legend) : null;
      const markGlyph = { start: view.legend?.spawn, exit: view.legend?.exit };
      const paint = styles ? (glyph, mark) => paintBoardRow(glyph, { [glyph]: styles[markGlyph[mark]] }, null, null, color === "256" ? "256" : "truecolor") : null;
      const { lines, here } = buildNotebook({ rows: view.rows, legend: view.legend, rooms: view.rooms, player: view.player?.position, paint });
      const pie = here ? `   You are in a room ${["0", "1/4", "1/2", "3/4", "all"][pieQuarters(here)]} cleared` : "";
      return [`Notebook (what you remember; m or Esc closes):${pie}`,
        ...(lines.length ? lines.map((line) => `  ${line}`) : ["  nothing noted yet"]),
        "  \u25cc none  \u25d4 1/4  \u25d2 1/2  \u25d5 3/4  \u25c9 cleared (of what you have seen)"];
    }
    if (panel.type === "order_actor") {
      return ["Order who? (a number picks, Esc closes):",
        ...panel.items.map((item, i) => `  ${i + 1}) ${item.label ? `${item.label} ` : ""}${item.id}`)];
    }
    if (panel.type === "order_goal") {
      return [`Order ${panel.target.label ?? panel.target.id} to (a number gives the order, a turn; Esc closes):`,
        ...panel.items.map((item, i) => `  ${i + 1}) ${item.label}`)];
    }
    if (panel.type === "loot") {
      return ["Take (a number picks, Esc closes):",
        ...panel.items.map((item, i) => `  ${i + 1}) ${lootLabel(item)} from ${item.targetId}`)];
    }
    const player = view.player;
    const key = panel.affinityKey ?? equippedKeys(player).find((k) => castable(player)[k]);
    const reach = key ? castable(player)[key]?.range : undefined;
    const tiles = (n) => `${n} ${n === 1 ? "tile" : "tiles"}`;
    if (panel.type === "aim") {
      const at = player?.position ?? panel.cursor;
      const away = Math.max(Math.abs(panel.cursor.x - at.x), Math.abs(panel.cursor.y - at.y));
      return [`${panel.raise ? "Raise" : "Aim"}: the tile ${aimLabel(at, panel.cursor)}${key ? ` with ${keyLabel(key)}` : ""} (${tiles(away)} away${reach !== undefined ? `, reaches ${tiles(reach)}` : ""})`,
        panel.raise ? "  Move keys aim, Enter raises a barrier line there, Esc cancels"
          : "  Move keys aim, Enter casts along the line: it hits the first actor or wall, Tab targets, Esc cancels"];
    }
    const target = panel.items[panel.index];
    // #497: looking costs a turn, so the picker shows what is plainly in view, never the target's state.
    if (panel.inspect) return [`Inspect: ${target.id}${revealNote(target)} (${tiles(target.distance)} away)   Tab next, Enter spend a turn looking, Esc cancel`];
    if (panel.watch) return [`${target.watched ? "Stop watching" : "Watch"}: ${target.id}${revealNote(target)} (${tiles(target.distance)} away)   Tab next, Enter ${target.watched ? "to stop" : "to begin, 1 mana a turn"}, Esc cancel`];
    return [`Target: ${target.id}${revealNote(target)}${panel.affinityKey ? ` with ${keyLabel(panel.affinityKey)}` : ""} (${tiles(target.distance)} away${reach !== undefined ? `, reaches ${tiles(reach)}` : ""})   Tab next, Enter cast, Esc cancel`];
  }


  function screen({ color = false, parts = false } = {}) {
    const frame = controller.frame();
    return renderScreen({
      parts,
      view: frame.view,
      levelName: frame.levelName,
      grade: frame.grade,
      levelIndex: frame.levelIndex,
      levelCount: frame.levelCount,
      turns: frame.turns,
      message: frame.message,
      showHelp: frame.showHelp,
      color,
      panel: panelLines(color),
      windowSize: frame.windowSize,
      aim: frame.aim,
    });
  }

  const { frame, ...shared } = controller;
  return { ...shared, screen };
}
