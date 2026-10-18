#!/usr/bin/env bash
# Walk through everything merged overnight on 2026-10-16/17 (#285, #293-#330), each part
# through `ak` and the personas: levels come from `ak create`, prices from the Allocator.
# Usage: bash scripts/demo/overnight-2026-10-17.sh [section ...]
#   sections: rules blind corrode stamina rename regen motivations pricing solver hygiene orders
#   (no section runs them all, in that order; takes a few minutes)
set -euo pipefail
cd "$(dirname "$0")/../.."

AK="node packages/adapters-cli/src/cli/ak.mjs"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
SESSION="overnight-demo"

# The five opposed pairs, both ways round.
# (A function, not an associative array: macOS ships bash 3.2.)
opposite() {
  case $1 in
    fire) echo water;; water) echo fire;; earth) echo wind;; wind) echo earth;;
    growth) echo decay;; decay) echo growth;; corrode) echo fortify;; fortify) echo corrode;;
    light) echo dark;; dark) echo light;;
  esac
}

# macOS has shasum, not sha256sum.
if command -v sha256sum >/dev/null; then SHA256=sha256sum; else SHA256="shasum -a 256"; fi

section() { printf '\n\n######## %s ########\n' "$1"; }
step() { printf '\n=== %s ===\n' "$1"; }
say() { printf '%s\n' "$@"; }

# Read the last JSON line of an ak result on stdin and print what the expression picks.
pick() {
  node -e '
    const r = JSON.parse(require("fs").readFileSync(0, "utf8").trim().split("\n").at(-1));
    const out = (new Function("r", "return " + process.argv[1]))(r);
    console.log(typeof out === "string" ? out : JSON.stringify(out));
  ' "$1"
}
hud() { pick 'r.ok === false ? "refused: " + (r.reason || r.error) : r.hud'; }
board() { pick 'r.screen.split("\n").slice(2, 14).join("\n")'; }
json() { node -e 'const r = require(require("path").resolve(process.argv[1])); console.log((new Function("r", "return " + process.argv[2]))(r))' "$1" "$2"; }

# Run quietly; on failure show what it said and stop.
quiet() { "$@" >"$WORK/quiet.log" 2>&1 || { cat "$WORK/quiet.log" >&2; return 1; }; }
create() { quiet $AK create --created-at 2026-10-17T00:00:00.000Z "$@"; }
session() { $AK play-session "$@" --session "$SESSION"; }
# A run stopped part way leaves its session behind with its level gone; drop that file.
end_session() { session end >/dev/null 2>&1 || rm -f "${AK_PLAY_SESSIONS_DIR:-artifacts/play-sessions}/$SESSION.json"; }

# A playable delver emitting $1 at intensity 3, a trap beside it emitting $2 at intensity $3,
# both at range 3 (since #342, stacks is range and intensity is strength).
pair_level() {
  create --budget-tokens 5000 --out-dir "$4" --room "size=medium;count=1" \
    --delver "count=1;id=hero;affinities=$1:emit:3:3;equip=$1:emit;motivation=user_controlled;vitals=health:10:20:1,mana:60:6,stamina:10:1,durability:10:1" \
    --hazard "x=3;y=3;affinity=$2;expression=emit;stacks=3;intensity=$3;vitals=mana:60:10,durability:10:1"
}

rules() {
  section "1. Opposed affinities cancel by intensity; a lead of 2 overwhelms (#290, #289, #342)"
  say "One rule for every pair. The hero emits one side at intensity 3; a trap beside it" \
      "emits the other. Equal intensities cancel on the hero's tile, so the hero only" \
      "regenerates (HP 10 -> 14 in 4 turns). At intensity 5 the trap leads by 2: what is left" \
      "stops the regen of the vital it harms, and its hits (intensity squared) drain it fast."
  for trap in water wind decay corrode dark; do
    hero=$(opposite "$trap")
    for intensity in 3 5; do
      dir="$WORK/pair-$trap-$intensity"
      pair_level "$hero" "$trap" "$intensity" "$dir"
      end_session
      session start --dir "$dir" >/dev/null
      printf '%-8s x3 vs %-8s x%s  after 4 turns: ' "$hero" "$trap" "$intensity"
      session act --keys "...." | pick 'r.hud.replace(/^D1 hero-1 · /, "").replace(/ · tick.*$/, "").replace(/(\d+\.\d)\d+/g, "$1")'
      end_session
    done
  done
  say "" "Each pair is shown with the harming side as the trap; swap them and the same" \
      "numbers come out (a restoring side that overwhelms doubles regen instead)."
}

