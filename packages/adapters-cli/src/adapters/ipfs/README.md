# IPFS Adapter (CLI)

Purpose: fetch artifacts from IPFS via an HTTP gateway for CLI workflows.

## How it fits

This is a Node/CLI adapter for loading external artifact payloads. It is useful around orchestration, budgeting, and persistence workflows, but simulation execution stays deterministic because any externally loaded data must be captured as artifacts before it influences a run.

This adapter:
- Builds gateway URLs for IPFS CIDs.
- Fetches text or JSON payloads using Node's fetch.

It is intended for Orchestrator/Allocator tooling and never used inside `core-ts`.

## Usage

```js
import { createIpfsAdapter } from "./index.js";

const ipfs = createIpfsAdapter({ gatewayUrl: "https://ipfs.io/ipfs" });
const payload = await ipfs.fetchJson("bafy...");
```

## Configuration

- `gatewayUrl` (default: `https://ipfs.io/ipfs`)
- `fetchFn` (default: `globalThis.fetch`)
