# LLM Adapter (Test, Ollama-style)

Purpose: deterministic LLM fixtures for tests without model dependencies.

## How it fits

Use this adapter when a test needs LLM-shaped responses without loading a model or making network calls. The response map is keyed by `model:prompt`, which keeps planner tests deterministic and replayable.

This adapter:
- Returns fixed responses for model/prompt pairs.
- Allows tests to register responses at runtime.

Use this to keep strategy generation deterministic in test runs.

## Usage

```js
import { createLlmTestAdapter } from "./index.js";

const llm = createLlmTestAdapter({
  responses: { "fixture:hello": { model: "fixture", response: "world", done: true } },
});
const reply = await llm.generate({ model: "fixture", prompt: "hello" });
llm.setResponse("fixture", "plan", { model: "fixture", response: "ok", done: true });
```

## Configuration

- `responses` map keyed by `model:prompt`.
