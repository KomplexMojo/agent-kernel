# IPFS Adapter (CLI)

Purpose: fetch artifacts from IPFS via an HTTP gateway for CLI workflows.

This adapter:
- Builds gateway URLs for IPFS CIDs.
- Fetches text or JSON payloads using Node's fetch.

It is intended for Orchestrator/Allocator tooling and never used inside `core-as`.

## Usage

```
import { createIpfsAdapter } from "./index.js";

const ipfs = createIpfsAdapter({ gatewayUrl: "https://ipfs.io/ipfs" });
const payload = await ipfs.fetchJson("bafy...");
```

## Configuration

- `gatewayUrl` (default: `https://ipfs.io/ipfs`)
- `fetchFn` (default: `globalThis.fetch`)
