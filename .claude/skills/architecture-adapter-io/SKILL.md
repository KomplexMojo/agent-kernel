---
name: architecture-adapter-io
description: Use when implementing or changing adapters-cli / adapters-web / adapters-test IO (LLM, IPFS, chain, solver/Z3, workflow) behind ports. Do not use for persona domain logic, pricing, Actor scoring, or core-ts rules — adapters execute effects, they do not own policy.
---

# Architecture: Adapter IO

Scoped change skill for **external IO adapters**. Load this when the work is about adapter implementations behind ports — not a full-app sweep of runtime policy.

## Use when / Do not use when

**Use when** the change adds or edits adapter clients under `packages/adapters-{cli,web,test}/`, wires adapter methods consumed by `dispatchEffect`, keeps CLI/web Z3 (or other duplicated) copies in sync, or tightens fixture doubles in `adapters-test`.

**Do not use when** the change defines who may spend (Allocator), what to plan (Director), what to configure (Configurator), what to propose (Actor), tick policy (Moderator), pure rules (`core-ts`), or schema declarations (`architecture-artifacts-contracts`).

## Allowed edit surfaces

- `packages/adapters-cli/src/adapters/**`
- `packages/adapters-web/src/adapters/**`
- `packages/adapters-test/src/adapters/**` (deterministic fixtures; no live services in tests)
- Port call shapes only as needed: `packages/runtime/src/ports/effects.js`, `packages/runtime/src/ports/solver.js`
- Guards: `tests/architecture/z3-adapter-copies-in-sync.test.js`, `tests/architecture/actor-adapter-policy-residue.test.js`, `tests/architecture/adapters-cli-no-actor-authoring.test.js`, `tests/architecture/cr4-llm-call-site-inventory.test.js`

## Forbidden

- Actor scoring, motivation defaults, delver candidate authoring, or Allocator prices inside adapters.
- Importing adapter packages from `runtime` or `core-ts`.
- Live external calls from the Vitest suite — use `adapters-test` fixtures.
- Silently “fulfilling” LLM/external-fact effects when the adapter is missing — match port/`dispatchEffect` contracts.
- Diverging CLI vs web copies of the same adapter without updating the sync guard.
- Persona internals imports from adapters (controllers/contracts only if a facade is explicitly required — prefer ports).

## Workflow

1. Confirm the capability is IO (transport, serialization to an external system), not domain policy.
2. Implement under the correct adapter package; mirror CLI/web when the guard requires parity.
3. Ensure runtime reaches the adapter only via ports/`dispatchEffect` (or the documented solver path).
4. Prefer fixture doubles in `adapters-test` for deterministic coverage.
5. Same-diff adapter README / CLI README when flags or behavior users see changed.

## Validation

```bash
pnpm run test:vitest -- tests/architecture/actor-adapter-policy-residue.test.js tests/architecture/adapters-cli-no-actor-authoring.test.js tests/architecture/z3-adapter-copies-in-sync.test.js tests/architecture/ports-and-adapters-boundary.test.js
pnpm run test:vitest -- tests/adapters-cli/ tests/adapters-web/ tests/adapters-test/   # narrow further to the touched surface when possible
pnpm run typecheck   # if typed adapter surfaces changed
```

## Escalate

Stop when an adapter would need to own pricing/scoring/authoring, a new external system needs a charter-level port, or normative architecture docs must change.

## Pointers

- Effects dispatch: `packages/runtime/src/ports/effects.js`
- Solver port: `packages/runtime/src/ports/solver.js`
- Layering skill: `.claude/skills/architecture-dependency-direction/SKILL.md`
- Effects skill: `.claude/skills/architecture-effects-routing/SKILL.md`
- Charter: `docs/architecture-charter.md`
