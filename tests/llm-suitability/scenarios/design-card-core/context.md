Repo test conventions:
- Use `import assert from "node:assert/strict"`.
- Use `import { test } from "vitest"` for Vitest tests.
- Import public UI helpers from `../../packages/ui-web/src/design-guidance.js`.
- Tests should be deterministic and should not rely on browser APIs, network, WASM, or snapshots.
- Existing design-card tests assert behavior through public exports: normalized card shape,
  motivations, affinities, resource fields, vitals, grouped summaries, and budget ledger totals.

Important behavioral notes:
- Room cards are generic containers. Room affinity and room affinity stacks must not change room cost.
- Actor cards have vitals. Delver defaults differ from warden defaults.
- Motivation changes should respect conflicts instead of blindly accepting incompatible states.
- Generated IDs are intentionally unstable and should only be checked by prefix/pattern when needed.
