# LLM Adapter (Test, Ollama-style)

Purpose: deterministic LLM fixtures for tests without model dependencies.

This adapter:
- Returns fixed responses for model/prompt pairs.
- Allows tests to register responses at runtime.

Use this to keep strategy generation deterministic in test runs.

## Usage

```
import { createOllamaTestAdapter } from "./index.js";

const llm = createOllamaTestAdapter({
  responses: { "fixture:hello": { model: "fixture", response: "world", done: true } },
});
const reply = await llm.generate({ model: "fixture", prompt: "hello" });
llm.setResponse("fixture", "plan", { model: "fixture", response: "ok", done: true });
```

## Configuration

- `responses` map keyed by `model:prompt`.