blind() {
  section "2. Blinding dark: a net intensity 2 of dark on your tile cuts sight to your own tile (#284, #342)"
  pair_level light dark 3 "$WORK/blind-3"
  pair_level light dark 5 "$WORK/blind-5"
  for intensity in 3 5; do
    end_session
    session start --dir "$WORK/blind-$intensity" >/dev/null
    step "hero light x3 vs dark trap x$intensity (intensity), after 2 turns"
    session act --keys ".." | board
    end_session
  done
}

corrode() {
  section "3. Corrode eats armour first, then spills into health (#285)"
  say "Durability is armour; an actor is defeated at health 0, not durability 0."
  create --budget-tokens 2500 --out-dir "$WORK/corrode" --room "size=medium;count=1" \
    --delver "count=1;id=hero;motivation=user_controlled;vitals=health:20:1,mana:10:1,stamina:10:1,durability:10:1" \
    --hazard "x=3;y=3;affinity=corrode;expression=emit;stacks=3;intensity=2;vitals=mana:60:10,durability:10:1"
  end_session
  session start --dir "$WORK/corrode" | hud
  for _ in 1 2 3 4 5 6 7; do session act --keys "." | hud; done
  end_session
}

stamina() {
  section "4. Stamina recovers only on turns without a move (#273)"
  create --budget-tokens 2500 --out-dir "$WORK/stamina" --room "size=large;count=1" \
    --delver "count=1;id=hero;affinity=earth;motivation=user_controlled;vitals=health:10:1,mana:10:1,stamina:10:1,durability:10:1"
  end_session
  session start --dir "$WORK/stamina" >/dev/null
  for key in a a a w w . . .; do
    case $key in .) label="wait";; *) label="move";; esac
    printf '%-5s ' "$label"; session act --keys "$key" | pick 'r.hud.match(/ST [^ ]+/)[0]'
  done
  end_session
}

rename() {
  section "5. life is now growth, everywhere, with no alias (#285)"
  step "ak create --delver \"...;affinity=life\""
  $AK create --out-dir "$WORK/life" --room "size=small;count=1" \
    --delver "count=1;affinity=life;motivation=user_controlled" 2>/dev/null | pick 'r.error' || true
  step "ak create --delver \"...;affinity=growth\""
  $AK create --out-dir "$WORK/growth" --room "size=small;count=1" \
    --delver "count=1;affinity=growth;motivation=user_controlled" | pick '"ok, priced " + r.cost.totalSpend + " of " + r.cost.budgetTokens'
}

regen() {
  section "6. The Allocator flags regen bought above a vital's max (#285)"
  say "Health max 10 with regen 15: regen never fills past max, so 5 of it is wasted."
  $AK create --out-dir "$WORK/regen" --room "size=small;count=1" \
    --delver "count=1;affinity=fortify;motivation=user_controlled;vitals=health:10:15,mana:10:1,stamina:10:1,durability:10:1" \
    | pick 'r.cost.wastedRegen'
}

motivations() {
  section "7. Play views name each actor's motivation stack (#310)"
  create --budget-tokens 8000 --out-dir "$WORK/party" --room "size=medium;count=1" \
    --delver "count=1;id=hero;affinity=wind;motivation=user_controlled;vitals=health:10:1,mana:10:1,stamina:10:1,durability:10:1" \
    --delver "count=1;id=pal;affinity=earth;motivation=exploring+goal_oriented;vitals=health:10:1,mana:10:1,stamina:10:1,durability:10:1" \
    --warden "count=1;id=guard;affinity=fire;motivation=stationary"
  step "ak play --no-fog: the In sight line"
  $AK play --dir "$WORK/party" --no-fog --no-color --keys . | grep '^In sight'
  step "play-session start, with fog: inSight[].motivations (what /game-play reads)"
  end_session
  session start --dir "$WORK/party" | pick 'r.inSight.map((a) => a.label + " " + a.motivations.join("+")).join("  ")'
  end_session
}

