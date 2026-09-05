---
name: persona-orchestrator
description: Use when changing Orchestrator LLM sessions, budget-loop hosting, prompt-contract runtime seams, deferred side-effect coordination, or external request intake. Do not use for planning (Director), SimConfig authoring (Configurator), pricing (Allocator), or tick mutation (core-ts).
---

# Persona: Orchestrator

Scoped change skill for the **integration and boundary persona**. Load this instead of sweeping the whole app when the work belongs to Orchestrator.

## Use when / Do not use when

**Use when** the change is about external request intake, adapter selection around a run, LLM session/round hosting, budget-loop host wiring, prompt-contract execution seams, or deferred side-effect coordination.

**Do not use when** the change is intent→plan translation (Director), config assembly/validation (Configurator), pricing/receipts (Allocator), action proposals (Actor), tick ordering/fulfillment policy (Moderator), telemetry summarization (Annotator), or pure simulation rules (`core-ts`).

## Allowed edit surfaces

- `packages/runtime/src/personas/orchestrator/` (controller, state-machine, persona, contracts, helpers)
- Behavior tests: `tests/personas/orchestrator/orchestrator-<behavior>.test.*`
- Related architecture proofs only when ownership is already chartered here: `tests/architecture/orchestrator-*-authority.test.js`, `tests/architecture/cr4-llm-call-site-inventory.test.js`

## Forbidden

- Importing Orchestrator internals from outside this directory — outside callers use only `controller.js` / `persona.js` / `contracts.ts`.
- Putting planning, config authoring, pricing, or action choice into Orchestrator (or into glue “because it’s convenient”).
- Executing effects inline — return effects as data; route via `packages/runtime/src/ports/effects.js`.
- Reading a clock directly or storing non-serializable context (functions, class instances).
- Stamping `producedBy: "orchestrator"` on artifacts this persona did not produce.
- Inventing cost fallbacks — pricing belongs to Allocator only.

## Workflow

1. Confirm ownership against `packages/runtime/src/personas/orchestrator/README.md` Owns / Does not own and the A1–A5 table.
2. Write or extend a failing behavior test under `tests/personas/orchestrator/`.
3. Implement inside `packages/runtime/src/personas/orchestrator/` as a pure FSM (`view()` + `advance(event, payload)`).
4. Keep glue (`commands/`, `build/`, runner) sequencing-only — no new domain rules.
5. Update the Orchestrator README in the same diff if the public surface or ownership table changed.

## Validation

```bash
pnpm run test:vitest -- tests/personas/orchestrator/
pnpm run test:vitest -- tests/architecture/persona-boundary.test.js tests/architecture/orchestrator-prompt-contract-authority.test.js tests/architecture/orchestrator-budget-loop-authority.test.js
pnpm run typecheck   # if contracts.ts or typed surfaces changed
```

## Escalate

Stop and ask when ownership is ambiguous, the fix spans multiple personas, LLM call-site policy changes need charter wording, or `docs/architecture-charter.md` / `docs/architecture/diagram.mmd` must change.

## Pointers

- README: `packages/runtime/src/personas/orchestrator/README.md`
- Controller / FSM: `controller.js`, `state-machine.js`, `persona.js`, `contracts.ts`
- Charter: `docs/architecture-charter.md` (Persona Model, A1–A5)
- Effects port: `packages/runtime/src/ports/effects.js`
