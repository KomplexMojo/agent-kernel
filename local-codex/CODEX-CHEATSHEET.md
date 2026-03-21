# CODEX + VS Code Cheatsheet (agent-kernel)

Use this page as the standard workflow for large changes.

## 1) What Each File Is For

- `local-codex/Prompt.md`: Contract for the deliverable (problem, scope, constraints, acceptance criteria, deliverables).
- `local-codex/Plan.md`: Milestones and validation matrix (requirement -> tests -> code -> validation).
- `local-codex/Implement.md`: Runbook for how work is executed and verified.
- `local-codex/Documentation.md`: Live status, decisions, validation results, blockers, and merge readiness.

## 2) Standard Session Flow

1. Start: fill `Prompt.md` sections 1-7.
2. Plan: break into milestones in `Plan.md`.
3. Execute: follow `Implement.md` milestone loop.
4. Log continuously: update `Documentation.md` after each milestone.
5. Finish: verify `Documentation.md` merge checklist is complete.

## 3) How `/plan` Fits In

- `/plan` is session-level planning inside Codex.
- `local-codex/*.md` is project-level source of truth across sessions.
- Use both:
  - First, update `Prompt.md` + `Plan.md`.
  - Then use `/plan` to decompose current milestone into immediate steps.
  - Execute and record outcomes back into `Documentation.md`.

Rule: if `/plan` output conflicts with `Prompt.md`/`Plan.md`, update the docs first, then continue.

For this UI-to-CLI initiative, treat `/plan` as milestone decomposer only; parity requirements stay anchored in `local-codex/ui-cli-parity-matrix.md`.

## 4) Kickoff Prompt (Paste Into New Codex Session)

```text
Work in /Users/darren/Documents/GitHub/agent-kernel.
Before coding, read AGENTS.md and local-codex/Prompt.md, Plan.md, Implement.md, Documentation.md.
Execute milestone-by-milestone: requirement -> tests -> code -> validation.
After each milestone, update local-codex/Documentation.md with status, decisions, and validation results.
```

## 5) Daily Operating Checklist

- [ ] Prompt scope and acceptance criteria are current.
- [ ] Current milestone is marked in Plan.
- [ ] `local-codex/ui-cli-parity-matrix.md` is updated for touched UI features.
- [ ] Tests were added/updated before or with implementation.
- [ ] Validation commands were run and logged.
- [ ] Documentation reflects decisions and blockers.

## 6) Useful Commands

```bash
node --test "tests/**/*.test.js"
rg -n "TODO|FIXME" packages tests docs
rg -n "data-tab-panel=\\\"diagnostics\\\"|id=\\\"" packages/ui-web/index.html
rg -n "function .*Command|case \\\"" packages/adapters-cli/src/cli/ak-impl.mjs
git status --short
```

## 7) PDF Export (VS Code)

Option A (recommended):
1. Open this file in VS Code.
2. Use Markdown Preview.
3. Print the preview to PDF.

Option B (CLI, if tool is installed):
```bash
npx md-to-pdf local-codex/CODEX-CHEATSHEET.md
```

Output is a shareable one-page workflow reference for coding with Codex in VS Code.

## 8) Practical Kickoff For This Deliverable

1. Fill `local-codex/ui-cli-parity-matrix.md` with current UI features and current CLI mappings.
2. Mark each row as `implemented`, `missing`, `partial`, or `ui-only`.
3. Move all `missing`/`partial` rows into milestones in `local-codex/Plan.md`.
4. Ask Codex to execute one milestone at a time.
5. After each milestone, update `local-codex/Documentation.md` and re-run validations.
