# IPFS Adapter (Web)

Purpose: fetch artifacts from IPFS via an HTTP gateway for browser-based workflows.

This adapter:
- Builds gateway URLs for IPFS CIDs.
- Fetches text or JSON payloads using `fetch`.

It is intended for use by runtime personas (e.g., Orchestrator) and never called by `core-as`.

## Usage

```
import { createIpfsAdapter } from "./index.js";

const ipfs = createIpfsAdapter({ gatewayUrl: "https://ipfs.io/ipfs" });
const payload = await ipfs.fetchJson("bafy...");
```

## Configuration

- `gatewayUrl` (default: `https://ipfs.io/ipfs`)
- `fetchFn` (default: `fetch`)
