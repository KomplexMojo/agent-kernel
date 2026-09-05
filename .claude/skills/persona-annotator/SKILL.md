---
name: persona-annotator
description: Use when changing Annotator telemetry capture, TelemetryRecord shaping, RunSummary aggregation, or inspection-ready run views. Do not use for decisions, sim mutation, build-plane telemetry.json glue provenance, or fake producedBy stamps.
---

# Persona: Annotator

Scoped change skill for the **telemetry and observability persona**. Load this instead of sweeping the whole app when the work belongs to Annotator.

## Use when / Do not use when

**Use when** the change collects, normalizes, or summarizes runtime truth into TelemetryRecords, RunSummary, timelines, or inspection-ready records during/after ticks.

**Do not use when** the change makes decisions, mutates state, authors config, prices spends, hosts IO, or attributes build-plane artifacts (e.g. glue `telemetry.json`) to Annotator without this persona running.

## Allowed edit surfaces

- `packages/runtime/src/personas/annotator/` (controller, state-machine, persona, contracts, helpers)
- Behavior tests: `tests/personas/annotator/annotator-<behavior>.test.*`

## Forbidden

- Importing Annotator internals from outside this directory — outside callers use only `controller.js` / `persona.js` / `contracts.ts`.
- Feeding observations back into execution as decisions (Annotator observes; it does not steer).
- Stamping `producedBy: "annotator"` from glue that did not run Annotator.
- Executing effects inline or performing adapter IO inside the persona.
- Non-serializable context or a directly read clock.
- Pricing or config authoring “while summarizing.”

## Workflow

1. Confirm ownership in `packages/runtime/src/personas/annotator/README.md`.
2. Add a failing behavior test under `tests/personas/annotator/`.
3. Implement inside the Annotator directory as a pure FSM; keep outputs observational.
4. Distinguish tick-plane Annotator records from build-plane glue telemetry — provenance must be honest.
5. Update the Annotator README in the same diff if ownership or public surface changed.

## Validation

```bash
pnpm run test:vitest -- tests/personas/annotator/
pnpm run test:vitest -- tests/architecture/persona-boundary.test.js tests/architecture/persona-authority.test.js
pnpm run typecheck   # if contracts.ts or typed surfaces changed
```

## Escalate

Stop when provenance would lie about who produced an artifact, summarization starts encoding policy that belongs elsewhere, schemas must change, or charter/diagram edits are required.

## Pointers

- README: `packages/runtime/src/personas/annotator/README.md`
- Controller / FSM: `controller.js`, `state-machine.js`, `persona.js`, `contracts.ts`
- Artifacts: `packages/runtime/src/contracts/artifacts.ts`
- Charter provenance rules: `docs/architecture-charter.md`
