// #828: the engine's five named entry points are the public API a game imports
// (`@agon-engine/engine/client` and so on). Adding a name is fine; removing or renaming one breaks
// the game, so each list is pinned and a shrink fails here first.
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");

const ROOT = resolve(__dirname, "../..");
const BOUNDARY = JSON.parse(readFileSync(resolve(ROOT, "tests/architecture/framework-game-boundary.json"), "utf8"));
const ENGINE = JSON.parse(readFileSync(resolve(ROOT, "packages/engine/package.json"), "utf8"));

const PINNED = {
  "client": ["ENTITY_SPRITE_ROLES", "HELP_LINES", "HOLD_ORDER_TICKS", "HUD_VITAL_LABELS", "ICON_SHAPES", "INTENT", "INTENT_BINDINGS", "LEVELS", "MOVE_BINDINGS", "MOVE_DIRECTIONS", "PLAY_COMMAND_KINDS", "PLAY_DIRECTIONS", "PLAY_DIRECTION_STEPS", "PLAY_SIGHT", "REJECTION_MESSAGES", "RESOURCE_BUNDLE_DRESSING_SCHEMA", "RESOURCE_BUNDLE_SCHEMA", "ROLE_NAME", "ROLE_TAG", "TILE_CSS_PX", "VITAL_LINE_LIMIT", "WALL_BLOB_BITS", "WALL_BLOB_MASKS", "WALL_NEIGHBOUR_BITS", "WATCH_BINDINGS", "WATCH_HELP_LINES", "WATCH_INTENT", "WINDOW_DEFAULT", "WINDOW_MAX", "WINDOW_MIN", "affinityLabel", "affinityRole", "affinityTraitKinds", "aimLabel", "allyWarningLines", "battleLines", "buildActorHudModel", "buildAffinityBoardOverlayModel", "buildBoardDrawModel", "buildBoardFrame", "buildIconModel", "castable", "changeLabel", "chebyshev", "createDefaultResourceBundleArtifact", "createGameController", "createPlaySession", "currentMana", "dressResourceBundle", "elementArtCoverage", "elementKeyFor", "equippedKeys", "grantLabel", "hasAttackOption", "intentForLogicalKey", "keyLabel", "listResourceBundleAssetFiles", "lootLabel", "normalizeEntitySpriteState", "normalizePlayCommand", "orderChoices", "playWindowBounds", "rejectionMessage", "replayPlaySession", "resolveElementArt", "runningLevel", "signed", "slotLevelLabel", "takeRefusal", "targetsInSight", "validateResourceBundleArtifact", "validateResourceBundleDressing", "vitalChangeLine", "wallBlobSlot", "watchIntentForLogicalKey", "windowSizeForTerminal", "windowSizeForViewport"],
  "authoring": ["AGON_CLI", "MINION_FIELDS", "NUMERIC_FIELDS", "SHEET_AFFINITY_ROWS", "SHEET_INTENT", "SLOT_FIELDS", "SLOT_KIND_CHOICES", "VITAL_FIELDS", "affinitiesForSeed", "authorLevel", "createArgs", "createCharacterSheet", "createRecordedSolverAdapter", "fillFocus", "loadPlaytestScenarios", "playerDelverSpec", "runHostedAuthoringBuild", "scenarioArgs", "sheetChoicesFromSpec", "traitKinds", "traitsInPlay"],
  "skin": ["ENTITY_SPRITE_CANONICAL_SIZE", "ENTITY_SPRITE_OUTLINE_DARK", "ENTITY_SPRITE_OUTLINE_LIGHT", "ENTITY_SPRITE_ROLES", "GAME_AFFINITY_COLOR_HEX", "GAME_AFFINITY_EXPRESSIONS", "GAME_AFFINITY_KINDS", "GAME_AFFINITY_TEXT_COLOR_HEX", "GAME_COLOR_PALETTE", "GAME_ELEMENT_ASSET_IDS", "GAME_ELEMENT_ICON_KEYS", "GAME_ELEMENT_VISUALS", "GAME_ICON_FALLBACKS", "GAME_MOTIVATION_DISPLAY_GROUPS", "GAME_MOTIVATION_FAMILIES", "GAME_MOTIVATION_KINDS", "GAME_MOTIVATION_KIND_IDS", "GAME_VITAL_KEYS", "RESOURCE_BUNDLE_DRESSING_SCHEMA", "RESOURCE_BUNDLE_SCHEMA", "composeEntitySprite", "createDefaultResourceBundleArtifact", "dressResourceBundle", "elementArtCoverage", "elementKeyFor", "getGameElementVisual", "getGameElementVisualEntries", "getResourceBundleAssetSpecs", "listResourceBundleAssetFiles", "normalizeEntitySpriteState", "outlineForFill", "relativePathForGameAssetId", "resolveElementArt", "resolveEquippedAffinity", "validateResourceBundleArtifact", "validateResourceBundleDressing"],
  "vocabulary": ["GAME_AFFINITY_EXPRESSIONS", "GAME_AFFINITY_KINDS", "GAME_MOTIVATION_DISPLAY_GROUPS", "GAME_MOTIVATION_FAMILIES", "GAME_MOTIVATION_KINDS", "GAME_MOTIVATION_KIND_IDS", "GAME_VITAL_KEYS", "SOUND_CUE_EVENTS", "SOUND_CUE_SEAT_ROLES"],
  "terminal": ["HELP_LINES", "HOLD_ORDER_TICKS", "INTENT", "WATCH_HELP_LINES", "WATCH_INTENT", "affinityLabel", "affinityLines", "allyWarningLines", "ansiToHtml", "battleLines", "battleLogLines", "createGame", "defeatCause", "defeatSentence", "departuresLine", "exhaustedAffinityNote", "fieldHereLine", "goalLadder", "hudLine", "inSightLine", "inspectionLines", "intentForKey", "logicalKeyForTerminalKey", "motivationNote", "moveCostLine", "ordersLine", "overlayActors", "overlayCastPaths", "overlayDefeatMarks", "overlayFieldMarks", "overlayHazards", "paint", "paintBoardRow", "partyLine", "renderScreen", "revealNote", "revealedDetail", "slotLevelLabel", "soakedNote", "splitKeys", "statusLine", "terminalKeysForLogicalKeys", "vitalChangeLine", "watchIntentForKey", "xterm256Index"]
};

