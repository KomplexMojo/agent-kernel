# Changelog

The engine API contract and stability policy are in `docs/engine-api.md`. Entries name changes to the public API (`apiSurface`, `ak`, `ak_*` MCP tools) only.

## Unreleased

### Added
- `docs/engine-api.md`: the public API list and the 0.x stability policy.

### Changed (breaking)
- Renamed agent-kernel to **Agon**. Schema ids are now `agon/<Name>` (was `agent-kernel/<Name>`), packages are `@agon-engine/*` (was `@agent-kernel/*`), the MCP server is `agon-cli`, and the root package is `agon`. No aliases are kept. The `ak` command and `ak_*` MCP tool names are unchanged for now.
