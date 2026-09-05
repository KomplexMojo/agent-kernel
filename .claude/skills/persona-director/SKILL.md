---
name: persona-director
description: Use when changing Director intent translation, PlanArtifact / BuildSpec assembly, prompt plans, or planning constraints. Do not use for LLM IO hosting (Orchestrator), SimConfig authoring (Configurator), pricing (Allocator), or tick execution (Moderator/core-ts).
---

# Persona: Director

Scoped change skill for the **planning and intent-translation persona**. Load this instead of sweeping the whole app when the work belongs to Director.

## Use when / Do not use when

**Use when** the change turns goals/intent into structured plans, prompt contracts, directives, BuildSpec/PlanArtifact shaping, or pool/summary selection that Director owns.

**Do not use when** the change is adapter/LLM session hosting (Orchestrator), level/actor/card assembly or locking (Configurator), budgets/prices/receipts (Allocator), action proposals (Actor), tick sequencing (Moderator), telemetry (Annotator), or core legality/mutation (`core-ts`).

## Allowed edit surfaces

- `packages/runtime/src/personas/director/` (controller, state-machine, persona, contracts, helpers)
- Behavior tests: `tests/personas/director/director-<behavior>.test.*`

## Forbidden

- Importing Director internals from outside this directory — outside callers use only `controller.js` / `persona.js` / `contracts.ts`.
- Performing IO inside Director (LLM calls belong behind Orchestrator + adapters).
- Assembling or locking SimConfig, inventing prices, or mutating simulation state.
- Executing effects inline — return effects as data via `packages/runtime/src/ports/effects.js`.
- Non-serializable context or a directly read clock.
- Domain logic in glue that duplicates Director planning.

## Workflow

1. Confirm ownership in `packages/runtime/src/personas/director/README.md` (Owns / Does not own, A1–A5).
2. Add a failing behavior test under `tests/personas/director/`.
3. Implement inside the Director directory as a pure FSM (`view()` + `advance`).
4. Cross persona boundaries only with versioned artifacts/events/effects — no lateral internal imports.
5. Update the Director README in the same diff if ownership or public surface changed.

## Validation

```bash
pnpm run test:vitest -- tests/personas/director/
pnpm run test:vitest -- tests/architecture/persona-boundary.test.js tests/architecture/persona-authority.test.js
pnpm run typecheck   # if contracts.ts or typed surfaces changed
```

## Escalate

Stop when planning vs configuration ownership is unclear, a new controller API is required, artifact schemas must change, or charter/diagram edits are needed.

## Pointers

- README: `packages/runtime/src/personas/director/README.md`
- Controller / FSM: `controller.js`, `state-machine.js`, `persona.js`, `contracts.ts`
- Artifacts: `packages/runtime/src/contracts/artifacts.ts`
- Charter: `docs/architecture-charter.md`
