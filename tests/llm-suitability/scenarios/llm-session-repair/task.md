Create a focused Vitest file for an LLM session helper that repairs or rejects model output.

Cover:
- Valid JSON extraction from raw text and fenced JSON.
- Rejection of missing required fields.
- A repair path that calls a second prompt builder when the first response fails validation.
- Capture metadata preserving the original prompt and response.

Do not require network or a live LLM. Use small fake adapters.
