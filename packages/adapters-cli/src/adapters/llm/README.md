# LLM Adapter (CLI, Ollama-style)

Purpose: request strategic guidance or content from an LLM HTTP endpoint (Ollama/OpenAI-compatible).

This adapter:
- Calls an Ollama-style `/api/generate` endpoint.
- Returns the raw JSON response for downstream processing.

It is intended for Orchestrator/Director tooling and never used inside `core-as`.

## Usage

```
import { createLlmAdapter } from "./index.js";

const llm = createLlmAdapter({ baseUrl: "http://localhost:11434" });
const response = await llm.generate({ model: "phi4", prompt: "Summarize plan" });
```

## Configuration

- `baseUrl` (default: `http://localhost:11434`)
- `fetchFn` (default: `globalThis.fetch`)
