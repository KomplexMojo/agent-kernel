# IPFS Adapter (Test)

Purpose: deterministic IPFS fixtures for tests without network access.

## How it fits

Use this adapter when tests need CID/path lookup behavior without touching an IPFS gateway. Fixtures can be provided up front or registered during the test.

This adapter:
- Returns fixture text/JSON for a CID and optional path.
- Allows tests to register fixtures at runtime.

Use this in tests to keep runs deterministic and replayable.

## Usage

```js
import { createIpfsTestAdapter } from "./index.js";

const ipfs = createIpfsTestAdapter({ fixtures: { bafy123: "{\"ok\":true}" } });
const payload = await ipfs.fetchJson("bafy123");
ipfs.setFixture("bafy456", "{\"ok\":false}");
```

## Configuration

- `fixtures` map keyed by `cid` or `cid:path`.
