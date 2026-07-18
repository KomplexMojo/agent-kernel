# Vision Contract
Non-negotiables:
- Runs in the browser.
- External services are accessed only via adapters (API boundary).
- Core simulation is deterministic and replayable.
- The persona model is the unit of comprehension: every domain behavior belongs to exactly one
  persona, so a solo developer can describe what each part does and why. Code that cannot be
  described this way is misplaced.

Basic Adapters are in place for:
- Blockchain anchoring, IPFS, Chainlink integrations (adapters later).
- Multi-persona orchestration layers.
