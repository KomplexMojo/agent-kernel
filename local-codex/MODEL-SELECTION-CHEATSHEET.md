# Model Selection Cheat Sheet

Use this file to choose the model and reasoning level before starting a coding slice on this branch.

## 1) Default

Use this unless there is a clear reason not to:

- Model: `gpt-5.3-codex`
- Reasoning: `medium`

Why:
- most branch work is bounded implementation inside an existing codebase,
- the repo already has strong execution artifacts in `local-codex`,
- `xhigh` is usually wasted on routine parity, UI, test, and docs slices.

## 2) Fast Rules

Use `gpt-5.3-codex` at `medium` for:
- straightforward implementation slices,
- UI cleanup,
- parity wiring,
- test updates,
- fixture rebaselines,
- adapter refactors with low ambiguity.

Use `gpt-5.3-codex` at `high` for:
- integration-heavy slices across CLI + web + runtime,
- shared-rails migrations,
- artifact contract wiring,
- runtime behavior changes with multiple touched surfaces.

Use `gpt-5.4` at `high` for:
- architecture boundary decisions,
- high-ambiguity external integrations,
- hard debugging with expectation drift,
- branch-close scope decisions.

Use `gpt-5.4-mini` at `medium` for:
- docs,
- checklists,
- cleanup,
- smaller UI/layout changes,
- final handoff polish.

Do not use `xhigh` by default.

## 3) Outstanding Branch Items

| Item | Recommended model | Reasoning | Why |
| --- | --- | --- | --- |
| `B2-S1` IPFS artifact storage/reload | `gpt-5.3-codex` | `high` | Multi-surface integration work, but still bounded and implementation-heavy. |
| `B2-S2` Blockchain mint/load | `gpt-5.4` | `high` | Highest architecture and external-contract ambiguity in the remaining branch scope. |
| `B2-S3` Standalone `llm` on shared rails | `gpt-5.3-codex` | `high` | Existing LLM plumbing already exists; main work is reuse, wiring, and tests. |
| `B2-S4` automatic solver-to-LLM fallback decision | `gpt-5.4` | `high` | This is a branch-close product/architecture decision, not just code. |
| `B2-S4` automatic solver-to-LLM fallback implementation, if approved | `gpt-5.3-codex` | `high` | After policy is fixed, it becomes concrete runtime wiring and regression work. |
| `B3` Deduplicate CLI/web adapter behavior | `gpt-5.3-codex` | `medium` | Refactor-heavy, but usually low ambiguity. |
| `B4` Minimum-install baseline and dependency isolation | `gpt-5.4-mini` | `medium` | Usually documentation, audit, and boundary cleanup first. Escalate only if code isolation gets messy. |
| `B5` `TEST-LLM-1` (`ak-llm-plan` drift) | `gpt-5.4` | `high` | Debugging with telemetry and expectation drift. Stronger reasoning is justified. |
| `B5` `TEST-WEB-1` (`adapter-modules` walkableTiles drift) | `gpt-5.3-codex` | `medium` | Likely a narrower fixture-vs-behavior mismatch. |
| `B6` Final docs, parity closure, handoff | `gpt-5.4-mini` | `medium` | Mainly synthesis, consistency, and packaging work. |

## 4) Lower-Priority Partial Rows

| Item | Recommended model | Reasoning |
| --- | --- | --- |
| Budget JSON panels UI wiring | `gpt-5.4-mini` | `medium` |
| Game Board parity polish | `gpt-5.3-codex` | `medium` |
| LLM trace/diagnostics polish | `gpt-5.4-mini` | `medium` |

## 5) Token Control Rules

To save tokens more effectively than changing models:

1. Start a fresh thread per slice:
   - `B2-S1`
   - `B2-S2`
   - `B2-S3`
   - `B5`
2. In the first prompt, say:
   - read `AGENTS.md`,
   - read `local-codex/Prompt.md`,
   - read `local-codex/Plan.md`,
   - read `local-codex/Documentation.md`,
   - work only on `<slice-id>`.
3. Do not combine multiple open work packages in one session.
4. Escalate model or reasoning only if the first pass fails.
5. Avoid `xhigh` unless the task is both ambiguous and blocking.

## 6) Quick Decision Tree

1. Is this mostly docs, cleanup, or small UI polish?
   - Use `gpt-5.4-mini` at `medium`.
2. Is this a normal implementation slice with clear files and tests?
   - Use `gpt-5.3-codex` at `medium`.
3. Is this an integration-heavy slice touching runtime + CLI + web?
   - Use `gpt-5.3-codex` at `high`.
4. Is this an architecture decision or hard debugging problem?
   - Use `gpt-5.4` at `high`.

## 7) Branch Default Recommendation

If you want one default for this branch:

- Model: `gpt-5.3-codex`
- Reasoning: `medium`

Escalate only when the slice actually warrants it.
