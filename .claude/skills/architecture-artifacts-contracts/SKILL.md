---
name: architecture-artifacts-contracts
description: Use when adding or evolving versioned agent-kernel artifact schemas, fixtures, or schema-origin/coverage guards in artifacts.ts. Do not use for persona behavior that merely consumes artifacts (use persona-*) or for adapter transport framing alone.
---

# Architecture: Artifacts & contracts

Scoped change skill for **versioned boundary schemas**. Load this when the work is about the artifact contract surface — not a full-app sweep of producers/consumers.

## Use when / Do not use when

**Use when** the change declares or evolves an `agent-kernel/*` schema, adjusts `schemaVersion` / `meta`, adds positive/negative fixtures, or updates schema origin/catalog guards.

**Do not use when** the change only reads artifacts inside one persona (use that `persona-*` skill), only moves bytes over LLM/IPFS/chain (`architecture-adapter-io`), or only fixes package imports (`architecture-dependency-direction`).

## Allowed edit surfaces

- `packages/runtime/src/contracts/artifacts.ts` — single declaration origin for `agent-kernel/*` schema strings and shapes
- Fixtures: `tests/fixtures/**` (invalid cases under `tests/fixtures/artifacts/invalid/` when adding validation)
- Guards: `tests/architecture/schema-declaration-origin.test.js`, `tests/architecture/schema-catalog-coverage.test.js`
- Narrow consumer updates required for a schema bump (prefer the owning persona skill for behavior tests)

## Forbidden

- Declaring or retyping `agent-kernel/*` string literals outside `artifacts.ts`.
- In-place remove/rename of fields on an existing `schemaVersion` — bump version for breaking changes.
- Glue stamping `producedBy` with a persona that did not run.
- Inventing parallel ad-hoc JSON contracts for the same boundary concept.
- Drive-by refactors of unrelated producers/consumers.

## Workflow

1. Confirm the boundary-crossing data needs a versioned artifact (not an internal persona helper type).
2. Add or evolve the schema in `artifacts.ts` with `schema`, `schemaVersion`, and `meta`.
3. Add fixtures (valid + invalid as appropriate) before widening producers.
4. Update owning persona/adapter call sites minimally; keep behavior tests in the owning tree.
5. Same-diff descriptive docs if a public contract story changed; charter only with sign-off for normative boundary shifts.

## Validation

```bash
pnpm run test:vitest -- tests/architecture/schema-declaration-origin.test.js tests/architecture/schema-catalog-coverage.test.js
pnpm run test:vitest -- tests/fixtures/   # or the specific contract/persona suites that consume the schema
pnpm run typecheck
```

## Escalate

Stop when two personas claim the same artifact, provenance rules conflict, or the charter’s artifact model must change.

## Pointers

- Schemas: `packages/runtime/src/contracts/artifacts.ts`
- Naming: `<schema>-v1-<label>.json` fixtures
- Charter artifact rules: `docs/architecture-charter.md`
- Enforcement mirror: `.cursor/rules/enforcement.mdc`
