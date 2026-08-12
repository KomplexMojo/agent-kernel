Repo test conventions:
- UI-web tests commonly use tiny hand-written DOM stubs instead of JSDOM.
- Existing tests model `children`, `dataset`, `className`, `textContent`, `appendChild`,
  `querySelector`, `querySelectorAll`, and `addEventListener`.
- Prefer assertions about rendered state and event effects.
- Avoid testing CSS visuals. Test semantic DOM state and user-observable values.

Quality target:
- The generated test should include a reusable DOM stub.
- The test should prove event handlers are wired by triggering a click/change handler.
- The test should avoid brittle dependence on browser layout.
