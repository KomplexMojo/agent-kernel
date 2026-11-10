/**
 * `@agon-engine/engine/client` (#828): everything a game client needs to play a level and draw it.
 * The play session, the shared game controller and its intents and messages, the board frame, the
 * HUD and overlay models, and the observed window size. Re-exports only: the modules named here
 * are where the code lives.
 */
export * from "../../runtime/src/render/client-surface.js";
export * from "../../runtime/src/controls/intents.js";
export * from "../../runtime/src/controls/game-controller.js";
export * from "../../runtime/src/controls/messages.js";
export * from "../../runtime/src/render/window-size.js";
export * from "../../runtime/src/render/affinity-role.js";
