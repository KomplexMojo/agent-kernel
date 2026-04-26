Repo test conventions:
- Use `import assert from "node:assert/strict"` and `import { test } from "vitest"`.
- Prefer fixture/fake adapters over live LLM calls.
- Existing LLM tests assert prompt/response capture and repair behavior without relying on external services.
- Tests should make the control flow obvious: first response invalid, repair prompt issued, second response valid.

Quality target:
- The model should identify that parsing and validation are separate.
- The model should test both response text extraction and repair sequencing.
- Avoid vague tests that only assert the result is truthy.
