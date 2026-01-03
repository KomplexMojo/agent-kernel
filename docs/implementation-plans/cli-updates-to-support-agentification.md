# CLI Agentification Plan

Goal: Make the CLI a first-class, agent-friendly builder that consumes a single JSON spec, emits high-verbosity artifact bundles/telemetry, and publishes a detailed schema catalog for UI loading without running the simulation.

## 1) Build Spec and Contracts
1. [completed] Define a single JSON build spec format with schema validation (structured spec only; agent translates informal prompts into this spec).
   - Requirement: Provide one canonical, agent-facing JSON schema that the CLI and UI can share for build inputs.
   - Behavior details: The agent converts informal prompts into the structured spec; the CLI rejects inputs that fail schema validation and surfaces deterministic, readable errors.
   - Data shape proposal: `BuildSpec` includes meta (id/runId/createdAt/source), intent (goal/tags/hints), optional plan hints, configurator inputs, optional budget inputs (artifact refs or inline), and adapter capture instructions.
   - Defaults: Treat omitted optional sections as empty (no budget, no adapter capture, no plan hints) and require explicit `intent.goal`.
   - Tests: Add fixture-based tests for valid/invalid specs; include negative fixtures under `tests/fixtures/artifacts/invalid` for schema validation failures.
   - Determinism: Validation results are pure; error ordering and messages are stable to support replay and test fixtures.
   - Notes: Schema should align with runtime artifacts in `packages/runtime/src/contracts/artifacts.ts` and be loadable by UI for spec editing/round-trip.
2. [completed] Include agent-friendly fields in the spec (e.g., budget, level size/affinity, room count, actor counts/roles/affinities/motivations).
   - Requirement: Provide a structured, agent-friendly envelope that can represent common prompt-derived inputs without inventing new runtime artifacts.
   - Behavior details: Agent fills optional `intent.hints`, `plan.hints`, and `configurator.inputs` with typed fields; CLI treats these as inputs for downstream personas (Director/Configurator) but keeps them as data-only hints.
   - Data shape proposal: Add a typed `intent.hints` and `configurator.inputs` convention: `budgetTokens`, `levelSize`, `levelAffinity`, `roomCount`, `rooms[]` (affinity/trap), `actors[]` (role, count, affinity, motivation, strength), `actorGroups[]` (boss/subboss etc.).
   - Defaults: Omitted fields imply no preferences; counts default to 0 if omitted; affinities default to "none" when absent.
   - Tests: Add fixtures that exercise these fields and ensure validation passes when they are present (and rejects non-object hints/inputs).
   - Determinism: Treat hints/inputs as declarative data; persona interpretation must be deterministic for a given spec.
   - Notes: Keep these fields in the spec only; do not duplicate into new artifacts unless a persona contract explicitly adopts them later.
3. [completed] Ensure UI and CLI share the same build spec and artifacts so UI can round-trip agent-built settings.
   - Requirement: UI and CLI consume the same build spec schema and emit the same artifact bundle, enabling UI edits of agent-built specs.
   - Behavior details: CLI emits build outputs that the UI can load, edit, and re-run without translation or lossy conversion; UI writes the spec back verbatim after edits.
   - Data shape proposal: BuildSpec remains the canonical input; manifest/bundle reference only runtime artifacts (IntentEnvelope, PlanArtifact, SimConfig, InitialState, Budget artifacts) plus the spec itself.
   - Defaults: UI assumes missing optional sections are empty (no adapter capture, no budget overrides) and preserves unknown fields for forward compatibility.
   - Tests: Add a round-trip fixture test that loads a build spec, serializes it back, and asserts stable shape; include a bundle/manifest fixture for UI to consume.
   - Determinism: JSON serialization order is stable; manifest entries are sorted by schema/id for consistent UI diffing.
   - Notes: Avoid adding UI-only or CLI-only fields to the spec; use shared contracts in `packages/runtime/src/contracts/artifacts.ts`.
