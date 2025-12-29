# Blockchain Adapter (Web)

Purpose: query blockchain state (e.g., balances) from the browser via JSON-RPC.

This adapter:
- Provides a minimal JSON-RPC client.
- Exposes `getBalance` and `getChainId` helpers.

It is intended for Orchestrator/Allocator workflows and never used inside `core-as`.

## Usage

```
import { createBlockchainAdapter } from "./index.js";

const blockchain = createBlockchainAdapter({ rpcUrl: "https://rpc.example" });
const chainId = await blockchain.getChainId();
const balance = await blockchain.getBalance("0xabc");
```

## Configuration

- `rpcUrl` (required)
- `fetchFn` (default: `fetch`)
