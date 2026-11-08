# Dungeon-master seat: prototype (#681, 2026-11-08)

A model plays the dungeon's side. Every few ticks it sets standing orders for the level's `ai_controlled` wardens and hazards. The Actor plays every move in between, and the delver is the autonomous Actor. The prototype exists to see whether a master changes outcomes at all before anyone builds on it. It runs locally only and is never a merge gate.

The driver is `scripts/testing/play-sim-dungeon-master.mjs`, and its tests are in `tests/scripts/play-sim-dungeon-master.test.mjs`. The tests use a fake master; no test calls a model.

## Assumptions

Change any of these on request.

- **What the master may do.** It only orders actors that already exist and are `ai_controlled`. It never spawns anything, moves a hazard, or re-equips an actor. An order is a strategy, with the same goals `agon_play_order` takes, and the Actor carries it out. Orders to anyone else are refused and counted.
- **Cadence and budget.** One master call every 5 ticks (`--cadence`), and at most 12 calls a run (`--budget`). An order costs a tick, as it does for a player: the seat gives the order and the ordered actor takes it. Leaving an actor out keeps its current order and costs nothing.
- **What the master sees.** For each of its living actors, it gets that actor's seat: the fogged screen, the HUD line, who is in its sight (label, role and position only), and its current order. It gets no exit position, no one else's vitals, and nothing its actors have not seen. The harness reads the true state only to score the run.

## Score

The score is the delver's, using the same `scoreRun` as the tactic benefit gate (#674). It is reported per run and never collapsed into one number:

- token value acquired, priced by the Allocator;
- non-renewable use (vitals with regen 0, and defeat);
- for each vital, the turns spent under 50% and under 25%, and whether the delver reacted at 25%;
- warden and hazard kills;
- turns, recorded only.

## Fake-provider runs

These levels came from `agon create`:
- three medium rooms;
- one exploring, goal-oriented delver with a fire push of range 2 and health regen 0;
- two `ai_controlled` exploring wardens with a decay push of range 2;
- one permanent mana resource.

The levels were built with seeds 1 to 3. "No orders" is a master that never orders anything. The "fake master" orders any warden that sees the delver to defeat it.

| Seed | Master | Ended | Token value | Non-renewable | Under 50% / 25% | Kills (W/H) | Turns | Calls |
|---|---|---|---|---|---|---|---|---|
| 1 | no orders | delver exited | 0 | 0 | none | 0/0 | 26 | 6 (0 orders) |
| 1 | fake master | delver exited | 0 | 0 | none | 0/0 | 26 | 6 (1 order) |
| 2 | no orders | delver exited | 0 | 0 | none | 0/0 | 28 | 6 (0 orders) |
| 2 | fake master | delver exited | 0 | 0 | none | 0/0 | 28 | 6 (2 orders) |
| 3 | no orders | delver exited | 0 | 0 | none | 0/0 | 34 | 7 (0 orders) |
| 3 | fake master | delver exited | 0 | 0 | none | 0/0 | 34 | 7 (2 orders) |

On these boards a master that only reacts to sightings changes nothing. Each delver walked to the exit before any warden ordered after it could close the distance. To be worth anything, a master has to place its actors before contact, for example guarding the routes to the exit. That is the question a model run should answer.

## Running it with a model

```bash
node packages/adapters-cli/src/cli/agon.mjs create --seed 1 --room "size=medium;count=3" \
  --delver "count=1;id=hero;affinity=fire;motivation=exploring+goal_oriented;affinities=fire:push:2:1;vitals=health:20:0,mana:20:2,stamina:12:2,durability:5:0" \
  --warden "count=2;id=keeper;affinity=decay;motivation=ai_controlled+exploring+goal_oriented;affinities=decay:push:2:1" \
  --resource "permanenceMode=permanent;vital=mana;delta=3" --budget-tokens 8000 --out-dir /tmp/dm-seed1
# Ollama (OLLAMA_HOST / OLLAMA_MODEL, as under remote-ollama-mac run-local), or --provider anthropic with ANTHROPIC_API_KEY
node scripts/testing/play-sim-dungeon-master.mjs --level /tmp/dm-seed1 --model <id> --out /tmp/dm-seed1.json
```
