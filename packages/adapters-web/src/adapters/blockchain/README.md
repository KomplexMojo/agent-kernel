# Blockchain Adapter (Web)

Purpose: query blockchain state (e.g., balances) from the browser via JSON-RPC.

## How it fits

This browser adapter is for UI-hosted workflows that need blockchain facts through the same port boundary as the CLI. It performs browser `fetch` calls and remains outside `core-ts`.

This adapter:
- Provides a minimal JSON-RPC client.
- Exposes `getBalance` and `getChainId` helpers.

It is intended for Orchestrator/Allocator workflows and never used inside `core-ts`.

## Usage

```js
import { createBlockchainAdapter } from "./index.js";

const blockchain = createBlockchainAdapter({ rpcUrl: "https://rpc.example" });
const chainId = await blockchain.getChainId();
const balance = await blockchain.getBalance("0xabc");
```

## Configuration

- `rpcUrl` (required)
- `fetchFn` (default: `fetch`)
