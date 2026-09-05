---
name: persona-actor
description: Use when changing Actor action proposals, observation/motivation decisioning, or runtime-decision request artifacts. Do not use for action legality or state mutation (core-ts), config authoring (Configurator), pricing (Allocator), or solver/adapter policy.
---

# Persona: Actor

Scoped change skill for the **action-proposal persona**. Load this instead of sweeping the whole app when the work belongs to Actor.

## Use when / Do not use when

**Use when** the change selects intent or proposes actions from observations, motivations, candidate actions, or runtime-decision context — including decision envelopes Actor owns.

**Do not use when** the change enforces legality or mutates world state (`core-ts`), authors actors/loadouts (Configurator), prices actions (Allocator), hosts LLM/solver IO (adapters + Orchestrator), orders ticks (Moderator), or records telemetry (Annotator).

## Allowed edit surfaces

- `packages/runtime/src/personas/actor/` (controller, state-machine, persona, contracts, helpers)
- Behavior tests: `tests/personas/actor/actor-<behavior>.test.*`
- Related architecture proofs: `tests/architecture/actor-runtime-decisioning-authority.test.js`, `tests/architecture/actor-adapter-policy-residue.test.js`

## Forbidden

- Importing Actor internals from outside this directory — outside callers use only `controller.js` / `persona.js` / `contracts.ts`.
- Putting Actor scoring, motivation defaults, or decision policy into adapters or CLI.
- Accepting/rejecting actions or mutating state inside Actor — proposals only; `core-ts` is authoritative for outcomes.
- Executing effects inline (including solver IO) — emit `solver_request` / effects as data for ports + adapters.
- Non-serializable context or a directly read clock.
- Pricing anywhere but Allocator.

## Workflow

1. Confirm ownership in `packages/runtime/src/personas/actor/README.md`.
2. Add a failing behavior test under `tests/personas/actor/`.
3. Implement inside the Actor directory as a pure FSM; keep proposals separate from core acceptance.
4. If solver involvement is required, author requests as data and leave resolve/IO to `packages/runtime/src/ports/solver.js` + adapters.
5. Update the Actor README in the same diff if ownership or public surface changed.

## Validation

```bash
pnpm run test:vitest -- tests/personas/actor/
pnpm run test:vitest -- tests/architecture/persona-boundary.test.js tests/architecture/actor-runtime-decisioning-authority.test.js tests/architecture/actor-adapter-policy-residue.test.js tests/architecture/adapters-cli-no-actor-authoring.test.js
pnpm run typecheck   # if contracts.ts or typed surfaces changed
```

## Escalate

Stop when proposal vs legality ownership is unclear, adapter policy residue would grow, schemas must change, or charter/diagram edits are required.

## Pointers

- README: `packages/runtime/src/personas/actor/README.md`
- Controller / FSM: `controller.js`, `state-machine.js`, `persona.js`, `contracts.ts`
- Solver port: `packages/runtime/src/ports/solver.js`
- Core outcomes: `packages/core-ts/`
