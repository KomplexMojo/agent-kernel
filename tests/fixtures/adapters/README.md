# Adapter Fixtures

These files are deterministic payloads used by adapter tests to avoid network calls.
Use them to stub fetch/RPC responses when testing CLI or web adapters.

## How to use these fixtures

These payloads represent external systems at the adapter boundary. They should stay small, explicit, and stable so tests can verify IPFS, blockchain, LLM, and effect-routing behavior without live services.

Add a new fixture here when a test needs a reusable external response shape. Keep one-off runtime artifacts under `tests/fixtures/artifacts/` instead.

## Files
- ipfs-price-list.json: PriceList artifact returned by IPFS adapter tests.
- blockchain-chain-id.json: JSON-RPC chain id result for blockchain adapter tests.
- blockchain-balance.json: JSON-RPC balance result for blockchain adapter tests.
- blockchain-mint.json: JSON-RPC result payload for `ak_mintCard` blockchain mint tests.
- blockchain-load.json: JSON-RPC result payload for `ak_getMintedCard` blockchain load tests.
- card-config-delver.json: Canonical delver card configuration used as mint input fixture.
- llm-generate.json: LLM (Ollama-style) `/api/generate` response payload for adapter tests.
- effects-routing.json: Effect payloads (log, telemetry, solver_request, need_external_fact) used by adapter/runtime routing tests.
