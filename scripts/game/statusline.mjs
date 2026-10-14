#!/usr/bin/env node
/**
 * A Claude Code status line for the game: the line `ak play-session` keeps about the
 * seated actor (artifacts/play-sessions/hud.txt), or nothing when no game is live.
 * Opt in from your own settings (.claude/settings.local.json):
 *   "statusLine": { "type": "command", "command": "node scripts/game/statusline.mjs" }
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const dir = process.env.AK_PLAY_SESSIONS_DIR || "artifacts/play-sessions";
try {
  process.stdout.write(readFileSync(resolve(dir, "hud.txt"), "utf8").trim());
} catch {
  // No live game: an empty status line.
}
