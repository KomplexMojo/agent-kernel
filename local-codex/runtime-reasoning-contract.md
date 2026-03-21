# Runtime Reasoning Contract

Purpose: define `B2-S4` by reusing the existing solver and LLM artifact pipeline for solver-first and LLM-optional gameplay reasoning.

## 1) Intent

Runtime reasoning is a gameplay capability, not a side utility.

Canonical example:
- an attacker sees two defenders and must choose its next move.

This branch should support:
- deterministic tactical choice through the existing solver path,
- structured local-first LLM reasoning where solver formalization is insufficient,
- one normalized decision payload regardless of provider,
- no parallel top-level `RuntimeDecisionRequest` / `RuntimeDecisionResult` schemas unless implementation evidence later forces that change.

The current repo already has the right transport primitives:
- `EffectV1.kind = "solver_request"`
- `SolverRequest`
- `SolverResult`
- `CapturedInputArtifact`
- `Action`
- fulfilled/deferred effect records in runtime tick frames and effects logs

`B2-S4` should standardize how runtime decision data is carried through those artifacts, not create a second artifact family.

## 2) Reused Runtime Primitives

### 2.1 Solver path

- Request transport:
  - `EffectV1.kind = "solver_request"`
  - `effect.request`
  - `SolverRequest.problem.data`
- Response transport:
  - `SolverResult`
  - runtime fulfillment record for the original effect

### 2.2 LLM path

- Request/response transport:
  - `CapturedInputArtifact`
  - `source.adapter = "llm"` or `"ollama"`
  - `payload.prompt`
  - `payload.responseRaw`
  - `payload.responseParsed`
- Runtime enactment transport:
  - normalized decision payload extracted from the capture
  - chosen `Action`
  - fulfillment record if the decision is enacted during runtime

### 2.3 Shared execution rules

- `Action` remains the enactable runtime output.
- `fulfilledEffects` / `deferredEffects` remain the runtime record of what happened.
- `sourceRef`, `requestId`, `targetAdapter`, and effect `fulfillment` remain the routing/replay controls.

## 3) Canonical Embedded Contracts

The concrete contract for `B2-S4` is an embedded payload pair:

1. a normalized request envelope
2. a normalized decision payload

These are not new top-level artifact schemas. They are JSON objects carried inside existing artifacts.

### 3.1 Request envelope: `runtime-decision-v1`

Where it lives:
- solver path:
  - `SolverRequest.problem.data`
- llm path:
  - included in the prompt/capture as `CapturedInputArtifact.payload.requestEnvelope`

Required fields:
- `contract`
- `decisionKind`
- `phase`
- `tick`
- `actor`
- `candidateActions`
- `providerPolicy`

Recommended shape:

```json
{
  "contract": "runtime-decision-v1",
  "decisionKind": "next_move",
  "phase": "execute",
  "tick": 12,
  "actor": {
    "id": "actor_mvp",
    "role": "attacker",
    "position": { "x": 4, "y": 6 },
    "vitals": {
      "health": { "current": 8, "max": 12, "regen": 0 },
      "mana": { "current": 3, "max": 5, "regen": 1 },
      "stamina": { "current": 2, "max": 4, "regen": 1 }
    },
    "traits": {
      "motivations": ["attacking", "goal_oriented"],
      "affinities": [{ "kind": "fire", "expression": "push", "stacks": 2 }]
    }
  },
  "visibleActors": [
    {
      "id": "def_a",
      "role": "defender",
      "position": { "x": 6, "y": 6 },
      "distance": 2,
      "threatScore": 7
    },
    {
      "id": "def_b",
      "role": "defender",
      "position": { "x": 4, "y": 8 },
      "distance": 2,
      "threatScore": 5
    }
  ],
  "hazards": [
    {
      "kind": "trap",
      "position": { "x": 5, "y": 6 },
      "predictedHealthDelta": -2
    }
  ],
  "candidateActions": [
    {
      "id": "move_east",
      "action": {
        "schema": "agent-kernel/Action",
        "schemaVersion": 1,
        "actorId": "actor_mvp",
        "tick": 12,
        "kind": "move",
        "params": { "to": { "x": 5, "y": 6 } }
      }
    },
    {
      "id": "move_south",
      "action": {
        "schema": "agent-kernel/Action",
        "schemaVersion": 1,
        "actorId": "actor_mvp",
        "tick": 12,
        "kind": "move",
        "params": { "to": { "x": 4, "y": 7 } }
      }
    },
    {
      "id": "cast_fire_bolt_def_a",
      "action": {
        "schema": "agent-kernel/Action",
        "schemaVersion": 1,
        "actorId": "actor_mvp",
        "tick": 12,
        "kind": "custom",
        "params": { "abilityId": "fire_bolt", "targetId": "def_a" }
      }
    }
  ],
  "objectives": {
    "weights": {
      "avoid_health_loss": 10,
      "pressure_high_threat_target": 8,
      "preserve_mana": 4,
      "advance_toward_exit": 2
    }
  },
  "constraints": {
    "mustChooseExactlyOneAction": true,
    "manaBudget": 3,
    "staminaBudget": 2
  },
  "providerPolicy": {
    "mode": "auto",
    "preferred": "solver",
    "allowLlmFallback": false,
    "requireDeterministicFulfillment": true
  }
}
```

Supported `decisionKind` values:
- `next_move`
- `target_selection`
- `ability_selection`
- `turn_plan`

### 3.2 Normalized decision payload: `runtime-decision-v1`

Where it lives:
- solver path:
  - `SolverResult.model.decision`
- llm path:
  - `CapturedInputArtifact.payload.responseParsed.decision`
- runtime fulfillment path:
  - fulfillment `result.decision`
  - selected `Action`

Required fields:
- `contract`
- `decisionKind`
- `selectedActionId`

Recommended shape:

```json
{
  "contract": "runtime-decision-v1",
  "decisionKind": "next_move",
  "selectedActionId": "cast_fire_bolt_def_a",
  "selectedTargetId": "def_a",
  "confidence": 0.94,
  "rationaleTags": [
    "high_threat_target",
    "safe_attack_window",
    "mana_budget_ok"
  ],
  "rankedCandidates": [
    { "candidateActionId": "cast_fire_bolt_def_a", "score": 19 },
    { "candidateActionId": "move_south", "score": 12 },
    { "candidateActionId": "move_east", "score": -4 }
  ],
  "rejectedCandidates": [
    { "candidateActionId": "move_east", "reason": "hazard_damage" }
  ]
}
```

Validation rules:
- `selectedActionId` must match one of the supplied candidate actions.
- `selectedTargetId` is optional.
- `confidence` is advisory, not authoritative.
- unknown fields may be ignored.
- invalid or ambiguous decision payloads must resolve to deferred/error handling, not free-form enactment.

Branch-close policy lock (2026-03-21):
- Automatic solver->LLM fallback is explicitly disabled by default (`allowLlmFallback=false`).
- Even when fallback is requested by payload policy, runtime reports it as not performed (`auto_llm_fallback_disabled`) on the existing solver rail.
- Live LLM runtime fulfillment remains explicit manual non-deterministic mode only.

## 4) Provider Mapping

### 4.1 Solver mapping

Transport:
- runtime emits `solver_request`
- `effect.request` should already be a valid or normalizable `SolverRequest`
- `SolverRequest.problem.data` carries the request envelope

Recommended solver request shape:

```json
{
  "schema": "agent-kernel/SolverRequest",
  "schemaVersion": 1,
  "meta": {
    "id": "solver_req_tick12_actor_mvp",
    "runId": "run_001",
    "createdAt": "2026-03-15T00:00:00.000Z",
    "producedBy": "runtime"
  },
  "problem": {
    "language": "custom",
    "data": {
      "contract": "runtime-decision-v1",
      "decisionKind": "next_move",
      "tick": 12,
      "actor": { "id": "actor_mvp" },
      "candidateActions": [
        { "id": "move_east" },
        { "id": "move_south" },
        { "id": "cast_fire_bolt_def_a" }
      ],
      "objectives": {
        "weights": {
          "avoid_health_loss": 10,
          "pressure_high_threat_target": 8
        }
      },
      "constraints": {
        "mustChooseExactlyOneAction": true
      },
      "providerPolicy": {
        "mode": "auto",
        "preferred": "solver",
        "allowLlmFallback": true,
        "requireDeterministicFulfillment": true
      }
    }
  },
  "options": {
    "engine": "z3",
    "params": {
      "encoding": "weighted-csp-v1"
    }
  }
}
```

Expected solver result shape:

```json
{
  "schema": "agent-kernel/SolverResult",
  "schemaVersion": 1,
  "meta": {
    "id": "solver_res_tick12_actor_mvp",
    "runId": "run_001",
    "createdAt": "2026-03-15T00:00:00.000Z",
    "producedBy": "solver"
  },
  "requestRef": {
    "id": "solver_req_tick12_actor_mvp",
    "schema": "agent-kernel/SolverRequest",
    "schemaVersion": 1
  },
  "status": "sat",
  "model": {
    "decision": {
      "contract": "runtime-decision-v1",
      "decisionKind": "next_move",
      "selectedActionId": "cast_fire_bolt_def_a",
      "selectedTargetId": "def_a",
      "confidence": 0.94,
      "rationaleTags": [
        "high_threat_target",
        "safe_attack_window"
      ]
    }
  }
}
```

Runtime rule:
- if `status = "sat"` and `model.decision.selectedActionId` is valid, runtime enacts the matching candidate `Action`
- if `status = "unsat"`, `unknown`, or `error`, runtime either defers or falls back according to `providerPolicy`

### 4.2 LLM mapping

Transport:
- the same request envelope is transformed into a structured prompt
- raw/parsed IO is captured with `CapturedInputArtifact`
- `payload.requestEnvelope` stores the normalized request envelope
- `payload.responseParsed.decision` stores the normalized decision payload

Recommended capture shape:

```json
{
  "schema": "agent-kernel/CapturedInputArtifact",
  "schemaVersion": 1,
  "meta": {
    "id": "capture_llm_runtime_decision_tick12_actor_mvp",
    "runId": "run_001",
    "createdAt": "2026-03-15T00:00:00.000Z",
    "producedBy": "runtime"
  },
  "source": {
    "adapter": "llm",
    "requestId": "llm_decision_tick12_actor_mvp",
    "request": {
      "model": "qwen2.5:7b",
      "baseUrl": "http://localhost:11434"
    }
  },
  "contentType": "application/json",
  "payload": {
    "phase": "execute",
    "prompt": "...",
    "requestEnvelope": {
      "contract": "runtime-decision-v1",
      "decisionKind": "next_move",
      "tick": 12,
      "actor": { "id": "actor_mvp" },
      "candidateActions": [
        { "id": "move_east" },
        { "id": "move_south" },
        { "id": "cast_fire_bolt_def_a" }
      ],
      "providerPolicy": {
        "mode": "llm",
        "preferred": "llm",
        "allowLlmFallback": false,
        "requireDeterministicFulfillment": false
      }
    },
    "responseRaw": "{\"decision\":{\"contract\":\"runtime-decision-v1\",\"decisionKind\":\"next_move\",\"selectedActionId\":\"cast_fire_bolt_def_a\"}}",
    "responseParsed": {
      "decision": {
        "contract": "runtime-decision-v1",
        "decisionKind": "next_move",
        "selectedActionId": "cast_fire_bolt_def_a",
        "selectedTargetId": "def_a",
        "confidence": 0.82,
        "rationaleTags": [
          "focus_weakened_defender",
          "preserve_stamina"
        ]
      }
    }
  }
}
```

LLM response rules:
- no free-form answer without a machine-readable decision object
- `responseParsed.decision.selectedActionId` must match a supplied candidate action
- invalid or ambiguous responses must not be enacted directly