for (const [entry, names] of Object.entries(PINNED)) {
  const file = `packages/engine/src/${entry}.js`;

  test(`${entry} exports at least its pinned names, each defined`, async () => {
    const surface = await import(resolve(ROOT, file));
    const missing = names.filter((name) => surface[name] === undefined);
    assert.deepEqual(missing, [], `${file} lost published names: ${missing.join(", ")}`);
  });

  test(`${entry} re-exports only: no logic of its own`, () => {
    const source = readFileSync(resolve(ROOT, file), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    assert.doesNotMatch(source, /\b(function|const|let|class|import)\b/, `${file} must contain re-exports only`);
  });

  test(`${entry} is on the API surface and published as @agon-engine/engine/${entry}`, () => {
    assert.ok(BOUNDARY.apiSurface[file], `${file} must be listed in apiSurface`);
    assert.equal(ENGINE.exports[`./${entry}`], `./dist/${entry}.js`);
  });
}

test("the vocabulary is published, not the engine's internal constants (#828)", () => {
  assert.equal(BOUNDARY.apiSurface["packages/runtime/src/contracts/domain-constants.js"], undefined,
    "domain-constants.js carries LLM prompt builders and model settings; games read /vocabulary");
  assert.equal(ENGINE.exports["./runtime/contracts/domain-constants.js"], undefined);
});

// ## TODO: Test Permutations
// - every name a file-path alias exports is reachable from one of the five entries
// - no two entries export the same name with different values
