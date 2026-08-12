# IPFS Adapter (Web)

Purpose: fetch artifacts from IPFS via an HTTP gateway for browser-based workflows.

## How it fits

This browser adapter loads artifact payloads through an HTTP gateway for UI workflows. Any data that affects deterministic execution should still be represented as captured artifacts before replay.

This adapter:
- Builds gateway URLs for IPFS CIDs.
- Fetches text or JSON payloads using `fetch`.

It is intended for use by runtime personas (e.g., Orchestrator) and never called by `core-ts`.

## Usage

```js
import { createIpfsAdapter } from "./index.js";

const ipfs = createIpfsAdapter({ gatewayUrl: "https://ipfs.io/ipfs" });
const payload = await ipfs.fetchJson("bafy...");
```

## Configuration

- `gatewayUrl` (default: `https://ipfs.io/ipfs`)
- `fetchFn` (default: `fetch`)
