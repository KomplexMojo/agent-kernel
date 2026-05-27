/**
 * M8 — ak_sandbox_push_ui MCP tool
 *
 * Compiles an inline BuildSpec into a gameplay bundle and pushes it to any
 * connected browser UI via the sandbox bridge WebSocket server.
 */

import { createHandlerTool } from "./shared.mjs";
import { compileBuildSpecToGameplayBundle } from "../../cli/ak-impl.mjs";
import {
  getSandboxBridgeState,
  pushGameplayBundle,
} from "../bridge-server.mjs";

const DEFAULT_BRIDGE_PORT = Number(process.env.AK_SANDBOX_BRIDGE_PORT) || 38487;

function makeMessageId() {
  return `msg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

export const sandboxUiTools = [
  createHandlerTool({
    name: "ak_sandbox_push_ui",
    description:
      "Compile a BuildSpec and push the resulting gameplay bundle to the connected browser UI via the sandbox WebSocket bridge. " +
      "The UI will display the Design cards and launch the Gameplay Phaser dungeon automatically. " +
      "Use requireClient: false to pre-stage a bundle before the UI connects.",
    inputSchema: {
      properties: {
        buildSpec: {
          type: "object",
          additionalProperties: true,
          description:
            "Inline BuildSpec artifact to compile. Must conform to agent-kernel/BuildSpec schema. Required.",
        },
        targetTab: {
          type: "string",
          enum: ["design", "gameplay"],
          description: "Which UI tab to activate after loading. Defaults to 'gameplay'.",
          default: "gameplay",
        },
        requireClient: {
          type: "boolean",
          description:
            "When true (default), fail immediately if no browser UI is connected. " +
            "When false, compile and store the bundle for replay when the UI connects.",
          default: true,
        },
        correlationId: {
          type: "string",
          description: "Optional caller-supplied correlation ID echoed back in the result.",
        },
      },
      required: ["buildSpec"],
    },

    async handler({ buildSpec, targetTab = "gameplay", requireClient = true, correlationId }) {
      // Validate buildSpec presence
      if (!buildSpec || typeof buildSpec !== "object") {
        return { ok: false, error: "buildSpec is required and must be an object." };
      }

      const state = getSandboxBridgeState();

      if (requireClient && state.connectedClients === 0) {
        return {
          ok: false,
          error: "SANDBOX_UI_NOT_CONNECTED",
          message:
            "No browser UI is connected to the sandbox bridge. " +
            "Open the UI dev server and ensure the bridge client is running, or set requireClient: false to pre-stage the bundle.",
          bridge: { port: DEFAULT_BRIDGE_PORT, connectedClients: 0 },
        };
      }

      // Compile the BuildSpec → { simConfig, resourceBundle }
      let simConfig, resourceBundle;
      try {
        ({ simConfig, resourceBundle } = await compileBuildSpecToGameplayBundle(buildSpec));
      } catch (err) {
        return {
          ok: false,
          error: "BUILD_FAILED",
          message: err?.message ?? String(err),
        };
      }

      const messageId = makeMessageId();
      const envelope = {
        type: "ak.gameplayBundle.v1",
        id: messageId,
        ...(correlationId ? { correlationId } : {}),
        createdAt: new Date().toISOString(),
        targetTab,
        payload: {
          bundle: { simConfig, resourceBundle },
          source: { tool: "ak_sandbox_push_ui" },
        },
      };

      const { deliveredClientIds, timedOutClientIds } = await pushGameplayBundle(envelope);

      return {
        ok: true,
        ...(correlationId ? { correlationId } : {}),
        bridge: {
          port: DEFAULT_BRIDGE_PORT,
          connectedClients: state.connectedClients,
          deliveredClientIds,
          timedOutClientIds,
        },
        bundle: {
          simConfigArtifactId: simConfig?.meta?.id ?? null,
          resourceBundleArtifactId: resourceBundle?.meta?.id ?? null,
        },
      };
    },
  }),
];
