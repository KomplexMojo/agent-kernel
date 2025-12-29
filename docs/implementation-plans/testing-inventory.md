# Testing Inventory

Source of truth for test coverage targets in the Tests-and-MVP plan.
Status tags reflect coverage status and should be updated as tests land.

## Adapters (Web)
- [pending] dom-log logger — packages/adapters-web/src/adapters/dom-log.js
- [pending] solver-wasm — packages/adapters-web/src/adapters/solver-wasm.js
- [pending] ipfs — packages/adapters-web/src/adapters/ipfs/index.js
- [pending] blockchain — packages/adapters-web/src/adapters/blockchain/index.js
- [pending] ollama — packages/adapters-web/src/adapters/ollama/index.js

## Adapters (CLI)
- [pending] solver-wasm — packages/adapters-cli/src/adapters/solver-wasm.js
- [pending] ipfs — packages/adapters-cli/src/adapters/ipfs/index.js
- [pending] blockchain — packages/adapters-cli/src/adapters/blockchain/index.js
- [pending] ollama — packages/adapters-cli/src/adapters/ollama/index.js

## Adapters (Test)
- [pending] ipfs — packages/adapters-test/src/adapters/ipfs/index.js
- [pending] blockchain — packages/adapters-test/src/adapters/blockchain/index.js
- [pending] ollama — packages/adapters-test/src/adapters/ollama/index.js

## Runtime Entrypoints
- [pending] createRuntime — packages/runtime/src/runner/runtime.js
- [pending] applyBudgetCaps — packages/runtime/src/ports/budget.js
- [pending] solveWithAdapter — packages/runtime/src/ports/solver.js
- [pending] dispatchEffect, EffectKind — packages/runtime/src/ports/effects.js
- [pending] BUDGET_CATEGORY_IDS, resolveBudgetCategoryId — packages/runtime/src/contracts/budget-categories.js
- [pending] runtime export surface — packages/runtime/src/index.js

## Bindings Entrypoints
- [pending] loadCore — packages/bindings-ts/src/index.js
- [pending] core exports surface — packages/bindings-ts/src/core-as.js (init/step/applyAction/getCounter/setBudget/getBudget/getBudgetUsage/effect helpers/version)
