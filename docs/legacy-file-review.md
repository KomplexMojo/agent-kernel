# Legacy File Review

Review scope: tracked files in `/Users/darren/Documents/GitHub/agent-kernel` that look temporary, generated, duplicated, or debug-oriented and are not needed by the application runtime.

## Baseline

- `git pull --ff-only`: already up to date on `main`.
- `pnpm install --frozen-lockfile`: lockfile satisfied.
- `pnpm run test`: passed, 280 files, 1852 tests, 8 skipped.
- `bash scripts/setup/agent-context.sh`: refreshed CodeContext and Graphify.
- `mcp__codegraphcontext.watch_directory`: live watching enabled.

CodeContextGraph checks used:

- `get_repository_stats`: 286 indexed files, 3038 functions, 221 modules.
- `find_most_complex_functions`: orientation only; no cleanup target found from complexity.
- `execute_cypher_query` for `packages/runtime/src/packages/runtime/src/**`: 18 files, all with 0 importers.
- `find_code("packages/runtime/src/packages/runtime/src")`: no source content matches.

For binary/generated files, the graph does not model enough content to prove references, so exact `git grep` checks were used for literal path/name references.

## Archive-Now Candidates

These 81 tracked files are high-confidence archive candidates. They are generated, ignored, duplicated, or debug artifacts, and no application entry point depends on them.

| Bucket | Files | Evidence |
|---|---:|---|
| `.playwright-cli/**` | 46 | Timestamped Playwright CLI logs/YAML/page captures/screenshots. Also already ignored by `.gitignore`; tracked copies are legacy. Exact references only mention the tool name, not these artifacts. |
| `packages/adapters-cli/artifacts/solve_cli_test/*.json` | 2 | CLI-generated solver artifacts. Already ignored by `.gitignore`; no source/test reference to this directory except the ignore rule. |
| `packages/runtime/src/packages/runtime/src/personas/**` | 18 | Accidental nested duplicate source tree from early scaffolding. CodeContextGraph reports 0 importers for every file; exact refs only appear in generated Graphify/upload manifests. Canonical persona code lives under `packages/runtime/src/personas/**`. |
| Root gameplay/design screenshots | 12 | `design-*.png`, `final-gameplay.png`, `live-run-board.png`, `sandbox-*.png`, `stepped-*.png`. Added as debug/review artifacts; no exact references in docs, scripts, tests, or source. |
| Upload helper/output | 2 | `tmp_script.sh` and `uploadable-files.txt` are a one-off staging/upload helper plus generated output, not wired into package scripts. |
| `graphify-out/memory/query_20260413_220216_what_connects_moveaction__solver_z3_adapter__repla.md` | 1 | Generated Graphify memory query. It references removed `core-as` paths and is not application input. |

## Policy-Review Candidates

These are not needed by the application, but they may support repo workflow, agent context, or asset review. The script can include them with explicit flags.

| Bucket | Files | Notes |
|---|---:|---|
| `graphify-out/.graphify_python`, `GRAPH_REPORT.md`, `cost.json`, `manifest.json` | 4 | Generated agent-context output. `scripts/setup/agent-context.sh` regenerates this and mirrors it under `~/vault/codex-context/...`; keep in main only if branch-local graph snapshots are intentionally versioned. |
| `packages/runtime/src/render/visual-assets/actor-medallions/review/*.png` | 5 | Generated visual QA contact sheets. They are not imported by app code, but they are listed in `actor-medallion-generated-assets.json` and produced by `tools/visual-assets/generate-actor-medallion-assets.mts`. |

## Not In Main

These local outputs exist in the working tree but are ignored and not tracked in `main`, so they are not included in the archive script: `coverage/`, `test-results/`, `test-gen.log`, `test-gen-report.md`, `mcp.json`, `.DS_Store`, and `artifacts/`.

## Archive Script

Use `scripts/archive-legacy-files.sh`.

- Dry run: `bash scripts/archive-legacy-files.sh`
- Archive and remove default candidates: `bash scripts/archive-legacy-files.sh --apply`
- Include generated Graphify context: `bash scripts/archive-legacy-files.sh --apply --include-agent-context`
- Include visual review sheets: `bash scripts/archive-legacy-files.sh --apply --include-review-assets`

The script copies files to `../agent-kernel-legacy-archive/<timestamp>/` first, writes a manifest, then removes tracked paths with `git rm`. It refuses to remove modified candidates unless `--allow-modified` is passed.

After applying the archive, rerun `bash scripts/setup/agent-context.sh` if any `graphify-out` files remain tracked, then run `pnpm run test` before committing.
