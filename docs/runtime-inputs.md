# Runtime Inputs Contract

This reference describes the public inputs for the runtime loop (`createRuntime().init()` and `createRuntime().step()`), with a focus on `personaEvents` and `personaPayloads`.

## Entry points

- `createRuntime({ core, adapters, personas, ... })`
- `runtime.init(options)`
- `runtime.step(options)`

### `init(options)`

Common fields:

- `seed` (number) — RNG seed for core initialization.
- `runId` (string) — Run identifier recorded in tick frames and artifacts.
- `clock` (function) — Optional clock override for deterministic timestamps.
- `simConfig` / `initialState` — Configuration artifacts passed into the runtime.
- `intentEnvelope` (or `intent`) — Director input for plan creation.
- `planArtifact` (or `plan`) — Optional plan artifact to seed Orchestrator.
- `personaEvents` / `personaPayloads` — Optional overrides for the init phase.

### `step(options)`

Per-tick overrides:

- `personaEvents` / `personaPayloads` — Optional overrides for the observe/decide/apply/emit/summarize phases.
- `controlEvent` (or `control` / `moderatorEvent`) — Moderator control input (see below).

## `personaEvents`

Shape:

```json
{
  "actor": "observe",
  "director": ["bootstrap", "ingest_intent"],
  "moderator": "pause"
}
```

Rules:

- The object is keyed by persona name.
- Values are either a single event string or an array of event strings.
- Arrays are dispatched in order within the same phase.
- When omitted, the runtime uses the default FSM schedule for each persona.

## `personaPayloads`

Shape:

```json
{
  "actor": { "observation": { "tick": 1 } },
  "allocator": { "budgets": [{ "category": "movement", "cap": 12 }] }
}
```

Rules:

- The object is keyed by persona name.
- Values are payload objects merged with the runtime’s base payload for that phase.
- The runtime’s base payload includes:
  - `runId`, `tick`, `simConfig`, `initialState`
  - `effects`, `fulfilledEffects`
  - `intentEnvelope`, `planArtifact`, `intentRef`, `planRef`

Compatibility alias:

- `inputs` may be used as a top-level alias for `personaPayloads`.

## Moderator control events

`controlEvent` (aliases: `control`, `moderatorEvent`) is consumed by the Moderator persona during the `observe` phase.

Supported values:

- `pause`
- `resume`
- `stop`

When provided, the control event is appended to any Moderator event already scheduled for the phase.

## Validation behavior

The runtime validates these inputs and throws when:

- `personaEvents` or `personaPayloads` is not an object.
- Any `personaEvents` entry is not a string or string array.

Use fixture-driven runs for deterministic behavior when providing custom events/payloads.