4. [completed] Map build spec inputs to existing runtime artifact contracts (IntentEnvelope/PlanArtifact/SimConfig/Budget/Solver artifacts).
   - Requirement: Translate BuildSpec into existing runtime artifacts without inventing new execution paths or contracts.
   - Behavior details: CLI constructs IntentEnvelope from spec.intent, PlanArtifact from plan hints, feeds Configurator inputs for SimConfig/InitialState, and attaches budget artifacts/refs when provided; solver artifacts use existing request/result schemas.
   - Data shape proposal: Maintain a one-way mapping table from BuildSpec fields to artifact fields, with optional passthrough for `hints`/`inputs` and explicit references for budget/plan/simConfig.
   - Defaults: Missing sections skip those artifacts; budget refs override inline budget inputs when both appear.
   - Tests: Add mapping tests that assert generated artifacts use expected schemas/refs and that optional fields are preserved as hints.
   - Determinism: Mapping is pure and deterministic; metadata (ids/runId/createdAt) derived from spec or provided overrides.
   - Notes: Keep mapping in adapters/runtime boundary (CLI) and do not move conversion into `core-as`.
5. [completed] Add a captured-input artifact contract for external adapter payloads.
   - Requirement: Define a runtime artifact for storing external adapter payloads (IPFS/blockchain/LLM) as immutable inputs.
   - Behavior details: CLI writes captured payloads as artifacts with schema + meta; downstream personas reference them via ArtifactRef without re-fetching.
   - Data shape proposal: `CapturedInputArtifact` includes `source` (adapter id), optional `request` metadata, `contentType`, and `payload` or `payloadRef`.
   - Defaults: When content is JSON, store `payload` inline; large/binary inputs use `payloadRef` with a file path or artifact ref.
   - Tests: Add fixtures for JSON and non-JSON payloads, plus validation tests that enforce schema/version and required fields.
   - Determinism: Payloads are captured verbatim; no normalization or transformation after capture.
   - Notes: Keep adapters as the only IO boundary; core-as never reads these artifacts directly.

## 2) Build Command Orchestration
1. [completed] Add an agent-only `build` CLI command that accepts `--spec` only (no human-friendly flags).
   - Requirement: Provide a single, agent-facing CLI entrypoint that only accepts a JSON spec path.
   - Behavior details: `build` reads and validates the BuildSpec, rejects all other flags, and writes outputs to the standard artifacts directory with a deterministic layout.
   - Data shape proposal: Input is `BuildSpec`; output includes emitted artifacts plus manifest/bundle/telemetry references.
   - Defaults: If `--out-dir` is omitted, use the standard `artifacts/build_<timestamp>` pattern; no implicit defaults beyond spec validation.
   - Tests: Add CLI tests that assert `build` rejects unknown flags and accepts only `--spec`.
   - Determinism: Deterministic error messages and output file naming (seeded by spec/run id).
   - Notes: `build` is agent-only; humans should use the UI or fixture-based commands.
2. [completed] Orchestrate solve + configurator (+ optional budget) without running core execution.
   - Requirement: Build should invoke the solver + configurator paths to emit artifacts without executing the simulation loop.
   - Behavior details: Build reads the spec, maps intent/plan, optionally runs the solver adapter for plan validation, then runs configurator to emit SimConfig/InitialState and optional budget receipt.
   - Data shape proposal: Reuse SolverRequest/SolverResult and Configurator artifacts; outputs are stored alongside the build spec in the out-dir.
   - Defaults: If no solver inputs are provided, skip solver invocation; if budget inputs are missing, skip budget receipt generation.
   - Tests: Add CLI tests that assert no tick frames are emitted and only build artifacts exist in output.
   - Determinism: Solver invocations must be fixture-driven unless explicit adapter capture is requested; configurator output is deterministic for a given spec.
   - Notes: Keep core execution (`run`) out of this path; build is artifact generation only.
3. [completed] Use the preferred output directory pattern for build artifacts.
   - Requirement: Build outputs follow a deterministic, discoverable directory naming scheme.
   - Behavior details: `build` writes under `artifacts/build_<runId>` by default and never reuses paths unless explicitly provided.
   - Data shape proposal: Directory contains `spec.json`, mapped artifacts, and build outputs (solver/configurator), with manifest/bundle added later.
   - Defaults: If `--out-dir` is provided, it overrides the default pattern.
   - Tests: Add CLI tests that default to `artifacts/build_<runId>` and ensure outputs land there.
   - Determinism: Output path is derived from the spec runId; no timestamps.
   - Notes: Align with UI expectations for predictable asset discovery.
