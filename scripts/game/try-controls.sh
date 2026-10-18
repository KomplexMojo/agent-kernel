#!/usr/bin/env bash
# Try the game controls the Claude Code harness drives, straight through `ak`.
# Each step prints the board and what changed; the same steps are what /game-play
# does through the ak_play_* MCP tools. Usage: bash scripts/game/try-controls.sh
set -euo pipefail
cd "$(dirname "$0")/../.."

AK="node packages/adapters-cli/src/cli/ak.mjs"
SESSION="try-controls"
LEVEL="$(mktemp -d)"
FLOOR="vitals=health:10:1,mana:10:1,stamina:10:1,durability:10:1"

# Print the board and the lines worth reading from one ak JSON result.
show() {
  node -e '
    const r = JSON.parse(require("fs").readFileSync(0, "utf8").trim().split("\n").at(-1));
    if (r.ok === false) { console.log("refused:", r.reason || r.error); process.exit(0); }
    if (r.screen) console.log(r.screen);
    if (r.party) console.log("party:", r.party.map((p) => `${p.label}${p.active ? "*" : ""} @${p.position.x},${p.position.y}`).join("  "));
    if (r.orders?.length) console.log("orders:", r.orders.map((o) => `${o.label} ${o.status} (goal ${o.goal + 1}/${o.goals})`).join("  "));
    if (r.stoppedBy) console.log(`advance: ${r.ticks} ticks, stopped by ${r.stoppedBy}`);
  '
}
step() { printf '\n=== %s ===\n' "$1"; }

step "1. Create a level: two playable delvers (D1, D2), one companion, one warden"
$AK create --room "size=medium;count=2" \
  --delver "count=2;id=hero;affinity=wind;motivation=user_controlled;$FLOOR" \
  --delver "count=1;id=pal;affinity=earth;motivation=exploring+friendly+goal_oriented;$FLOOR" \
  --warden "count=1;id=guard;affinity=fire;motivation=stationary" \
  --budget-tokens 8000 --out-dir "$LEVEL" | node -e 'const r=JSON.parse(require("fs").readFileSync(0,"utf8").trim().split("\n").at(-1)); console.log("level", r.runId, "actors", r.actorIds.join(", "))'

$AK play-session end --session "$SESSION" >/dev/null 2>&1 || true

step "2. Start the game (you are D1, the @)"
$AK play-session start --session "$SESSION" --dir "$LEVEL" | show

step "3. Move: D1 steps east (key d), one turn"
$AK play-session act --session "$SESSION" --keys d | show

step "4. Switch to D2 (free, no turn)"
$AK play-session switch --session "$SESSION" --actor D2 | show

step "5. Order the companion D3 to follow D2 (costs one turn)"
$AK play-session order --session "$SESSION" --actor D3 --strategy follow:hero-2:1 | show

step "6. Order a warden: refused, it is not on your side"
$AK play-session order --session "$SESSION" --actor guard-1 --strategy survive | show

step "7. Let the world run up to 5 turns"
$AK play-session advance --session "$SESSION" --ticks 5 | show

$AK play-session end --session "$SESSION" >/dev/null
rm -rf "$LEVEL"
printf '\nDone. The same controls in Claude Code: /game-new, then /game-play "move east", "switch to D2", "have D3 follow me".\n'