pricing() {
  section "8. No parallel paths: every level is priced by the Allocator (#275)"

  step "ak build --spec with no budget gets the Allocator's 2,500 reference budget (#293)"
  quiet $AK build --spec tests/fixtures/artifacts/build-spec-v1-configurator.json --out-dir "$WORK/build"
  json "$WORK/build/budget-receipt.json" '"receipt " + r.status + ": " + r.totalCost + " spent, " + r.remaining + " left"'
  json "$WORK/build/sim-config.json" '"sim-config names it: " + r.budgetReceiptRef.id'

  step "ak configurator with no --budget prices too, and writes price-list.json (#293)"
  quiet $AK configurator --level-gen tests/fixtures/configurator/level-gen-input-v1-hazard.json \
    --actors tests/fixtures/configurator/actors-v1-affinity-base.json --out-dir "$WORK/configurator"
  ls "$WORK/configurator" | tr '\n' ' '; echo
  json "$WORK/configurator/budget-receipt.json" '"receipt " + r.status + ": " + r.totalCost + " spent"'

  step "Every build is judged by the Configurator: inverted room sizes are refused (#280)"
  json tests/fixtures/artifacts/build-spec-v1-configurator.json \
    'JSON.stringify({ ...r, configurator: { ...r.configurator, inputs: { ...r.configurator.inputs,
      levelGen: { ...r.configurator.inputs.levelGen, shape: { roomCount: 1, roomMinSize: 4, roomMaxSize: 3, corridorWidth: 1 } } } } })' \
    > "$WORK/inverted-spec.json"
  $AK build --spec "$WORK/inverted-spec.json" --out-dir "$WORK/inverted" 2>/dev/null | pick '"refused: " + r.error' || true

  step "The budget fill stays inside the budget it fills (#306; was denied at -138/-125/-85)"
  for pair in 1000:fire 2500:decay 5000:fortify; do
    budget=${pair%%:*}; kind=${pair#*:}
    printf 'delver-plan, 2 %-7s delvers, budget %-5s ' "$kind" "$budget"
    $AK delver-plan --delver "count=2;affinity=$kind;motivation=exploring" --budget-tokens "$budget" \
      --out-dir "$WORK/fill-$budget" 2>/dev/null | pick 'r.cost.status + ", spent " + r.cost.totalSpend + ", " + r.cost.remaining + " left"'
  done

  step "Hazards and resources are lines on the Allocator's receipt (#313, #330)"
  create --budget-tokens 3000 --out-dir "$WORK/objects" --room "size=medium;count=2" \
    --delver "count=1;id=hero;motivation=user_controlled" \
    --hazard "affinity=earth;expression=emit;proximityRadius=2" \
    --hazard "affinity=fortify;expression=emit;proximityRadius=1" \
    --resource "permanenceMode=consumable;vital=health;delta=5"
  json "$WORK/objects/budget-receipt.json" 'Object.entries(r.lineItems.reduce((by, line) => {
      const id = line.subjectRef?.id ?? line.id; by[id] = (by[id] ?? 0) + line.totalCost; return by; }, {}))
      .map(([id, cost]) => id + " " + cost).join(", ") + "  (total " + r.totalCost + ")"'

  step "A hand-written level still plays, and says it is unpriced (#279)"
  mkdir -p "$WORK/hand"
  cp "$WORK/party/initial-state.json" "$WORK/hand/"
  json "$WORK/party/sim-config.json" 'JSON.stringify({ ...r, budgetReceiptRef: undefined })' > "$WORK/hand/sim-config.json"
  $AK play --sim-config "$WORK/hand/sim-config.json" --initial-state "$WORK/hand/initial-state.json" --no-color --keys . 2>&1 | grep "^warning"

  step "ak run overrides of a built level are re-priced against its own budget (#278)"
  quiet $AK run --sim-config "$WORK/party/sim-config.json" --initial-state "$WORK/party/initial-state.json" --ticks 0 \
    --actor extra_1,4,4,delver --out-dir "$WORK/override"
  json "$WORK/party/budget-receipt.json" '"built level:      " + r.totalCost + " spent of " + (r.totalCost + r.remaining)'
  json "$WORK/override/budget-receipt.json" '"with --actor:     " + r.totalCost + " spent of " + (r.totalCost + r.remaining) + ", " + r.status'
  $AK run --sim-config "$WORK/party/sim-config.json" --initial-state "$WORK/party/initial-state.json" --ticks 0 \
    --vital hero-1,health,9000,9000,1 --out-dir "$WORK/overspend" 2>/dev/null \
    | pick '"health 9000 (over the 8000 budget) runs anyway, reported: " + r.pricingReport.map((f) => f.code).join(", ")'

  step "sandbox-create --budget writes a real Allocator receipt (#277)"
  quiet $AK sandbox-create --budget tests/fixtures/artifacts/budget-artifact-v1-basic.json --out-dir "$WORK/sandbox"
  json "$WORK/sandbox/budget-receipt.json" '"receipt " + r.status + ", " + r.totalCost + " for the room"'
  json "$WORK/sandbox/sandbox-session.json" '"session refs " + r.artifacts.budgetReceiptRef.id'

  step "Each persona stamps what it made: meta.producedBy on every artifact (#334)"
  for file in sim-config initial-state price-list spend-proposal budget-receipt; do
    json "$WORK/party/$file.json" '"'"$file"' ".padEnd(16) + r.meta.producedBy'
  done
}

