import { BUILD_SPEC_SCHEMA, BUILD_SPEC_SCHEMA_VERSION } from "../../runtime/src/contracts/build-spec.js";

export const BUILD_SPEC_SCHEMA_SNIPPET = `{
  "schema": "${BUILD_SPEC_SCHEMA}",
  "schemaVersion": ${BUILD_SPEC_SCHEMA_VERSION},
  "meta": {
    "id": "buildspec_id",
    "runId": "run_id",
    "createdAt": "2024-01-01T00:00:00Z",
    "source": "ollama-ui"
  },
  "intent": {
    "goal": "short goal statement",
    "tags": ["optional", "tags"]
  },
  "plan": {
    "hints": {}
  },
  "configurator": {
    "inputs": {
      "levelGen": {
        "width": 5,
        "height": 5,
        "seed": 3,
        "shape": { "profile": "rectangular" },
        "spawn": { "edgeBias": true, "minDistance": 1 },
        "exit": { "edgeBias": true, "minDistance": 1 }
      },
      "actors": [
        {
          "id": "actor_mvp",
          "kind": "ambulatory",
          "position": { "x": 2, "y": 1 },
          "vitals": {
            "health": { "current": 10, "max": 10, "regen": 0 },
            "mana": { "current": 0, "max": 0, "regen": 0 },
            "stamina": { "current": 0, "max": 0, "regen": 0 },
            "durability": { "current": 0, "max": 0, "regen": 0 }
          }
        }
      ],
      "actorGroups": [
        { "role": "boss", "count": 1 }
      ]
    }
  },
  "budget": {
    "budgetRef": { "id": "budget_id", "schema": "agent-kernel/BudgetArtifact", "schemaVersion": 1 },
    "priceListRef": { "id": "price_list_id", "schema": "agent-kernel/PriceList", "schemaVersion": 1 }
  },
  "adapters": {
    "capture": [
      { "adapter": "llm", "request": { "model": "llama3", "prompt": "..." } }
    ]
  }
}`;

export const DEFAULT_PROMPT_TEMPLATE = `You are an agent that returns a single JSON object that conforms to the BuildSpec contract.
- Output JSON only (no markdown fences, no commentary).
- Use schema "${BUILD_SPEC_SCHEMA}" version ${BUILD_SPEC_SCHEMA_VERSION}.
- Required keys: schema, schemaVersion, meta (id, runId, createdAt, source), intent (goal).
- Include configurator.inputs.levelGen and configurator.inputs.actors so the UI can build a new layout.
- actorGroups must be an array of objects; actors and rooms must be arrays when provided.
- budget refs must be objects with id + schema + schemaVersion (or omit budget entirely).
- Keep values concise; omit optional fields you cannot infer.
`;

export function buildBuildSpecPrompt({
  userPrompt,
  template = DEFAULT_PROMPT_TEMPLATE,
  schemaSnippet = BUILD_SPEC_SCHEMA_SNIPPET,
} = {}) {
  const promptText = (userPrompt || "").trim() || "No additional instructions provided.";
  return `${template}\nUser request:\n${promptText}\n\nSchema snippet:\n${schemaSnippet}\n`;
}
