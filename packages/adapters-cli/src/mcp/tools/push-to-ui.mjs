/**
 * ak_push_to_ui MCP tool (formerly ak_sandbox_push_ui)
 *
 * Compiles an inline BuildSpec into a gameplay bundle and pushes it to any
 * connected browser UI via the sandbox bridge WebSocket server.
 */

import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHandlerTool } from "./shared.mjs";
import { compileBuildSpecToGameplayBundle } from "../../cli/ak-impl.mjs";
import {
  getSandboxBridgeState,
  pushGameplayBundle,
} from "../bridge-server.mjs";

const DEFAULT_BRIDGE_PORT = Number(process.env.AK_SANDBOX_BRIDGE_PORT) || 38487;

// Canonical UI entry served for the bridge workflow (M3). index.html / index_l.html
// remain available via serve-ui.mjs --entry but are not the default.
const UI_ENTRY = "index_c.html";
// push-to-ui.mjs lives at packages/adapters-cli/src/mcp/tools/ — five levels below the repo root.
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../..");

function makeMessageId() {
  return `msg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

function canonicalUiUrl() {
  const host = process.env.AK_UI_HOST || "127.0.0.1";
  const port = Number(process.env.AK_UI_PORT) || 8001;
  return `http://${host}:${port}/packages/ui-web/${UI_ENTRY}`;
}

function platformOpenCommand(url) {
  if (process.platform === "darwin") return ["open", [url]];
  if (process.platform === "win32") return ["cmd", ["/c", "start", "", url]];
  return ["xdg-open", [url]];
}

/**
 * Best-effort: ensure the canonical UI is being served and open it in the default
 * browser. Side effects are skipped when AK_DISABLE_UI_LAUNCH=1 (tests, headless CI).
 * Always returns the canonical URL so callers can surface it regardless.
 */
async function launchCanonicalUi() {
  const url = canonicalUiUrl();
  const out = { url, entry: UI_ENTRY, opened: false, serverSpawned: false };
  if (process.env.AK_DISABLE_UI_LAUNCH === "1") return out;

  // Spawn serve-ui on the canonical entry only if nothing is answering /health.
  try {
    const health = await fetch(new URL("/health", url)).catch(() => null);
    if (!health || !health.ok) {
      const child = spawn(
        process.execPath,
        ["scripts/serve-ui.mjs", "--entry", UI_ENTRY],
        {
          cwd: REPO_ROOT,
          env: { ...process.env, PORT: String(Number(process.env.AK_UI_PORT) || 8001) },
          stdio: "ignore",
          detached: true,
        },
      );
      child.unref();
      out.serverSpawned = true;
    }
  } catch {
    /* best-effort — a failed probe/spawn must not fail the push */
  }

  // Open the default browser at the canonical URL.
  try {
    const [cmd, args] = platformOpenCommand(url);
    const child = spawn(cmd, args, { stdio: "ignore", detached: true });
    child.unref();
    out.opened = true;
  } catch {
    out.opened = false;
  }
  return out;
}

