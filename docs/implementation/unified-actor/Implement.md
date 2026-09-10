# Implementation runbook
Run commands from the existing isolated unified-actor worktree root. Read Handoff.md and Plan.md for current status; cloud startup notes are retained for portability.
Session refresh ran with --no-pull to preserve the approved base. Serena activated on this worktree and CodeContext regenerated. The maintainer authorized committing and pushing the UA.1/UA.2 cloud handoff. Future commits/pushes follow the active cloud task instructions.

Contract test discovery used ak_test_discover_patterns(suite=contracts). Its scaffoldable recipe tests runtime validators; UA.1 tests TypeScript declarations, so use a compiler-backed positive/negative fixture instead. The MCP tool server is attached to the original repo: do not use its mutating scaffold/run tools for this worktree. Use local pnpm commands with explicit cwd.

UA.1 command: pnpm run test:vitest -- tests/contracts/unified-actor-contract.test.js
Owner gates: pnpm run test:vitest -- tests/contracts/ tests/architecture/schema-declaration-origin.test.js tests/architecture/schema-catalog-coverage.test.js
Type gate: pnpm run typecheck
Final program gates: LLM_INTERNAL_HOST=192.0.2.10 pnpm run test; pnpm run typecheck; pnpm run test:vitest -- tests/architecture/
The documentation-only host is for dry-run tests; never execute remote benchmarks.


UA.2 commands (completed):
- pnpm run test:vitest -- tests/core-ts/ tests/contracts/unified-actor-contract.test.js
- pnpm run test:vitest -- tests/architecture/dependency-direction.test.js tests/architecture/ports-and-adapters-boundary.test.js tests/architecture/core-behavior-wiring.test.js tests/architecture/schema-declaration-origin.test.js tests/architecture/schema-catalog-coverage.test.js
- pnpm run typecheck
- Restored perturbation check: pnpm run test:vitest -- tests/core-ts/actor-registry.test.mts tests/contracts/unified-actor-contract.test.js


## Local continuation commands — 2026-09-08
The maintainer continued locally after the published checkpoint. Session refresh
ran with --no-pull and LLM_INTERNAL_HOST=192.0.2.10. All source edits are confined
to this worktree. No additional commit/push or remote benchmark was performed.

For each component (UA.3, UA.4a, UA.6a, UA.7a, UA.5a, UA.8a, UA.5b1):
1. Run its new tests to prove red before implementation.
2. Run pnpm run test:vitest -- tests/core-ts/ plus the dependency-direction,
   ports-and-adapters-boundary and core-behavior-wiring test files.
3. Run pnpm run typecheck.
4. Apply its documented perturbation, observe failures, restore original bytes.
5. Continue at the next bounded milestone after green validation.

Final local verification uses the three final program gates listed above.
See Documentation.md for exact measured counts and pending integration.


September 10 continuation added focused casts, shared ActorAction declarations,
serializable action windows, once-only field/regeneration phases and Configurator
preset normalization. Core gates and owner-specific Configurator gates were run
per milestone, with restored affordability/action/single-pulse/category-invariance
perturbations. Full-suite logs for this continuation use /tmp/unified-actor-sep10-*,
but the measured evidence is recorded portably in Documentation.md.
