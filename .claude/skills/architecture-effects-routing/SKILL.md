---
name: architecture-effects-routing
description: Use when changing EffectKind definitions, runtime effect records, dispatchEffect routing, solver port wiring, or Moderator fulfillment dispositions versus adapter execution. Do not use for persona domain rules unrelated to effects, or for implementing adapter clients (use architecture-adapter-io).
---

# Architecture: Effects routing

Scoped change skill for **effects-as-data and port dispatch**. Load this when the work is about how side effects are declared, planned, and routed — not a full-app sweep.

## Use when / Do not use when

**Use when** the change touches core `EffectKind`, runtime effect record shaping, `dispatchEffect`, solver request/resolve ports, or the split between Moderator fulfillment **policy** and adapter **execution**.

**Do not use when** the change is general tick ordering without effect policy (prefer `persona-moderator`), Actor proposal content (`persona-actor`), dependency imports alone (`architecture-dependency-direction`), artifact schemas alone (`architecture-artifacts-contracts`), or concrete LLM/IPFS/chain/Z3 client code (`architecture-adapter-io`).

## Allowed edit surfaces

- `packages/core-ts/src/ports/effects.ts` — sole numeric `EffectKind` codebook origin
- `packages/runtime/src/ports/effects.js` — map core kinds → versioned records; `dispatchEffect(adapters, effect)`
- `packages/runtime/src/ports/solver.js` (+ related solver conformance helpers)
- Moderator fulfillment policy inside `packages/runtime/src/personas/moderator/` when dispositions change (keep IO out)
- Runner coordination that executes the fulfillment plan without inventing domain rules: `packages/runtime/src/runner/`
- Guards: `tests/architecture/ports-and-adapters-boundary.test.js`, `tests/architecture/cr4-llm-call-site-inventory.test.js`, relevant persona effect tests

## Forbidden

- Executing LLM/solver/IPFS/chain IO inside personas or `core-ts`.
- Treating missing adapters as silent success for LLM/external facts — prefer `deferred` / explicit failure per port contract.
- Letting adapters invent prices, Actor scores, or Allocator objectives while “handling” an effect.
- Duplicating `EffectKind` definitions outside the core codebook.
- Bypassing `dispatchEffect` with ad-hoc adapter calls from glue when the effect path already exists.

## Workflow

1. Decide whether the change is **kind/data** (core), **record/dispatch** (runtime ports), **disposition policy** (Moderator), or **IO** (adapters → switch skills).
2. Keep personas returning effects as data from `advance`; do not call adapters from FSM bodies.
3. Wire new kinds through core → runtime mapping → dispatch cases → adapter methods; update inventories/guards.
4. If Moderator plans fulfillment, leave execution to the runner + `dispatchEffect`.
5. Same-diff docs only if port contracts or boundary diagrams change (diagram needs sign-off).

## Validation

```bash
pnpm run test:vitest -- tests/architecture/ports-and-adapters-boundary.test.js tests/architecture/cr4-llm-call-site-inventory.test.js tests/personas/moderator/
pnpm run test:vitest -- tests/personas/actor/   # if solver_request shapes changed
pnpm run typecheck   # if core-ts ports or typed surfaces changed
```

## Escalate

Stop when a new external capability needs a charter-level port, Moderator vs adapter ownership is unclear, or normative docs must change.

## Pointers

- Core kinds: `packages/core-ts/src/ports/effects.ts`
- Dispatch: `packages/runtime/src/ports/effects.js`
- Solver: `packages/runtime/src/ports/solver.js`
- Moderator skill: `.claude/skills/persona-moderator/SKILL.md`
- Charter: `docs/architecture-charter.md`
