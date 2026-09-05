---
name: persona-allocator
description: Use when changing Allocator pricing, base-costs, spend validation, budget maximization, receipts, or reconciliation. Do not use for SimConfig authoring (Configurator), planning (Director), sim mutation (core-ts), or adapter-side cost tables.
---

# Persona: Allocator

Scoped change skill for the **budgeting and resource-policy persona**. Load this instead of sweeping the whole app when the work belongs to Allocator.

## Use when / Do not use when

**Use when** the change touches price lists, `base-costs.json`, spend proposals, approval/rejection, budget maximization against Allocator prices, receipts, or reconciliation of actual spend.

**Do not use when** the change authors levels/actors/cards (Configurator), translates intent (Director), hosts LLM IO (Orchestrator), proposes tick actions (Actor), orders ticks (Moderator), records telemetry (Annotator), or mutates simulation state / legality (`core-ts`).

## Allowed edit surfaces

- `packages/runtime/src/personas/allocator/` (controller, state-machine, persona, contracts, helpers, cost sources owned here)
- Behavior tests: `tests/personas/allocator/allocator-<behavior>.test.*`
- Related architecture proofs: `tests/architecture/allocator-*-authority.test.js`, `tests/architecture/pricing-authority.test.js`, `tests/architecture/single-origin.test.js`

## Forbidden

- Importing Allocator internals from outside this directory — outside callers use only `controller.js` / `persona.js` / `contracts.ts`.
- A second price table anywhere in the tree (including silent `1` fallbacks) — single origin only.
- Authoring SimConfig or inventing Actor scoring inside Allocator.
- Mutating simulation state or enforcing action legality (that is `core-ts`).
- Executing effects inline; non-serializable context; direct clock reads.
- Adapter or glue policy that substitutes for Allocator receipts.

## Workflow

1. Confirm ownership in `packages/runtime/src/personas/allocator/README.md` (Owns / Does not own, A1–A5). Treat A1 sole-implementation risks seriously — census guards catch duplicate prices that output tests miss.
2. Add a failing behavior or authority test under the Allocator test trees above.
3. Implement inside the Allocator directory as a pure FSM; refuse unpriced inputs by naming the missing key rather than defaulting.
4. Keep Configurator as author and Allocator as judge — inject Configurator/Director capabilities; do not re-implement them.
5. Update the Allocator README in the same diff if ownership or public surface changed.

## Validation

```bash
pnpm run test:vitest -- tests/personas/allocator/
pnpm run test:vitest -- tests/architecture/pricing-authority.test.js tests/architecture/single-origin.test.js tests/architecture/allocator-base-costs-authority.test.js tests/architecture/allocator-receipt-authority.test.js
pnpm run typecheck   # if contracts.ts or typed surfaces changed
```

## Escalate

Stop when a new cost domain appears outside Allocator, receipt gating moves into glue without an authority proof, schemas must change, or charter/diagram edits are required.

## Pointers

- README: `packages/runtime/src/personas/allocator/README.md`
- Controller / FSM: `controller.js`, `state-machine.js`, `persona.js`, `contracts.ts`
- Charter pricing rules: `docs/architecture-charter.md`
- Effects port: `packages/runtime/src/ports/effects.js`
