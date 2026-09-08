# Implementation runbook
Run commands from the cloud repository root. Read Handoff.md for cloud startup before this historical command record.
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
