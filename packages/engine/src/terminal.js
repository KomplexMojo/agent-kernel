/**
 * `@agon-engine/engine/terminal` (#828): the reference terminal client, for a game that runs it
 * as is (the phone app does, in the page). `createGame`, the ASCII screen, terminal key decoding
 * and ANSI to HTML. Re-exports only.
 */
export * from "../../ui-ascii/src/game.js";
export * from "../../ui-ascii/src/screen.js";
export * from "../../ui-ascii/src/keymap.js";
export * from "../../ui-ascii/src/html.js";
