Create a focused Vitest file for browserless UI wiring helpers.

Cover:
- A minimal document/node stub that supports `querySelector`, `querySelectorAll`, events, and text content.
- A UI wiring function that renders cards into groups.
- Clicking a control updates state and re-renders without browser APIs.
- Missing required elements should produce a clear error or no-op depending on the helper contract.

Use deterministic fake DOM objects. Do not import JSDOM.