solver() {
  section "9. Z3 in the decision stack (#295)"
  step "ak solve --question place-objects: the Configurator re-solves where a level's traps and caches go (#300)"
  $AK solve --dir "$WORK/objects" --question place-objects --out-dir "$WORK/solve-place" 2>/dev/null \
    | pick '"status " + r.status + ", source " + r.answer.source + ": " + r.answer.placements.map((p) => p.id + "@" + p.x + "," + p.y).join(" ")'
  step "ak solve --question budget-fit: which floor fits 50 tokens? (#300)"
  $AK solve --dir "$WORK/objects" --question budget-fit --budget-tokens 50 --out-dir "$WORK/solve-fit" 2>/dev/null \
    | pick '"status " + r.status + ": asked " + r.answer.requestedLayout.floorTiles + " tiles, fits " + r.answer.layout.floorTiles + ", " + r.answer.layoutSpend.remainingBudgetTokens + " left"'
  $AK solve --dir "$WORK/objects" --question budget-fit --budget-tokens 3000 --out-dir "$WORK/solve-fit-easy" 2>/dev/null \
    | pick '"with 3000 tokens: status " + r.status + " (" + r.reason + ")"'
  step "Z3 proves the opposed-pair rules for any stack count, and the solver-vs-fallback ledger (#305, #298)"
  pnpm run --silent test:vitest -- tests/core-ts/affinity-rule-proofs.test.mjs tests/tools/solver-ledger.test.mjs 2>&1 \
    | grep -E '✓|✗|×|Tests ' | sed 's/^ *//'
}

