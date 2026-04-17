---
type: "query"
date: "2026-04-13T22:02:16.904586+00:00"
question: "What connects MoveAction, Solver-Z3 Adapter, Replay-First Kernel Design to the rest of the system?"
contributor: "graphify"
source_nodes: ["MoveAction", "Solver-Z3 Adapter", "Replay-First Kernel Design"]
---

# Q: What connects MoveAction, Solver-Z3 Adapter, Replay-First Kernel Design to the rest of the system?

## Answer

The graph shows one clear bridge and one gap.

`Solver-Z3 Adapter` connects into the main architecture through `adapters-cli Package` (`packages/adapters-cli/src/adapters/solver-z3/README.md` -> `packages/adapters-cli/README.md`), and that package connects directly to `core-as Simulation Core` (`packages/core-as/assembly/README.md`). `Replay-First Kernel Design` hangs directly off that same core node as a `rationale_for` edge from the core README's determinism/replay section. So the shortest documented chain is: `Solver-Z3 Adapter` -> `adapters-cli Package` -> `core-as Simulation Core` <- `Replay-First Kernel Design`.

`MoveAction` is different. In the graph it lives at `packages/core-as/assembly/rules/move.ts:L82` and belongs to a disconnected 17-node component containing only its local movement-rule helpers: `applyMove()`, `commitMove()`, `computeMovementCost()`, `validateMoveGeometryAndDestination()`, `decodeMove()`, and the `move.ts` file node. There is no path from that component to `core-as Simulation Core`, `adapters-cli Package`, or `Replay-First Kernel Design` in the current graph.

So the graph’s answer is: the solver and replay rationale are connected by the CLI package and the core README, but `MoveAction` is only connected to the low-level movement implementation and is not yet bridged into the architectural documentation layer. That looks like a real graph gap, not just a subtle path.

## Source Nodes

- MoveAction
- Solver-Z3 Adapter
- Replay-First Kernel Design