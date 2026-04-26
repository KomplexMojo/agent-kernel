# LLM Suitability Scenarios

These scenarios benchmark whether a local Ollama model can generate useful Vitests for
agent-kernel code. They are used by `/Users/darren/remote-ollama-mac llm-suitability-test`.

Each scenario contains:
- `task.md` — prompt task shown to the candidate model.
- `context.md` — repo conventions and relevant existing-test style.
- `source.js` — source excerpt shown to the candidate model.
- `expected.test.mjs` — manually verified benchmark-oracle test shape.
- `rubric.json` — objective scoring requirements.

The expected tests are not shown to the candidate model. They define the target coverage
shape for scoring and future harness validation.
