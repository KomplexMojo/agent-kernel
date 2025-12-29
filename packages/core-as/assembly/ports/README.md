# Ports (core-as)

Purpose: define effect/port shapes used by `core-as` to request IO without performing it.

These ports are expressed as data and interpreted by the runtime/adapters layer.
AssemblyScript cannot call JS directly without imports; keep the boundary explicit.

## Usage

- `core-as` emits effects or requests defined here.
- Runtime/adapters fulfill those effects and return results outside the core.