4. [completed] Drive existing runtime persona controllers/adapters (no parallel pipeline) so UI + CLI share the same execution path.
   - Requirement: CLI build orchestration uses the same runtime persona logic and adapter ports as the UI.
   - Behavior details: Build should call runtime controllers (Director/Configurator/Allocator) where available, and use adapter ports for solver/external facts; avoid bespoke CLI-only flows.
   - Data shape proposal: Inputs/outputs stay in runtime contracts; CLI acts as a driver that wires artifacts into persona controllers.
   - Defaults: Prefer fixture adapters for deterministic runs unless explicit external capture is requested.
   - Tests: Add integration tests that run through persona controllers and assert artifacts match fixture expectations.
   - Determinism: Persona controller outputs must be deterministic for the same inputs; adapters are fixture-based by default.
   - Notes: Keep CLI as an adapter layer; do not move persona logic into the CLI.

## 3) Agent Outputs and Telemetry
1. [completed] Emit `manifest.json` with schema refs, file paths, and correlation metadata.
   - Requirement: Emit a deterministic manifest that enumerates build outputs with schema refs and file paths.
   - Behavior details: Build writes `manifest.json` alongside artifacts, including spec path, runId, source, and a sorted list of artifact entries.
   - Data shape proposal: Manifest entries include `id`, `schema`, `schemaVersion`, and `path`; top-level includes `specPath` and `correlation` (runId/source/correlationId).
   - Defaults: Only include artifacts that were actually emitted; omit absent optional artifacts.
   - Tests: Add CLI tests that assert manifest entries match emitted files and are sorted by schema/id.
   - Determinism: Manifest ordering and paths are stable for a given spec/runId.
   - Notes: Use the manifest fixture shape already in `tests/fixtures/ui/build-spec-bundle/manifest.json` as the reference.
2. [completed] Emit `bundle.json` with inlined artifacts and full verbosity by default.
   - Requirement: Provide a single bundle file that inlines all emitted artifacts for UI/agent consumption.
   - Behavior details: Build writes `bundle.json` containing the BuildSpec and all emitted artifacts (intent/plan/solver/configurator/budget).
   - Data shape proposal: `{ spec, artifacts: [...] }` where artifacts are full JSON objects matching runtime schemas.
   - Defaults: Bundle includes every artifact emitted during the build (no filtering unless an explicit flag is added later).
   - Tests: Add CLI tests that assert bundle contents match files on disk and align with manifest entries.
   - Determinism: Bundle artifacts are ordered by schema/id for stable diffs.
   - Notes: Use the existing UI bundle fixture shape as guidance.
3. [completed] Emit `telemetry.json` for both success and failure using annotator-style records.
   - Requirement: Build emits annotator-style telemetry records for both success and failure cases.
   - Behavior details: On success, emit a run-scope TelemetryRecord plus optional summary; on failure, emit a record with error details and any partial artifact refs.
   - Data shape proposal: Use `agent-kernel/TelemetryRecord` with `scope: "run"` and `data` including `status`, `errors`, and `artifactRefs`.
   - Defaults: Always emit `telemetry.json` in the build output dir, even when the build fails early.
   - Tests: Add CLI tests that assert telemetry is written on success and when the build fails due to invalid spec.
   - Determinism: Telemetry content is deterministic for a given spec and error; timestamps derived from spec meta or a fixed clock.
   - Notes: Keep telemetry generation in runtime helpers if possible to align with Annotator conventions.
4. [completed] Enforce deterministic ordering/ids in manifests/bundles/telemetry for replay/UI parity.
   - Requirement: Ensure manifest, bundle, and telemetry outputs are stable across runs for identical specs.
   - Behavior details: Sort manifest/bundle entries by schema/id; telemetry ids/createdAt derive from spec meta rather than wall-clock time.
   - Data shape proposal: Use stable id derivation (spec id + suffix) and fixed createdAt when available.
   - Defaults: If spec meta is missing, fall back to deterministic placeholders (run_unknown / epoch timestamp).
   - Tests: Add tests that run build twice with the same spec and assert identical manifest/bundle/telemetry outputs.
   - Determinism: No timestamps or random ids in these outputs; only spec-derived values.
   - Notes: Keep ordering logic centralized in build output generation.

