import { existsSync } from "node:fs";
import { createHandlerTool, stringSchema } from "./shared.mjs";
import {
  resolveRunDir,
  readMaxTick,
  readCursor,
  writeCursor,
  renderAscii,
  readTickFrame,
} from "../../tick-session.mjs";

async function resolveTickState(runId) {
  const runDir = resolveRunDir(runId);
  if (!existsSync(runDir)) {
    return { error: `run directory not found: ${runId}` };
  }
  const maxTick = await readMaxTick(runDir);
  if (maxTick === null) {
    return { error: `run directory not found or missing tick-frames.json for run: ${runId}` };
  }
  const stored = await readCursor(runDir);
  const tick = stored !== null ? stored.tick : 0;
  return { runDir, tick, maxTick };
}

const tickForwardTool = createHandlerTool({
  name: "ak_tick_forward",
  description:
    "Advance the interactive session cursor forward by one tick for the given run. Returns the previous and new tick positions along with the maxTick boundary.",
  inputSchema: {
    properties: {
      runId: stringSchema("Run ID to advance the session cursor for."),
    },
    required: ["runId"],
  },
  handler: async ({ runId }) => {
    const state = await resolveTickState(runId);
    if (state.error) {
      return { ok: false, command: "tick", action: "forward", runId, error: state.error };
    }
    const { runDir, tick, maxTick } = state;
    if (tick >= maxTick) {
      return {
        ok: false,
        command: "tick",
        action: "forward",
        runId,
        tick,
        maxTick,
        error: `cannot advance past max tick ${maxTick}`,
      };
    }
    const newTick = tick + 1;
    await writeCursor(runDir, runId, newTick, maxTick);
    return {
      ok: true,
      command: "tick",
      action: "forward",
      runId,
      previousTick: tick,
      tick: newTick,
      maxTick,
    };
  },
});

const tickBackwardTool = createHandlerTool({
  name: "ak_tick_backward",
  description:
    "Rewind the interactive session cursor back by one tick for the given run. Returns a structured error when already at tick 0.",
  inputSchema: {
    properties: {
      runId: stringSchema("Run ID to rewind the session cursor for."),
    },
    required: ["runId"],
  },
  handler: async ({ runId }) => {
    const state = await resolveTickState(runId);
    if (state.error) {
      return { ok: false, command: "tick", action: "backward", runId, error: state.error };
    }
    const { runDir, tick, maxTick } = state;
    if (tick <= 0) {
      return {
        ok: false,
        command: "tick",
        action: "backward",
        runId,
        tick: 0,
        maxTick,
        error: "cannot rewind past tick 0",
      };
    }
    const newTick = tick - 1;
    await writeCursor(runDir, runId, newTick, maxTick);
    return {
      ok: true,
      command: "tick",
      action: "backward",
      runId,
      previousTick: tick,
      tick: newTick,
      maxTick,
    };
  },
});

const showStateTool = createHandlerTool({
  name: "ak_show_state",
  description:
    "Return the current dungeon state for the given run at the session cursor tick. Includes an ASCII grid rendered from WASM when the binary is available.",
  inputSchema: {
    properties: {
      runId: stringSchema("Run ID to show the current state for."),
    },
    required: ["runId"],
  },
  handler: async ({ runId }) => {
    const state = await resolveTickState(runId);
    if (state.error) {
      return { ok: false, command: "tick", action: "state", runId, error: state.error };
    }
    const { runDir, tick, maxTick } = state;
    const [ascii, tickFrame] = await Promise.all([renderAscii(runDir), readTickFrame(runDir, tick)]);
    return { ok: true, command: "tick", action: "state", runId, tick, maxTick, ascii, tickFrame };
  },
});

export const tickTools = [tickForwardTool, tickBackwardTool, showStateTool];
