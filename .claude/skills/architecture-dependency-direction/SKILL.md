---
name: architecture-dependency-direction
description: Use when changing package layering, imports across core-ts / runtime / adapters / ui-web, or fixing dependency-direction and ports-and-adapters boundary violations. Do not use for persona domain behavior (use persona-* skills) or adapter IO implementation details alone (use architecture-adapter-io).
---

# Architecture: Dependency direction

Scoped change skill for **ports & adapters layering**. Load this when the work is about which package may import which — not a full-app sweep of domain logic.

## Use when / Do not use when

**Use when** the change moves code between layers, fixes illegal imports, keeps `core-ts` free of IO/clock/env/random, or adjusts runtime so it does not own adapter/UI concerns.

**Do not use when** the change is persona FSM behavior (use the matching `persona-*` skill), effect dispatch mechanics alone (`architecture-effects-routing`), schema evolution alone (`architecture-artifacts-contracts`), or writing a new LLM/IPFS/chain/solver adapter (`architecture-adapter-io`).

## Allowed edit surfaces

- `packages/core-ts/` — pure deterministic rules only
- `packages/runtime/` — personas, ports, runner, contracts (no adapter package imports)
- `packages/adapters-cli/`, `packages/adapters-web/`, `packages/adapters-test/` — IO only, may depend on runtime
- `packages/ui-web/` — presentation; may depend on runtime/adapters, not on inventing sim rules
- Guards: `tests/architecture/dependency-direction.test.js`, `tests/architecture/ports-and-adapters-boundary.test.js`, `tests/architecture/core-behavior-wiring.test.js`

## Forbidden

- IO, `Date`, env, filesystem, network, or non-deterministic randomness in `core-ts`.
- `runtime` or `core-ts` importing `adapters-*` or `ui-web`.
- Domain decisions (pricing, planning, config authoring, action choice) living in adapters or UI.
- Widening the typecheck gate casually; drive-by cleanup outside the scoped layering fix.
- Charter/diagram edits without maintainer sign-off.

## Workflow

1. Name the owning layer: pure rule → `core-ts`; persona decision → runtime persona dir; IO → adapters; presentation → `ui-web`.
2. If a persona owns the behavior, switch to that `persona-*` skill and keep this skill only for import/boundary cleanup.
3. Move or delete the illegal dependency; prefer extracting a port over leaking adapters upward.
4. Add/adjust the narrow architecture guard if the violation class is new.
5. Update descriptive package README only if the public boundary story changed; charter/diagram only with sign-off.

## Validation

```bash
pnpm run test:vitest -- tests/architecture/dependency-direction.test.js tests/architecture/ports-and-adapters-boundary.test.js tests/architecture/core-behavior-wiring.test.js
pnpm run typecheck
```

## Escalate

Stop when the correct layer is ambiguous, a new port shape is required across packages, or `docs/architecture-charter.md` / `docs/architecture/diagram.mmd` must change.

## Pointers

- Law: `docs/architecture-charter.md`, `docs/architecture/diagram.mmd`
- Agent checklist: `CLAUDE.md` → Architecture / Enforcement
- Rule mirror: `.cursor/rules/enforcement.mdc`
