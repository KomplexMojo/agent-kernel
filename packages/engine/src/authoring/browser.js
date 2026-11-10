/**
 * `@agon-engine/engine/authoring/browser` (#846): the part of `/authoring` a browser bundle can import.
 * `authorLevel`, the character sheet and the recorded solver adapter, with no Node builtin anywhere
 * in their import graph. `/authoring` adds the playtest catalogue, which reads files, so a phone app
 * imports this entry and a Node build script imports `/authoring`. Re-exports only.
 */
export * from "../../../runtime/src/commands/author-level.js";
export * from "../../../runtime/src/runner/character-sheet.js";
export * from "../../../adapters-web/src/adapters/solver-recorded/index.js";
