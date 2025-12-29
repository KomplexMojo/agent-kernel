# Blockchain Adapter (Test)

Purpose: deterministic blockchain fixtures for tests without network access.

This adapter:
- Returns fixed balances by address.
- Returns fixed RPC responses by method/params.

Use this in tests to keep budget checks and policies deterministic.

## Usage

```
import { createBlockchainTestAdapter } from "./index.js";

const blockchain = createBlockchainTestAdapter({ balances: { "0xabc": "0x1" } });
const balance = await blockchain.getBalance("0xabc");
blockchain.setResponse("eth_chainId", [], "0x1");
```

## Configuration

- `balances` map keyed by address.
- `responses` map keyed by `method:params`.
