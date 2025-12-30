## Documentation Review Plan

Goal: lock down the design, refresh READMEs, and produce a printable Mermaid diagram
stored in the repo.

1. Inventory documentation surfaces.
   - List every README and design doc under `README.md`, `docs/`, and `packages/*/README.md`.
   - Capture current ownership and last-updated notes if present.
   - Inventory (current):
     - Root: `README.md`
     - Docs:
       - `docs/architecture-charter.md`
       - `docs/vision-contract.md`
       - `docs/implementation-plans/completed-structural-setup.md`
       - `docs/implementation-plans/Tests-and-MVP.md`
       - `docs/implementation-plans/testing-inventory.md`
       - `docs/implementation-plans/documentation-review.md`
     - Package READMEs:
       - `packages/adapters-cli/README.md`
       - `packages/adapters-cli/src/adapters/ipfs/README.md`
       - `packages/adapters-cli/src/adapters/blockchain/README.md`
      - `packages/adapters-cli/src/adapters/ollama/README.md`
       - `packages/adapters-web/src/adapters/ipfs/README.md`
       - `packages/adapters-web/src/adapters/blockchain/README.md`
      - `packages/adapters-web/src/adapters/ollama/README.md`
       - `packages/adapters-test/README.md`
       - `packages/adapters-test/src/adapters/ipfs/README.md`
       - `packages/adapters-test/src/adapters/blockchain/README.md`
      - `packages/adapters-test/src/adapters/ollama/README.md`
       - `packages/core-as/assembly/README.md`
       - `packages/core-as/assembly/ports/README.md`
       - `packages/runtime/src/personas/actor/README.md`
       - `packages/runtime/src/personas/allocator/README.md`
       - `packages/runtime/src/personas/annotator/README.md`
       - `packages/runtime/src/personas/configurator/README.md`
       - `packages/runtime/src/personas/director/README.md`
       - `packages/runtime/src/personas/moderator/README.md`
       - `packages/runtime/src/personas/orchestrator/README.md`
   - Ownership/last-updated notes: no explicit doc-level ownership or last-updated metadata found.

2. Define the source-of-truth architecture description.
   - Confirm canonical design decisions (core-as, runtime personas, ports/adapters).
   - Record any open questions that block doc finalization.
   - Confirmed canonical decisions (source: `docs/architecture-charter.md`, `docs/vision-contract.md`, `README.md`):
     - core-as is deterministic, owns canonical state, emits effects/render buffers, and performs no IO.
     - Runtime personas in TypeScript coordinate workflows, phases, telemetry, and adapter selection.
     - All external IO flows through ports/adapters; UI consumes core render buffers via runtime/bindings.
     - Dependency direction: adapters/ui -> runtime -> bindings-ts -> core-as; core-as imports nothing outside itself.
     - Browser-first requirement and adapter-only external services are non-negotiables.
   - Open questions blocking doc finalization: none found in current docs; confirm if any design decisions remain unsettled.

3. Draft the Mermaid architecture diagram.
   - Create `docs/architecture/diagram.mmd` with a single top-level system view.
   - Include core-as, runtime, adapters (web/cli/test), UI, and external services.
   - Ensure diagram is "printable" (avoid tiny text, keep nodes concise).

4. Set documentation storage and references.
   - Keep design foundations in `docs/` (e.g., `docs/architecture-charter.md`,
     `docs/vision-contract.md`) and avoid moving them unless necessary.
   - Add a short "Docs index" section in `docs/README.md` (or create it) that
     links to the charter, vision contract, and architecture diagram.
   - Cross-link from the root `README.md` to the docs index and diagram.

5. Validate diagram accuracy against code.
   - Cross-check each edge with actual module boundaries and entrypoints.
   - Update the diagram to reflect real import/interaction paths.

6. Update README files.
   - Root `README.md`: project intent, quick-start, test/run commands, diagram link.
   - Package READMEs: purpose, how-to-use, local run instructions, config/env.
   - Mark deprecated or duplicate docs to consolidate or remove.

7. Consistency pass.
   - Normalize naming of artifacts, schemas, and CLI flags across docs.
   - Ensure versioning and schema references match `packages/runtime/src/contracts`.

8. Review and sign-off.
   - Walk through the docs as if onboarding a new contributor.
   - Capture final edits needed before merge and tag the plan complete.
   - Onboarding walk-through (notes):
     - Start at `README.md` for intent + quick start, then `docs/README.md` for the doc index.
     - Architecture diagram is reachable at `docs/architecture/diagram.mmd`.
     - Package READMEs include purpose, usage, and configuration defaults.
   - Final edits needed before merge:
     - None blocking. Optional: decide if CLI should route through runtime/bindings; update diagram/docs if the wiring changes.
   - Plan status: complete.
