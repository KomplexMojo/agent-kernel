---
name: persona-moderator
description: Use when changing Moderator tick ordering, phase control, affinity resolution policy, pause gating, or effect-fulfillment dispositions. Do not use for strategy/planning, config assembly, adapter IO execution, or core rule legality.
---

# Persona: Moderator

Scoped change skill for the **execution and sequencing persona**. Load this instead of sweeping the whole app when the work belongs to Moderator.

## Use when / Do not use when

**Use when** the change advances ticks, defines phase/action order, plans effect-fulfillment dispositions (deterministic / defer / dispatch), resolves affinity interaction policy at tick time, or pause-gates execution.

**Do not use when** the change is strategy/planning (Director), config assembly (Configurator), pricing (Allocator), action proposal content (Actor), telemetry formatting (Annotator), external IO implementation (adapters), or rule legality/mutation (`core-ts`).

## Allowed edit surfaces

- `packages/runtime/src/personas/moderator/` (controller, state-machine, persona, contracts, helpers)
- Behavior tests: `tests/personas/moderator/moderator-<behavior>.test.*`
- Coordination with ports when disposition shapes change: `packages/runtime/src/ports/effects.js` (policy stays in Moderator; dispatch stays in ports)

## Forbidden

- Importing Moderator internals from outside this directory — outside callers use only `controller.js` / `persona.js` / `contracts.ts`.
- Performing LLM/IPFS/chain/solver IO inside Moderator — plan fulfillment; do not execute adapters here.
- Replacing `core-ts` rule enforcement or inventing strategy/config/pricing domain logic.
- Lateral imports of other personas’ internals.
- Non-serializable context or a directly read clock.
- Label-only FSM states that do not gate real behavior.

## Workflow

1. Confirm ownership in `packages/runtime/src/personas/moderator/README.md`.
2. Add a failing behavior test under `tests/personas/moderator/`.
3. Implement inside the Moderator directory as a pure FSM; keep fulfillment **policy** separate from `dispatchEffect` execution.
4. Cross boundaries with artifacts/events/effects only.
5. Update the Moderator README in the same diff if ownership or public surface changed.

## Validation

```bash
pnpm run test:vitest -- tests/personas/moderator/
pnpm run test:vitest -- tests/architecture/persona-boundary.test.js tests/architecture/ports-and-adapters-boundary.test.js
pnpm run typecheck   # if contracts.ts or typed surfaces changed
```

## Escalate

Stop when tick policy vs adapter execution ownership blurs, runner/glue would gain domain rules, schemas must change, or charter/diagram edits are required.

## Pointers

- README: `packages/runtime/src/personas/moderator/README.md`
- Controller / FSM: `controller.js`, `state-machine.js`, `persona.js`, `contracts.ts`
- Effects dispatch: `packages/runtime/src/ports/effects.js`
- Runner: `packages/runtime/src/runner/runtime-fsm.mjs`
