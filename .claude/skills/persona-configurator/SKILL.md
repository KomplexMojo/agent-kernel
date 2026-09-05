---
name: persona-configurator
description: Use when changing Configurator SimConfig assembly, level/actor/card authoring, feasibility, validation, or config locking. Do not use for pricing/receipts (Allocator), planning (Director), tick execution (Moderator), or core rule legality (core-ts).
---

# Persona: Configurator

Scoped change skill for the **simulation configuration and composition persona**. Load this instead of sweeping the whole app when the work belongs to Configurator.

## Use when / Do not use when

**Use when** the change builds, validates, or locks executable configuration — levels, layouts, actors, cards, motivations, affinity loadouts, feasibility, or ConfigurationCandidates for the Allocator to price.

**Do not use when** the change is pricing/spend/receipts (Allocator), intent→plan (Director), LLM hosting (Orchestrator), action proposals at tick time (Actor), tick ordering (Moderator), telemetry (Annotator), or deterministic rule outcomes (`core-ts`).

## Allowed edit surfaces

- `packages/runtime/src/personas/configurator/` (controller, state-machine, persona, contracts, helpers)
- Behavior tests: `tests/personas/configurator/configurator-<behavior>.test.*`
- Related architecture proofs already chartered here: `tests/architecture/configurator-*-authority.test.js`

## Forbidden

- Importing Configurator internals from outside this directory — outside callers use only `controller.js` / `persona.js` / `contracts.ts`.
- Judging budgets or declaring token costs (Allocator owns pricing; Configurator authors, Allocator judges).
- Silent cost fallbacks or private price tables.
- Running ticks, resolving affinities as Moderator, or mutating live sim state.
- Executing effects inline; non-serializable context; direct clock reads.
- Moving authoring into CLI/adapters (`adapters-cli-no-actor-authoring` and related guards).

## Workflow

1. Confirm ownership in `packages/runtime/src/personas/configurator/README.md`.
2. Add a failing behavior test under `tests/personas/configurator/`.
3. Implement inside the Configurator directory as a pure FSM; keep states behavior-gating (no label-only states).
4. Hand priced decisions to Allocator via artifacts — do not embed spend verdicts here.
5. Update the Configurator README in the same diff if ownership or public surface changed.

## Validation

```bash
pnpm run test:vitest -- tests/personas/configurator/
pnpm run test:vitest -- tests/architecture/persona-boundary.test.js tests/architecture/configurator-actors-authority.test.js tests/architecture/configurator-cards-authority.test.js tests/architecture/pricing-authority.test.js
pnpm run typecheck   # if contracts.ts or typed surfaces changed
```

## Escalate

Stop when authoring vs pricing ownership blurs, placement rules belong in `core-ts` instead, schemas must evolve, or charter/diagram changes are required.

## Pointers

- README: `packages/runtime/src/personas/configurator/README.md`
- Controller / FSM: `controller.js`, `state-machine.js`, `persona.js`, `contracts.ts`
- Allocator handoff: ConfigurationCandidate / budget receipt artifacts in `packages/runtime/src/contracts/artifacts.ts`
- Charter: `docs/architecture-charter.md`