## 4) Schema Catalog Surface
1. [completed] Generate a detailed schema catalog from runtime contracts.
   - Requirement: Expose a machine-readable catalog of runtime contracts for UI/agent discovery.
   - Behavior details: Catalog is generated from runtime contract definitions and includes schema name, version, and a brief description/fields list where possible.
   - Data shape proposal: `{ generatedAt, schemas: [{ schema, schemaVersion, description?, fields? }] }`.
   - Defaults: Include all runtime artifact schemas; no filtering unless explicitly requested.
   - Tests: Add a runtime test that validates key schemas appear (IntentEnvelope, PlanArtifact, BuildSpec, SimConfig, InitialState, TelemetryRecord).
   - Determinism: Stable ordering (by schema name) and deterministic timestamps (derived from a fixed clock when needed).
   - Notes: Keep catalog generation in runtime to align with UI/CLI shared contracts.
2. [completed] Add a `schemas` CLI command to emit the full catalog for UI discovery.
   - Requirement: Provide a CLI entrypoint that emits the runtime schema catalog.
   - Behavior details: `schemas` prints JSON to stdout or writes `schemas.json` under `--out-dir`.
   - Data shape proposal: Output is the catalog produced by `createSchemaCatalog` (generatedAt + sorted schemas).
   - Defaults: If `--out-dir` is provided, write `schemas.json`; otherwise print to stdout.
   - Tests: Add CLI tests that assert catalog includes key schemas and is sorted.
   - Determinism: Use a fixed clock (spec meta or override) for deterministic `generatedAt` in tests.
   - Notes: Keep this command agent/UI-friendly; avoid extra flags.
3. [completed] Include only referenced schemas in build manifests/bundles.
   - Requirement: Ensure build outputs surface only the schema definitions needed for emitted artifacts.
   - Behavior details: When emitting manifest/bundle, include a `schemas` section (or sidecar file) that lists only the schemas referenced by the artifacts in that output.
   - Data shape proposal: Add `schemas: [{ schema, schemaVersion, description?, fields? }]` derived by filtering the runtime catalog by the manifest/bundle artifact list.
   - Defaults: If no artifacts are emitted beyond the spec, include only `BuildSpec` and any emitted artifacts; do not include the full catalog by default.
   - Tests: Add a build fixture test that asserts `schemas` contains only the artifact schemas present in the manifest/bundle.
   - Determinism: Schema list ordering is stable (by schema name) and produced from the same catalog generator to avoid drift.
   - Notes: Keep schema filtering in runtime/catalog helpers so UI/CLI stay aligned.

## 5) External Adapter Capture
1. [completed] Capture IPFS/blockchain/LLM outputs as artifacts via the build spec using adapter ports (no new IO paths).
   - Requirement: Allow BuildSpec to request adapter fetches (IPFS/blockchain/LLM) and store results as CapturedInputArtifact outputs.
   - Behavior details: Build reads `spec.adapters.capture[]`, invokes the corresponding adapter port with fixture or live inputs, and emits one CapturedInputArtifact per capture request.
   - Data shape proposal: `adapters.capture[]` includes `{ source, request, contentType?, fixturePath?, payloadRef? }`; output artifact uses `CapturedInputArtifact` with `source`, `request`, and `payload` or `payloadRef`.
   - Defaults: If `fixturePath` is supplied, use it for deterministic capture; otherwise require explicit adapter request fields and allow live IO only when configured.
   - Tests: Add fixture-based tests for each adapter source (ipfs/blockchain/llm) and ensure artifacts are emitted + validated.
   - Determinism: Default to fixture capture; payloads are stored verbatim and keyed by spec/meta.
   - Notes: Keep all IO inside adapter ports; CLI should only orchestrate and persist outputs.
2. [completed] Record adapter responses in manifests/bundles with deterministic references.
   - Requirement: Manifest/bundle must expose adapter capture artifacts with stable ids and paths for UI loading.
   - Behavior details: Each CapturedInputArtifact emitted by `build` is included in `manifest.artifacts` (with deterministic path) and in `bundle.artifacts` in the same schema/id ordering as other artifacts.
   - Data shape proposal: Use `captured-input-<adapter>-<index>.json` for output paths unless overridden by `outputRef.id`; manifest entry references the same schema/id as the artifact.
   - Defaults: If capture produces no payload (error), no manifest/bundle entry is emitted; telemetry records the failure.
   - Tests: Add build tests asserting captured artifacts appear in manifest/bundle with stable paths and ids.
   - Determinism: Path naming derives from adapter name + capture index; ids derive from spec meta or `outputRef.id`.
   - Notes: Keep schema filtering aligned so `manifest.schemas`/`bundle.schemas` include `CapturedInputArtifact` when present.