hygiene() {
  section "10. Determinism and clean-up (#322, #324, #318, #320)"
  step "Two runs with checkpoints at ticks 2 and 4 write identical checkpoint files (#322)"
  for n in 1 2; do
    quiet $AK run --sim-config "$WORK/party/sim-config.json" --initial-state "$WORK/party/initial-state.json" \
      --ticks 4 --world-state-checkpoints 2,4 --seed 7 --run-id ckpt --out-dir "$WORK/ckpt-$n"
  done
  (cd "$WORK" && $SHA256 ckpt-1/world-state-checkpoints/* ckpt-2/world-state-checkpoints/* | sed 's/^\(.\{16\}\)[^ ]*/\1…/')
  step "AffinitySummary is v2 with no attack/buff/area abilities; v1 presets still read (#324)"
  quiet $AK run --sim-config "$WORK/party/sim-config.json" --initial-state "$WORK/party/initial-state.json" --ticks 1 \
    --affinity-presets tests/fixtures/artifacts/affinity-presets-artifact-v1-basic.json \
    --affinity-loadouts tests/fixtures/artifacts/actor-loadouts-artifact-v1-basic.json \
    --affinity-summary "$WORK/summary/affinity-summary.json" --out-dir "$WORK/summary"
  json "$WORK/summary/affinity-summary.json" 'r.schema + " v" + r.schemaVersion + ", abilities present: " + JSON.stringify(r).includes("abilities")'
  step "The lookahead ledger measures again (no lateral livelock) and recipes detect (#318, #320)"
  pnpm run --silent test:vitest -- tests/scripts/logic-lookahead-ledger.test.mjs tests/scripts/test-recipe-detection.test.mjs 2>&1 \
    | grep -E '✓|✗|×|Tests ' | sed 's/^ *//'
}

orders() {
  section "11. Game commands: a party, free seat switches and standing orders (#267-#270)"
  say "Every command here is ak play-session; the ak_play_* MCP tools take the same arguments."
  create --budget-tokens 12000 --out-dir "$WORK/orders" --room "size=medium;count=2" \
    --delver "count=1;id=hero;affinity=wind;motivation=user_controlled;vitals=health:10:1,mana:10:1,stamina:10:1,durability:10:1" \
    --delver "count=1;id=scout;affinity=earth;motivation=user_controlled;vitals=health:10:1,mana:10:1,stamina:10:1,durability:10:1" \
    --delver "count=1;id=pal;affinity=fire;motivation=goal_oriented;strategy=follow:hero-1:2;vitals=health:10:1,mana:10:1,stamina:10:1,durability:10:1"
  local orders='(r.orders ?? []).map((o) => o.label + " " + o.doing.kind + " " + o.status).join(", ")'
  local turns='r.turns + (r.turns === 1 ? " turn" : " turns")'
  end_session

  step "start: two party members you can seat; a companion already following the hero"
  session start --dir "$WORK/orders" | pick '"party: " + r.party.map((p) => p.label + " " + p.id).join(", ")
    + "; in sight: " + r.inSight.map((a) => a.label + " " + a.motivations.join("+")).join(", ")'
  step "switch seats is free: no turn passes"
  session switch --actor D3 | pick "\"seated \" + r.active + \", \" + $turns"
  session switch --actor D1 | pick "\"seated \" + r.active + \", \" + $turns"

  step "order: giving one is a turn (the seated actor's and the ordered actor's)"
  session order --actor D3 --strategy reach:exit | pick "$turns + \"; orders: \" + $orders"
  step "A malformed strategy is refused, and no turn passes"
  session order --actor D2 --strategy dance:1 2>&1 | head -1 || true
  step "The seated hero can take orders too: the companion leads, the hero follows (#338)"
  session order --actor D2 --strategy lead:D1:2 >/dev/null
  session order --actor D1 --strategy follow:D2:1 | pick "$turns + \"; orders: \" + $orders"

  step "advance --until orders_done: the companion leads the hero to the exit and leaves; the follow ends there"
  session advance --until orders_done | pick '"stopped by " + r.results[0].stoppedBy + " after " + r.results[0].ticks + " ticks; "
    + r.party.map((p) => p.label + (p.status.exited ? " exited" : p.status.atExit ? " at the exit" : " in play")).join(", ")'
  session view | pick "\"orders: \" + $orders"
  session view --save "$WORK/orders-game.json" | pick '"saved a copy: " + (r.saved ? "yes" : "no")'
  end_session

  step "Orders go to your own side only: a warden answers not_yours"
  session start --dir "$WORK/party" >/dev/null
  session order --actor W1 --strategy survive | pick 'r.results[0].reason'
  end_session
}

ALL=(rules blind corrode stamina rename regen motivations pricing solver hygiene orders)
# bash 3.2 (macOS) treats an empty array as unbound under set -u, so never expand one.
if [ $# -eq 0 ]; then SECTIONS=("${ALL[@]}"); else SECTIONS=("$@"); fi
for name in "${SECTIONS[@]}"; do
  case " ${ALL[*]} " in *" $name "*) ;; *) echo "unknown section: $name (one of: ${ALL[*]})" >&2; exit 2;; esac
  # pricing, solver and hygiene reuse levels the earlier sections build.
  case $name in
    pricing|hygiene|orders) [ -d "$WORK/party" ] || motivations >/dev/null ;;
    solver) [ -d "$WORK/objects" ] || pricing >/dev/null ;;
  esac
  "$name"
done
end_session
printf '\nDone. Play it yourself: node packages/adapters-cli/src/cli/ak.mjs play --level first-steps\n'
