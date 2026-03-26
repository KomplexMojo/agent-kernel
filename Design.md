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

This project uses **Google Stitch MCP** for AI-assisted UI design and development. Stitch wraps the Stitch API as an MCP (Model Context Protocol) server, allowing AI agents to call it as a tool.

#### Setup Requirements

1. Ensure the `STITCH_API_KEY` environment variable is set (see `.env.example`)
2. The Stitch MCP server is available via: `npx @_davideast/stitch-mcp proxy`
3. Add Stitch to your MCP client configuration:
   ```json
   {
     "mcpServers": {
       "stitch": {
         "command": "npx",
         "args": ["@_davideast/stitch-mcp", "proxy"]
       }
     }
   }
   ```

#### Stitch MCP Tools for Agents

The proxy exposes these high-level tools for coding agents:

1. **`build_site`** - Builds a complete site from a Stitch project by mapping screens to routes
   ```bash
   npx @_davideast/stitch-mcp tool build_site -d '{
     "projectId": "123456",
     "routes": [
       { "screenId": "abc", "route": "/" },
       { "screenId": "def", "route": "/about" }
     ]
   }'
   ```

2. **`get_screen_code`** - Retrieves a screen and downloads its HTML code content
   ```bash
   npx @_davideast/stitch-mcp tool get_screen_code -d '{
     "projectId": "PROJECT_ID",
     "screenId": "SCREEN_ID"
   }'
   ```

3. **`get_screen_image`** - Retrieves a screen and downloads its screenshot as base64
   ```bash
   npx @_davideast/stitch-mcp tool get_screen_image -d '{
     "projectId": "PROJECT_ID",
     "screenId": "SCREEN_ID"
   }'
   ```

4. **`list_screens`** - Lists all screens in a Stitch project
   ```bash
   npx @_davideast/stitch-mcp tool list_screens -d '{
     "projectId": "PROJECT_ID"
   }'
   ```

#### Agent Workflow for UI Development

When working as a UI Designer agent:

1. **Discovery Phase**
   - Use `list_screens` to see available designs in the Stitch project
   - Review screen metadata to understand the UI structure

2. **Code Generation Phase**
   - Use `get_screen_code` to retrieve HTML for specific screens
   - Use `get_screen_image` to see the visual design
   - Adapt the generated HTML to follow this project's architecture:
     - Place UI code in `packages/ui-web/src/`
     - Follow ports & adapters pattern
     - Create fixture-based tests in `tests/ui-web/`

3. **Site Building Phase**
   - Use `build_site` to generate a complete multi-page application
   - Map Stitch screens to application routes
   - Integrate with the existing runtime and adapter layers

#### Best Practices for Stitch-Generated Code

- **Adapt, don't copy**: Stitch generates HTML; adapt it to this project's component structure
- **Maintain boundaries**: Ensure UI code doesn't violate the ports & adapters pattern
- **Test integration**: Generated code must integrate with the runtime via the adapter layer
- **Follow patterns**: Match the style and patterns in existing `packages/ui-web/` components

## References

- Architecture: `docs/architecture-charter.md`
- UI-CLI Parity: `local-codex/ui-cli-parity-matrix.md`
- Implementation Plans: `docs/implementation-plans/ui-primary-flow-redesign.md`
