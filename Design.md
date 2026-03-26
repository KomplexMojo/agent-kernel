# Design.md

This file provides design guidance for UI development in this project.

## Design System

### UI Development Tool

This project uses **Google Stitch** for AI-assisted UI design and development.

- Stitch provides design-to-code capabilities through its MCP server
- Access Stitch via the MCP protocol using the `@_davideast/stitch-mcp` package
- API key authentication is configured via the `STITCH_API_KEY` environment variable

### Design Principles

When developing UI components for this project:

1. **Follow the architecture boundaries**: All UI code belongs in `packages/ui-web/` (adapters layer)
2. **Maintain ports & adapters separation**: UI code must not directly access runtime or core-as logic
3. **Use deterministic rendering**: UI should render based on serializable state passed from the runtime
4. **No direct IO**: UI components receive effects and dispatch events; they do not perform IO directly

### UI Component Structure

UI components should follow this pattern:

- **Views** (`packages/ui-web/src/views/`): Top-level view components that coordinate panels and orchestration
- **Panels** (`packages/ui-web/src/`): Individual UI panels for specific features (e.g., budget panels, inspector panels)
- **Templates** (`packages/ui-web/src/`): Reusable template components and utilities

### Testing UI Components

All UI components should have corresponding tests in `tests/ui-web/`:

- Use fixture-based tests for deterministic behavior
- Test view wiring and state transformations, not visual appearance
- Ensure proper integration with the bundle and adapter flow

### Stitch MCP Integration

When using Stitch for UI development:

1. Ensure the `STITCH_API_KEY` environment variable is set (see `.env.example`)
2. Use Stitch's MCP server for design-to-code workflows
3. Reference this file (`Design.md`) when prompting for UI assistance
4. Follow the existing UI patterns in `packages/ui-web/src/` for consistency

## References

- Architecture: `docs/architecture-charter.md`
- UI-CLI Parity: `local-codex/ui-cli-parity-matrix.md`
- Implementation Plans: `docs/implementation-plans/ui-primary-flow-redesign.md`
