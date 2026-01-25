# RUNME: Ollama Prompt -> Runtime Playback

This cheatsheet shows the fastest path from an Ollama prompt to cycling the Runtime playback in the UI.

## Prereqs
- Ollama running locally (default: http://localhost:11434)
- If you want builds from the UI, a local bridge that runs `ak.mjs build --spec`

## 1) Serve the UI
```
pnpm run serve:ui
```
Open: `http://localhost:8001/packages/ui-web/index.html`

## 2) Prompt Ollama (BuildSpec)
Orchestrator tab -> **Ollama Prompt**
- Mode: `live`
- Model: `llama3.2`
- Base URL: `http://localhost:11434`
- Options: `{"temperature":0,"top_p":1}`
- Prompt: describe the level (size, rooms, actors).

Click **Run Prompt**.
- If valid, the BuildSpec JSON auto-populates the Build Orchestration panel.

## 3) Build artifacts (bridge)
Orchestrator tab -> **Build Orchestration**
- Click **Run Build**.

Expected outputs (default):
- `artifacts/runs/<runId>/build/manifest.json`
- `artifacts/runs/<runId>/build/bundle.json`
- `artifacts/runs/<runId>/build/telemetry.json`

If you do not have a bridge:
- Use the fixture bundle (prebuilt artifacts) instead of running the build.
- In Bundle Review, pick:
  - `tests/fixtures/ui/build-spec-bundle/bundle.json`
  - (optional) `tests/fixtures/ui/build-spec-bundle/manifest.json`
- Then click **Run in Runtime** to see the layout and actors from the fixture.

## 4) Load the bundle
Orchestrator tab -> **Bundle Review**
- Click **Load last build** (from the build step), or
- Pick `bundle.json` and optionally `manifest.json`.

You should see schemas, spec, and artifacts.

## 5) Run in Runtime
In **Bundle Review**, click **Run in Runtime**.
- This initializes the core from `SimConfigArtifact` + `InitialStateArtifact`.
- If those artifacts are missing, the UI will warn you.

Now use the Runtime controls:
- **Play/Pause** to cycle the simulation.
- **Step Forward/Back** to move by tick.
- **Reset** to restart the run.

## Troubleshooting
- No layout change: confirm the bundle includes
  - `agent-kernel/SimConfigArtifact`
  - `agent-kernel/InitialStateArtifact`
- BuildSpec contains only high-level hints: add
  - `configurator.inputs.levelGen` (width/height/seed/shape)
  - `configurator.inputs.actors` (id/kind/position/vitals)
- If the BuildSpec is invalid, the UI will show validation errors inline.