## 6) Tests
1. [completed] Add CLI tests for build spec parsing and artifact emission.
   - Requirement: Validate that the CLI build path parses BuildSpec fixtures and emits expected artifacts.
   - Behavior details: Tests should invoke `ak.mjs build --spec` and assert required output files (spec/intent/plan) plus optional outputs (budget/solver/configurator/captured inputs) for fixture-driven specs.
   - Data shape proposal: Use existing fixtures in `tests/fixtures/artifacts/` and assert schema/id fields for emitted artifacts.
   - Defaults: Skip IO-heavy paths; rely on fixture-backed adapters for deterministic results.
   - Tests: Add coverage for basic spec, budget-inline spec, configurator spec, solver spec, and adapters capture spec.
   - Determinism: Assert stable output shapes/paths across multiple runs.
   - Notes: Keep CLI tests in `tests/adapters-cli/` and avoid touching core-as.
2. [completed] Add tests for manifest/bundle/telemetry output shape and failure capture.
   - Requirement: Assert manifest/bundle/telemetry files match expected schema and are emitted on success/failure.
   - Behavior details: Tests validate `manifest.schemas`, `manifest.artifacts`, `bundle.schemas`, `bundle.artifacts`, and `telemetry` status fields for success; failure tests ensure telemetry exists with error details.
   - Data shape proposal: Reuse manifest/bundle fixtures and validate key fields (`specPath`, `correlation`, artifact refs, telemetry data).
   - Defaults: Failure tests use invalid build spec fixtures to trigger deterministic errors.
   - Tests: Add a dedicated CLI test for invalid spec telemetry + manifest absence/partial capture; add a fixture test for bundle/manifest schema ordering.
   - Determinism: Assert stable ordering and repeatable outputs across runs (no timestamps beyond spec meta).
   - Notes: Keep failure assertions focused on telemetry presence and error contents.
3. [completed] Add tests for schema catalog emission and external adapter capture.
   - Requirement: Ensure schema catalog emission works and adapter capture flows remain deterministic.
   - Behavior details: CLI `schemas` test asserts `generatedAt` and sorted schemas; adapter capture tests verify captured artifacts appear in manifest/bundle with expected payloads.
   - Data shape proposal: Validate catalog entries include key schema names and adapter artifacts match `CapturedInputArtifact` shape.
   - Defaults: Use fixture-backed adapter responses; avoid live IO in tests.
   - Tests: Add a CLI `schemas` test (stdout + `--out-dir`) and build tests for ipfs/blockchain/llm capture artifacts.
   - Determinism: Use fixed clock env for schema catalog and fixture paths for adapter outputs.
   - Notes: Keep schema catalog tests in `tests/adapters-cli/` and reuse existing fixtures when possible.

## 7) Docs
1. [completed] Update CLI README with build spec usage and agent-mode outputs.
   - Requirement: Document the agent-only build command inputs/outputs and adapter capture behavior.
   - Behavior details: README should show `build --spec` usage, deterministic output dir naming, and emitted files (manifest/bundle/telemetry + artifacts).
   - Data shape proposal: Reference `BuildSpec` and `CapturedInputArtifact` schemas and point to fixture examples.
   - Defaults: Emphasize fixture-backed adapters and `AK_ALLOW_NETWORK=1` for live IO.
   - Tests: N/A (documentation only).
   - Determinism: Call out schema list inclusion and sorted outputs for repeatable diffs.
   - Notes: Keep wording aligned with adapter/port boundary rules.
2. [completed] Update docs/README.md with schema catalog and builder workflow notes.
   - Requirement: Surface the schema catalog and the agent/CLI/UI build workflow in the docs index.
   - Behavior details: Add a brief section describing `ak.mjs schemas` output and how a BuildSpec flows through CLI to UI round-trip.
   - Data shape proposal: Mention catalog shape (`generatedAt`, `schemas[]`) and that manifest/bundle include filtered schema lists.
   - Defaults: Use fixture-based examples and offline flow notes.
   - Tests: N/A (documentation only).
   - Determinism: Note schema catalog uses a fixed clock in tests and sorted schema entries.
   - Notes: Keep concise; link to CLI README and fixtures where helpful.
