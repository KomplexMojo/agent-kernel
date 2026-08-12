# Game-Element Coverage Matrix

Tracks that every game element works as intended through the **CLI/MCP** and the
**UI (`packages/ui-web/index_c.html`)**, with **UI↔CLI parity** on shared configs.

The element vocabulary is the canonical source of truth in
[`game-elements.js`](../packages/runtime/src/contracts/game-elements.js)
(`GAME_AFFINITY_KINDS`, `GAME_AFFINITY_EXPRESSIONS`, `GAME_VITAL_KEYS`,
`GAME_MOTIVATION_KINDS`). The Layer 1 and Layer 2 matrices **import these
constants directly**, so adding a new element automatically adds a test case —
a missing case becomes a failing test, never silent drift.

## Suite layers

| Layer | File | Drives |
|---|---|---|
| **L1 — CLI/MCP per-element** | [`integration/element-matrix-cli.test.mjs`](integration/element-matrix-cli.test.mjs) | `ak create`/`run`; asserts each element round-trips into sim-config / initial-state / spec |
| **Ladder — author→build→run** | [`integration/complexity-ladder.test.mjs`](integration/complexity-ladder.test.mjs) + [`fixtures/scenarios/complexity-ladder/`](fixtures/scenarios/complexity-ladder/) | escalating T0→T3 fixtures through the full pipeline |
| **L2 — UI element render** | [`playwright/element-matrix-ui.spec.mjs`](playwright/element-matrix-ui.spec.mjs) | `index_c.html` via `serve:c`; build → gameplay render |
| **L3 — UI↔CLI parity** | [`integration/ui-cli-equivalence.test.js`](integration/ui-cli-equivalence.test.js) (ladder block) | CLI `build` vs in-process cli-worker (browser) adapter |

Run: `pnpm run test:vitest -- tests/integration/element-matrix-cli.test.mjs`
· `pnpm run test:vitest -- tests/integration/complexity-ladder.test.mjs`
· `pnpm run test:vitest -- tests/integration/ui-cli-equivalence.test.js`
· `pnpm run test:playwright -- tests/playwright/element-matrix-ui.spec.mjs`

## Element coverage

Legend: ✅ asserted · 🟡 covered indirectly (build/render only) · ⏳ pending (open design question)

### Affinities (10) — `fire water earth wind life decay corrode fortify light dark`
| | L1 (CLI) | L2 (UI) | L3 (parity) |
|---|---|---|---|
| each kind on a hazard (emit) | ✅ round-trips to `sim-config.layout.data.hazards[].affinity.kind` | 🟡 via hazards in full-breadth build | ✅ ladder build parity |
| each kind on a hazard | ✅ (expression block) | ✅ all 10 in full-breadth gameplay render | ✅ |

### Affinity expressions (4) — `push pull emit draw`
| | L1 (CLI) | L2 (UI) | L3 (parity) |
|---|---|---|---|
| each on a hazard | ✅ round-trips to `spec…levelGen.hazards[].expression` | ✅ cycled across hazards | ✅ |
| each on a hazard | ⏳ **pending** — open design question (hazard projection/draw policy); test records the CLI's *actual* accept/reject, does not assert validity | — | — |

### Motivations (12) — `random stationary exploring patrolling attacking defending stealthy friendly reflexive goal_oriented strategy_focused user_controlled`
| | L1 (CLI) | L2 (UI) | L3 (parity) |
|---|---|---|---|
| each on a delver | ✅ round-trips to `spec.authoring.request.objects[].attributes.motivation(s)` (control-family uses `motivations[]`) | 🟡 representative motivations in full-breadth build | ✅ ladder |

### Vitals (4) — `health mana stamina durability`
| | L1 (CLI) | L2 (UI) | L3 (parity) |
|---|---|---|---|
| all keys present & well-formed on actors | ✅ structural (budget maximizer rescales magnitudes, so exact values are not asserted) | 🟡 actors render | ✅ |

### Rooms / layout
| | L1 (CLI) | L2 (UI) | L3 (parity) |
|---|---|---|---|
| sizes scale grid | ✅ `small ≤ medium < large` (small==medium currently — code is law) | 🟡 multi-room render | ✅ |
| floor tiles | 🟡 ladder T2 (`--floor-tile`) | 🟡 | ✅ |

### Hazards / Hazards / Resources
| | L1 (CLI) | L2 (UI) | L3 (parity) |
|---|---|---|---|
| hazard placement + affinity payload | ✅ `layout.data.hazards[]` | 🟡 | ✅ |
| hazard (V2, mana, proximity) | ✅ `spec…levelGen.hazards[]` + `hazard-N.json` | ✅ 10 hazards render | ✅ |
| resource tiers `level` / `permanent` | ✅ `spec…resources[]` + `resource-N.json` | ✅ both tiers in build | ✅ |
| resource `consumable` | ✅ **rejected** by V3 spec (negative) | — | — |

### Complexity ladder
| Tier | Intent | Status |
|---|---|---|
| T0 smoke | 1 room/hazard/delver/warden | ✅ create + run + UI gameplay |
| T1 medium | multi-room, mixed motivations, hazard | ✅ create + run |
| **T2 stress** | **every affinity × all 4 expressions on hazards, multi-affinity actors, both resource tiers, 3 large rooms, budget 6000** | ✅ create + run + UI full-breadth render + parity |
| T3 budget-edge | tiny budget + heavy roster | ✅ allocator degrades gracefully; `budget-receipt.status == "denied"`, `remaining < 0` |

## Negative coverage
- Unknown affinity kind → `ok:false` with explained errors (L1).
- Small room too small for entrance+exit+hazard → `ok:false` (L1).
- Resource `consumable` tier → rejected by V3 spec (L1).

## Open questions / follow-ups
- **Hazard projection/draw policy** (`KNOWN_ISSUES.md`): whether `push`/`pull`/`draw` are valid hazard expressions is undecided. L1 records actual behavior as `pending`; promote to hard asserts once decided.
- Per-element UI assertions currently rely on the diagnostics build path; driving the Phaser card-builder affordances per element + status-rail token attribution is captured in each suite's `## TODO: Test Permutations`.
- Hard `insufficient_budget` / `conflicting_requirements` (vs graceful degradation) needs a supplied `--budget` artifact — tracked in the ladder TODO.