## 5) Provider Selection Policy

Canonical policy for `providerPolicy.mode = "auto"`:

1. Use `solver` when all of the following are true:
   - candidate actions are enumerated
   - objectives/constraints are present
   - the decision can be scored or constrained deterministically
2. Use `llm` when any of the following are true:
   - the request explicitly asks for narrative or heuristic interpretation
   - candidate actions are incomplete and require semantic generation
   - the request is advisory/live and deterministic fulfillment is not required
3. If solver returns `unsat`, `unknown`, or `error`:
   - fall back to `llm` only when `allowLlmFallback` is true
   - otherwise return deferred/error and do not silently guess

Operational rule:
- solver is the authoritative execution-time reasoning path
- llm is structured, capture-aware, and local-first

## 6) Runtime Fulfillment Rules

### Deterministic execution-safe

- solver-backed reasoning fulfilled through the existing solver port/adapter path
- llm-backed reasoning only when a deterministic capture/source reference already exists

### Deferred / post-execution

- live Ollama calls made during runtime with no pre-captured response
- any reasoning path that depends on external IO during `phase = "execute"`

### Explicit manual-play exception

- live local Ollama may be used only when provider policy explicitly opts into `liveLlmMode = "manual_nondeterministic"`
- that mode is intentionally non-deterministic and therefore must not be treated as replay-safe deterministic fulfillment
- default/runtime-safe policy remains `liveLlmMode = "deferred_only"`
- implementation status:
  - actor gameplay emits the same `solver_request` transport for manual live LLM mode,
  - tick orchestration fulfills it through the configured local LLM adapter,
  - the prompt/response pair is recorded as `CapturedInputArtifact`,
  - the chosen action is normalized and enacted on the existing runtime action rail

This matches the current Moderator/runtime contract:
- deterministic effects may be fulfilled during execution
- IO-bound effects must be deferred and captured for replay

## 7) Tactical Example: Two Visible Defenders

Scenario:
- attacker sees `def_a` and `def_b`
- `def_a` is weaker but close to a trap
- attacker has enough mana for one cast

Expected solver-first flow:
1. runtime constructs the `runtime-decision-v1` request envelope
2. runtime emits a `solver_request` effect with a `SolverRequest`
3. `SolverRequest.problem.data` carries the envelope
4. solver returns `SolverResult.model.decision.selectedActionId`
5. runtime validates the selected action against the candidate set
6. runtime enacts the matching `Action`
7. fulfillment is recorded in existing effect/tick-frame artifacts

Expected llm fallback flow:
1. fallback is allowed by `providerPolicy`
2. runtime builds an LLM prompt from the same envelope
3. raw/parsed IO is captured as `CapturedInputArtifact`
4. `payload.responseParsed.decision` is validated against the candidate set
5. runtime enacts the selected `Action`
6. if the LLM call was live and uncaptured during execute, fulfillment must be deferred unless the request is explicitly running in manual non-deterministic mode

## 8) Implementation Notes

Recommended implementation order:
1. do not add new top-level runtime decision artifact schemas
2. standardize `runtime-decision-v1` as an embedded payload contract
3. extend solver request builders so `SolverRequest.problem.data` carries the request envelope
4. extend solver result normalization so `SolverResult.model.decision` is the normalized output
5. extend LLM capture builders so captures store:
   - `payload.requestEnvelope`
   - `payload.responseParsed.decision`
6. add runtime normalization that converts either provider payload into a validated `Action`
7. add replay/inspect coverage using existing fulfilled-effect, capture, and tick-frame artifacts
8. keep live Ollama runtime disabled by default; allow it only behind explicit manual non-deterministic policy

Implementation constraints:
- do not create a second runtime reasoning transport beside `solver_request`, `SolverRequest`, `SolverResult`, and `CapturedInputArtifact`
- do not parse free-form model prose directly into gameplay behavior
- do not permit live external IO during deterministic execution unless it is already captured and replayable
- do not treat manual local-live Ollama runtime decisions as deterministic or replay-equivalent
