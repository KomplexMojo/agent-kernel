# Blockchain Adapter (CLI)

Purpose: query blockchain state (e.g., balances) from CLI tools via JSON-RPC.

## How it fits

This is a Node/CLI adapter for external chain IO. Runtime code can ask for blockchain facts through a port, but `core-ts` never imports this adapter and never performs JSON-RPC calls. Use fixture inputs when a test or demo needs deterministic behavior.

This adapter:
- Provides a minimal JSON-RPC client.
- Exposes `getBalance`, `getChainId`, `mintCard`, and `loadMintedCard` helpers.

It is intended for Orchestrator/Allocator tooling and never used inside `core-ts`.

## Usage

```js
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
