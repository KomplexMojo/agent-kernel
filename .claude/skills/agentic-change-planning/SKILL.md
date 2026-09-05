---
name: agentic-change-planning
description: Use when planning, scoping, or writing a milestone/plan for an agent-kernel change — especially before coding. Routes the plan to the owning persona-* or architecture-* skill so work stays scoped instead of a full-app sweep. Do not use as a substitute for those domain skills during implementation.
---

# Agentic change planning

Bridge skill for **Plan mode and milestone scoping**. Decide which focused skill owns the work, constrain the plan to that skill’s surfaces, then hand off. Do not implement domain logic from this skill alone.

## Use when / Do not use when

**Use when** drafting a plan, splitting milestones, or deciding “where does this change live?” before editing production code.

**Do not use when** you already know the owner and are implementing — load that `persona-*` or `architecture-*` skill and follow it. Do not use for benchmarks, Ollama test-gen, or unrelated tooling.

## Routing table

Pick **one primary** skill. Add a second only when the plan truly spans two owners (rare — prefer splitting milestones).

| If the change is about… | Load |
|---|---|
| Orchestrator LLM sessions, budget-loop host, prompt-contract seams, deferred effects | `persona-orchestrator` |
| Director intent → plan / BuildSpec | `persona-director` |
| Configurator SimConfig, levels, actors, cards, feasibility, lock | `persona-configurator` |
| Allocator pricing, base-costs, spend, receipts, reconciliation | `persona-allocator` |
| Actor action proposals / decision envelopes | `persona-actor` |
| Moderator tick order, affinity policy, effect-fulfillment dispositions | `persona-moderator` |
| Annotator telemetry / RunSummary / provenance | `persona-annotator` |
| Package layering / illegal imports / core-ts purity | `architecture-dependency-direction` |
| EffectKind, `dispatchEffect`, solver port, fulfillment vs IO | `architecture-effects-routing` |
| Versioned `artifacts.ts` schemas / fixtures | `architecture-artifacts-contracts` |
| adapters-cli/web/test IO clients (no domain policy) | `architecture-adapter-io` |

**Ambiguous ownership → stop.** Do not park domain logic in glue. Escalate rather than invent a cross-cutting “fix everywhere” plan.

## Plan requirements

Every plan produced under this skill must:

1. **Name the owning skill(s)** in the plan body (exact `persona-*` / `architecture-*` ids).
2. **List allowed edit surfaces** copied from that skill (paths), and state what is out of scope.
3. **Require reading** `.claude/skills/<owner>/SKILL.md` before the first code change.
4. **Prefer one milestone per owner** — if two personas are involved, split unless a thin artifact handoff is the whole story.
5. **Name validation** from the owning skill (narrow `pnpm run test:vitest -- …`, relevant architecture guards).
6. **Forbid full-app sweeps** — no “also clean up neighboring packages” unless it is the chartered defect.

## Workflow

1. Classify: persona domain vs ports/adapters architecture vs both (split).
2. Read this skill’s routing table; pick the owner.
3. Read the owning skill’s `SKILL.md` (and its Pointers) before writing milestones.
4. Write the plan with owner, allowed paths, forbidden moves, validation, escalate conditions.
5. On implementation, load the owning skill again and stay inside it.

## Validation

Planning-only — no suite required. Before handoff, confirm the plan names a real skill directory under `.claude/skills/` and does not list edit roots that skill forbids.

## Escalate

Ownership unclear · change needs charter/diagram edits · multi-persona policy in one milestone · pricing or IO leaking into the wrong layer.

## Pointers

- Persona skills: `.claude/skills/persona-*/SKILL.md`
- Architecture skills: `.claude/skills/architecture-*/SKILL.md`
- Roster: `AGENTS.md` → Repo-owned skills
- Law: `docs/architecture-charter.md`
- Routing rule: `.cursor/rules/agentic-skill-routing.mdc`