export const pushToUiTools = [
  createHandlerTool({
    name: "ak_push_to_ui",
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
            "Inline BuildSpec artifact to compile. Must conform to agent-kernel/BuildSpec schema. " +
            "If omitted, the tool returns an error (future: use current sandbox state).",
        },
        targetTab: {
          type: "string",
          enum: ["design", "gameplay", "preview"],
          description:
            "Which UI tab to activate after loading. 'preview' shows the bundle summary + actor " +
            "list (DOM); 'gameplay' renders the run. Defaults to 'gameplay'.",
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
        openBrowser: {
          type: "boolean",
          description:
            "When true, serve the canonical index_c.html UI (if not already up) and open it in the " +
            "default browser, then pre-stage the bundle so it loads as soon as the UI connects. " +
            "Implies requireClient: false. Defaults to false.",
          default: false,
        },
      },
      // D5: buildSpec is no longer marked required — missing buildSpec returns a structured error
    },

    async handler({ buildSpec, targetTab = "gameplay", requireClient = true, correlationId, openBrowser = false }) {
      // D5: structured error when buildSpec is omitted (future: use current sandbox state)
      if (!buildSpec || typeof buildSpec !== "object") {
        return {
          ok: false,
          error: "MISSING_BUILD_SPEC",
          message:
            "buildSpec is required. " +
            "Automatic use of current sandbox state is not yet implemented.",
        };
      }

      const state = getSandboxBridgeState();

      // D6: surface bridge startup failure
      if (state.startFailed) {
        return {
          ok: false,
          error: "SANDBOX_BRIDGE_START_FAILED",
          message:
            "The sandbox bridge server failed to start (port may be in use). " +
            `Check port ${DEFAULT_BRIDGE_PORT} and restart the MCP server.`,
          bridge: { port: DEFAULT_BRIDGE_PORT, connectedClients: 0, startFailed: true },
        };
      }

      // openBrowser launches a fresh UI, so there is no connected client yet: pre-stage instead.
      const effectiveRequireClient = openBrowser ? false : requireClient;
      if (effectiveRequireClient && state.connectedClients === 0) {
        return {
          ok: false,
          error: "SANDBOX_UI_NOT_CONNECTED",
          message:
            "No browser UI is connected to the sandbox bridge. " +
            "Open the UI dev server and ensure the bridge client is running, or set requireClient: false to pre-stage the bundle.",
          bridge: { port: DEFAULT_BRIDGE_PORT, connectedClients: 0 },
        };
      }

      // O1: when openBrowser is set, serve + open the canonical UI before pushing so it can
      // connect within the replay window and pick up the pre-staged bundle.
      const ui = openBrowser ? await launchCanonicalUi() : undefined;

      // D1+D2: compile BuildSpec → proper bundle with artifacts[] including InitialStateArtifact
      let bundle;
      try {
        bundle = await compileBuildSpecToGameplayBundle(buildSpec);
      } catch (err) {
        return {
          ok: false,
          error: "BUILD_FAILED",
          message: err?.message ?? String(err),
        };
      }

      const SCHEMA_SIM_CONFIG = "agent-kernel/SimConfigArtifact";
      const SCHEMA_RESOURCE_BUNDLE = "agent-kernel/ResourceBundleArtifact";
      const simConfigArtifact = Array.isArray(bundle.artifacts)
        ? bundle.artifacts.find((a) => a?.schema === SCHEMA_SIM_CONFIG)
        : null;
      const resourceBundleArtifact = Array.isArray(bundle.artifacts)
        ? bundle.artifacts.find((a) => a?.schema === SCHEMA_RESOURCE_BUNDLE)
        : null;

      const messageId = makeMessageId();
      const envelope = {
        type: "ak.gameplayBundle.v1",
        id: messageId,
        ...(correlationId ? { correlationId } : {}),
        createdAt: new Date().toISOString(),
        targetTab,
        payload: {
          // D1: send full bundle shape { spec, artifacts[] } — not bare { simConfig, resourceBundle }
          bundle,
          source: { tool: "ak_push_to_ui" },
        },
      };

      const { deliveredClientIds, timedOutClientIds } = await pushGameplayBundle(envelope);

      return {
        ok: true,
        ...(correlationId ? { correlationId } : {}),
        ...(ui ? { ui } : {}),
        bridge: {
          port: DEFAULT_BRIDGE_PORT,
          connectedClients: state.connectedClients,
          deliveredClientIds,
          timedOutClientIds,
        },
        bundle: {
          simConfigArtifactId: simConfigArtifact?.meta?.id ?? null,
          resourceBundleArtifactId: resourceBundleArtifact?.meta?.id ?? null,
          artifactCount: Array.isArray(bundle.artifacts) ? bundle.artifacts.length : 0,
        },
      };
    },
  }),
];
