# adapters-test — Deterministic Test Adapters

This package contains **adapter implementations** that return deterministic,
fixture-backed responses for tests and replay. It is not a test suite itself.

## Purpose

`adapters-test` exists to provide predictable versions of external IO adapters:
IPFS, blockchain JSON-RPC, and Ollama. Tests can use these adapters to avoid
network calls and to keep runs deterministic.

## How it differs from the top-level `tests/` folder

- `packages/adapters-test`: adapter code (fakes) used by runtime/CLI/UI tests.
- `tests/`: the actual test suite + shared fixtures and helpers.

In other words, `adapters-test` is **runtime code for tests**, while `tests/`
is **where tests live**.

## Usage

```
import { createIpfsTestAdapter } from "./src/adapters/ipfs/index.js";

const ipfs = createIpfsTestAdapter({ fixtures: { bafy123: "{\"ok\":true}" } });
const payload = await ipfs.fetchJson("bafy123");
```

## Configuration

- IPFS: `fixtures` map keyed by `cid` or `cid:path`.
- Blockchain: `balances` and `responses` fixture maps.
- Ollama: `responses` map keyed by `model:prompt`.

## Fixtures under adapters-test

The adapters in this package accept in-memory fixtures or allow tests to
register them at runtime (see `packages/adapters-test/src/adapters/*/index.js`).
If you want to store fixture files on disk, prefer `tests/fixtures/` and load
them in your test before registering with these adapters.

## Included adapters

- IPFS test adapter: returns fixture content for CIDs/paths.
- Blockchain test adapter: returns fixture balances or RPC responses.
- Ollama test adapter: returns fixture responses for model/prompt pairs.
