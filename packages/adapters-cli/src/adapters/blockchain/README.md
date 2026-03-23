# Blockchain Adapter (CLI)

Purpose: query blockchain state (e.g., balances) from CLI tools via JSON-RPC.

This adapter:
- Provides a minimal JSON-RPC client.
- Exposes `getBalance`, `getChainId`, `mintCard`, and `loadMintedCard` helpers.

It is intended for Orchestrator/Allocator tooling and never used inside `core-as`.

## Usage

```
import { createBlockchainAdapter } from "./index.js";

const blockchain = createBlockchainAdapter({ rpcUrl: "https://rpc.example" });
const chainId = await blockchain.getChainId();
const balance = await blockchain.getBalance("0xabc");
const minted = await blockchain.mintCard({
  owner: "0xabc",
  card: { id: "A-1", type: "delver" },
});
const loaded = await blockchain.loadMintedCard({ tokenId: minted.tokenId });
```

## Configuration

- `rpcUrl` (required)
- `fetchFn` (default: `globalThis.fetch`)
