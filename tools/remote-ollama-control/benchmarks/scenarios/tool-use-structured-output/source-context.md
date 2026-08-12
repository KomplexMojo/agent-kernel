Available tools:

- `remote-ollama-profile start --profile NAME --model MODEL`
- `remote-ollama-profile telemetry --profile NAME --json`
- `remote-ollama-profile status --profile NAME`
- `remote-ollama-profile stop --profile NAME`

The JSON object must include:

- `commands`: array of shell command strings
- `safety_checks`: array of checks
- `expected_endpoint`: string
- `rollback`: string
