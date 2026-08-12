Create a focused Vitest file for the exported design-card helpers.

Cover:
- `createDesignCard` defaults for rooms, delvers, wardens, resources, and blank cards.
- `dropPropertyOnCard` behavior for type, affinities, expressions, and motivation conflicts.
- `buildSummaryFromCardSet` budget/spend ledger behavior.
- The regression named exactly `room affinity fields do not affect room card cost`.

Prefer stable behavior over generated IDs or private helper details.
