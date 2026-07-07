# LLM Adapter (CLI, Ollama-style)

Purpose: request strategic guidance or content from an LLM HTTP endpoint (Ollama/OpenAI-compatible).

## How it fits

This is a Node/CLI adapter for LLM IO. It can support planning and content generation around a run, but live model output is not part of deterministic core execution unless it has first been captured and replayed as an explicit artifact.

This adapter:
- Calls an Ollama-style `/api/generate` endpoint.
- Returns the raw JSON response for downstream processing.

It is intended for Orchestrator/Director tooling and never used inside `core-ts`.

## Usage

```js
import { createLlmAdapter } from "./index.js";

const llm = createLlmAdapter({ baseUrl: "http://localhost:11434" });
const response = await llm.generate({ model: "phi4", prompt: "Summarize plan" });
```

## Configuration

- `baseUrl` (default: `http://localhost:11434`)
- `fetchFn` (default: `globalThis.fetch`)
