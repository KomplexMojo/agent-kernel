# Blockchain Adapter (CLI)

Purpose: query blockchain state (e.g., balances) from CLI tools via JSON-RPC.

This adapter:
- Provides a minimal JSON-RPC client.
- Exposes `getBalance` and `getChainId` helpers.

It is intended for Orchestrator/Allocator tooling and never used inside `core-as`.

## Usage

```
import { createBlockchainAdapter } from "./index.js";

const blockchain = createBlockchainAdapter({ rpcUrl: "https://rpc.example" });
const chainId = await blockchain.getChainId();
const balance = await blockchain.getBalance("0xabc");
```

## Configuration

- `rpcUrl` (required)
- `fetchFn` (default: `globalThis.fetch`)
