# Adapter Fixtures

These files are deterministic payloads used by adapter tests to avoid network calls.
Use them to stub fetch/RPC responses when testing CLI or web adapters.

## Files
- ipfs-price-list.json: PriceList artifact returned by IPFS adapter tests.
- blockchain-chain-id.json: JSON-RPC chain id result for blockchain adapter tests.
- blockchain-balance.json: JSON-RPC balance result for blockchain adapter tests.
- ollama-generate.json: Ollama /api/generate response payload for adapter tests.
