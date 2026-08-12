Target module shape:

```js
export function normalizeProfileSelection(input, profiles) {
  const requested = String(input || "").trim();
  if (!requested) return profiles.primary;
  if (!profiles[requested]) throw new Error(`Unknown profile: ${requested}`);
  return profiles[requested];
}

export function buildEndpoint(host, profile) {
  if (!host || !profile?.port) throw new Error("host and port are required");
  return `http://${host}:${profile.port}`;
}
```

Write tests for valid profile selection, fallback behavior, unknown profiles, and endpoint construction. Prefer `node:assert/strict` and `vitest`.
