# LLM Adapter (Web, Ollama-style)

Purpose: request strategic guidance or content from an LLM HTTP endpoint (Ollama/OpenAI-compatible).

## How it fits

This browser adapter is for UI-hosted planning or guidance flows. It returns raw endpoint responses to downstream runtime code and remains outside deterministic simulation execution unless responses are captured as artifacts.

This adapter:
- Calls an Ollama-style `/api/generate` endpoint.
- Returns the raw JSON response for downstream processing.

It is intended for Orchestrator/Director workflows and never used inside `core-ts`.

## Usage

```js
import { createLlmAdapter } from "./index.js";

const llm = createLlmAdapter({ baseUrl: "http://localhost:11434" });
const response = await llm.generate({ model: "phi4", prompt: "Summarize plan" });
```

## Configuration

- `baseUrl` (default: `http://localhost:11434`)
- `fetchFn` (default: `fetch`)
