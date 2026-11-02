# Playability checklist

Run this on any change that alters what a player sees, chooses, or is told. It is a review aid, not a
gate: answer each line in the PR's change report ([pr-gameplay-change-report.md](pr-gameplay-change-report.md)),
and say "not touched" when a line does not apply. The order follows a turn: understand, decide, commit,
learn, return to play.

## Understand

- **Goal (S1).** Can the player tell what they are trying to do now and on this floor? Goals shown come
  from the actor's real motivations, never a parallel list. No hidden information leaks through the text (fog, #497).
- **State.** Does every number the player acts on (vitals, regen, price) appear where they choose, with
  its unit and what they hold?

## Decide

- **No dominant choice (S2).** In some situation a different cast or move beats the usual one. A change
  that makes one option best everywhere needs a board where it loses.
- **Roles of vitals (S5).** Each vital still answers a different question (what it buys, what spends it,
  what restores it). A new way to recover must not make waiting the answer to everything.
- **Demand variety (S7).** The scenarios still include moments that reward different responses: keeping
  range, taking an optional risk, recovering.

## Commit

- **Cost before commitment (S3).** A refusal or a prompt names the price and what the player has
  (`costs 48, you have 47`). Prices shown are the Allocator's, never restated in the UI.
- **No retroactive warnings (S4).** The game never explains a rule only after the player has broken it,
  and never invents a warning the rules do not back.

## Learn

- **Informative failure (S8).** A defeat says, in one sentence, what did it, from telemetry the player
  could have known. Nothing the player cannot see is named.

## Return to play

- **Re-entry.** After a defeat, refusal, or menu, the next key puts the player back on the board with
  nothing armed, selected or half-open (a spent cast leaves no slot highlighted).
- **Evidence.** A human check on the phone or terminal for the changed path, plus a headless oracle where
  one can exist (sweep rule or metric, play-sim run). Balance numbers are metrics, not gates.

## Running the LLM-driven simulations (play-sim)

Model-driven runs use the same path as the benchmarks (AGENTS.md, Benchmark strategy): the Mac keeps the repo and results, the darren-llm box does the inference, and `remote-ollama-mac run-local` opens the tunnel and exports `OLLAMA_HOST` and `OLLAMA_MODEL` to the command it wraps. The play-sim scripts read those two variables; `--model` and `--ollama-url` override them. `--provider anthropic` swaps Ollama for the Anthropic API instead: it reads `ANTHROPIC_API_KEY` from the environment (never a flag, never logged), needs `--model` (for example `claude-haiku-5-5`), and works with `--driver seat`, `--driver t1-contact` and `--build-source llm`. Commands are logged, so a played game replays with no model call. A model run is a probe: its `summary.json` records `matrix: "local-unversioned"` and the model, and it never gates anything.

```bash
bash scripts/benchmark-preflight.sh --remote          # first: empty model store, empty ssh-agent and stale pins fail silently
cd tools/remote-ollama-control
./bin/remote-ollama-mac run-local --route auto --profile dual --model <model> -- \
  node ../../scripts/testing/play-sim.mjs --driver seat --scenarios first-look --seeds 0   # a model plays the whole level
./bin/remote-ollama-mac run-local --route auto --profile dual --model <model> -- \
  node ../../scripts/testing/play-sim.mjs --driver t1-contact --scenarios duel --seeds 0   # a model plays contact bursts
./bin/remote-ollama-mac run-local --route auto --profile dual --model <model> -- \
  node ../../scripts/testing/play-sim.mjs --build-source llm --scenarios first-look --seeds 0   # a model builds the character
./bin/remote-ollama-mac run-local --route auto --profile dual --model <model> -- \
  node ../../scripts/testing/play-sim-advisor.mjs --in ../../artifacts/play-sim/<run-id>        # advice over a run's cards
```

On the Mac's own Ollama, put `--local` after `run-local` and drop `--route` and `--profile`. Results land in `artifacts/play-sim/<run-id>` (gitignored).
