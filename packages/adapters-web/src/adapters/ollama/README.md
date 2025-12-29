# Ollama Adapter (Web)

Purpose: request strategic guidance or content from an Ollama LLM endpoint.

This adapter:
- Calls the Ollama `/api/generate` endpoint.
- Returns the raw JSON response for downstream processing.

It is intended for Orchestrator/Director workflows and never used inside `core-as`.

## Usage

```
import { createOllamaAdapter } from "./index.js";

const ollama = createOllamaAdapter({ baseUrl: "http://localhost:11434" });
const response = await ollama.generate({ model: "llama3", prompt: "Summarize plan" });
```

## Configuration

- `baseUrl` (default: `http://localhost:11434`)
- `fetchFn` (default: `fetch`)
