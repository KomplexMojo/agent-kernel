# Actor Persona

Actors are the foundational building blocks of the simulation.

An **actor** represents any entity that exists in the world. Actors may be:

- **Stationary**: forming surfaces and structures such as terrain, walls, floors, or props.
- **Ambulatory**: capable of movement and action, participating actively in the simulation.

This document focuses on the **Actor persona** as a decision-making and behavior construct. Detailed simulation rules and physics are documented separately in the `core-as` README.

---

## Persona Scope

The Actor persona is responsible for **deciding what to do**, not for enforcing what happens.

At a high level, the Actor persona:
- Consumes observations produced by the simulation.
- Determines intent and selects actions.
- Submits chosen actions to the simulation runner.

The simulation core (`core-as`) remains the sole authority on legality, state transitions, and outcomes.

---

## Ambulatory Behavior and Motivations

Ambulatory actors express behavior through **stackable Motivations**.

A Motivation is a policy layer that can influence or propose an action based on the current observation. By layering motivations, simple behaviors can be composed into increasingly goal-oriented behavior.

Examples of motivation stacks include:

- baseline movement → exploration → find_exit
- baseline movement → defend_exit
- idle → investigate_noise → pursue_target

Motivations are:
- Ordered and composable.
- Evaluated outside the simulation core.
- Explicit and inspectable, enabling debugging and experimentation.

---

## Decision-Making Model

The Actor persona follows a simple loop:

1. Receive an observation.
2. Evaluate active motivations.
3. Resolve motivations into a proposed action.
4. Submit the action to the simulation runner.

How motivations are resolved (priority, scoring, veto, etc.) is an implementation detail of the Actor persona and may evolve over time.

---

## Determinism and Replay

To support deterministic replay and analysis:

- Actor decisions are treated as explicit artifacts.
- Chosen actions can be recorded independently of how they were produced.
- The same sequence of actions applied to the same simulation state will always yield the same outcome.

This allows actors driven by humans, scripts, heuristics, or AI models to be replayed and compared on equal footing.

---

## Architectural Intent

Cross-persona artifacts live in `packages/runtime/src/contracts/artifacts.ts`. Actor state-machine
inputs/outputs belong in `packages/runtime/src/personas/actor/contracts.ts`.

This separation ensures that:

- Actor behavior can evolve rapidly without destabilizing the simulation core.
- Advanced decision-making (including AI-driven policies) can be introduced without violating architectural boundaries.
- The Actor persona remains focused on **intent and choice**, not simulation mechanics.

Actors are therefore modeled as **decision-makers layered on top of a deterministic simulation**, with responsibilities placed deliberately to support long-term evolution and experimentation.
