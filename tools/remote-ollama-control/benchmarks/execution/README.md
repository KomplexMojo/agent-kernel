# Execution-quality benchmark catalog

This directory is the versioned question set for dynamic program evaluation. It is separate from the
100 content-generation prompts: authoring asks whether a model creates a valid dungeon; execution asks
whether a committed or generated dungeon remains correct, live, useful, deterministic, and bounded over
time.

`contract.json` declares the scorer version, shared run profiles, hard invariants, metric vocabulary,
and suite qualification floors. The five family files contain exactly five scenarios each. Their
semantic contents produce the execution-suite, seed-set, and tick-profile hashes returned by
`loadExecutionCatalog()`.

Evidence is explicit:

- `artifact` metrics can be derived from current public run artifacts.
- `observation` metrics require the future checkpoint artifact planned for E3.

Unavailable observation evidence must be reported as `evidence_unavailable`; it must never silently
pass. Required gates and global invariants are hard failures. Weighted objectives total 100 per scenario
and are scored only after the gates pass.

E1 contains no runner or runtime instrumentation. Validate edits with:

```bash
pnpm run test:vitest -- tests/tools/execution-benchmark-catalog.test.js
```
