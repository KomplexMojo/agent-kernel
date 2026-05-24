import { applyMoveAction, packMoveAction, renderBaseTiles, renderFrameBuffer } from "../../../core-ts/src/index.ts";
import { EIGHT_WAY_DELTAS } from "../personas/_shared/movement-directions.js";

function assertCoreSupportsGrid(core) {
  const required = [
    "getMapWidth",
    "getMapHeight",
    "renderCellChar",
    "renderBaseCellChar",
    "getActorX",
    "getActorY",
    "getCurrentTick",
    "setMoveAction",
  ];
  for (const fn of required) {
    if (typeof core?.[fn] !== "function") {
      throw new Error(`core-ts core is missing ${fn}; check the core-ts export surface and hard-reload the UI.`);
    }
  }
}

function findChar(grid, target) {
  for (let y = 0; y < grid.length; y += 1) {
    const x = grid[y].indexOf(target);
    if (x !== -1) {
      return { x, y };
    }
  }
  return null;
}

function isWalkable(grid, { x, y }) {
  if (y < 0 || y >= grid.length) return false;
  if (x < 0 || x >= grid[y].length) return false;
  const cell = grid[y][x];
  return cell !== "#";
}

function isDiagonalStepAllowed(grid, current, next) {
  const dx = next.x - current.x;
  const dy = next.y - current.y;
  if (Math.abs(dx) !== 1 || Math.abs(dy) !== 1) {
    return true;
  }
  return isWalkable(grid, { x: current.x + dx, y: current.y })
    && isWalkable(grid, { x: current.x, y: current.y + dy });
}

function reconstructPath(cameFrom, endKey) {
  const path = [];
  let current = endKey;
  while (current) {
    const [x, y] = current.split(",").map((n) => Number(n));
    path.unshift({ x, y });
    current = cameFrom[current];
  }
  return path;
}

function shortestPath(grid, start, goal) {
  const startKey = `${start.x},${start.y}`;
  const goalKey = `${goal.x},${goal.y}`;
  const queue = [start];
  const cameFrom = { [startKey]: null };
  const seen = new Set([startKey]);

  while (queue.length > 0) {
    const current = queue.shift();
    const currentKey = `${current.x},${current.y}`;
    if (currentKey === goalKey) {
      return reconstructPath(cameFrom, goalKey);
    }
    for (const delta of EIGHT_WAY_DELTAS) {
      const next = { x: current.x + delta.dx, y: current.y + delta.dy };
      const nextKey = `${next.x},${next.y}`;
      if (seen.has(nextKey) || !isWalkable(grid, next) || !isDiagonalStepAllowed(grid, current, next)) {
        continue;
      }
      seen.add(nextKey);
      cameFrom[nextKey] = currentKey;
      queue.push(next);
    }
  }
  return null;
}

function directionFromDelta(delta) {
  if (delta.dx === 0 && delta.dy === -1) return "north";
  if (delta.dx === 1 && delta.dy === -1) return "northeast";
  if (delta.dx === 1 && delta.dy === 0) return "east";
  if (delta.dx === 1 && delta.dy === 1) return "southeast";
  if (delta.dx === 0 && delta.dy === 1) return "south";
  if (delta.dx === -1 && delta.dy === 1) return "southwest";
  if (delta.dx === -1 && delta.dy === 0) return "west";
  if (delta.dx === -1 && delta.dy === -1) return "northwest";
  return "custom";
}

/**
 * Deterministic movement harness for the MVP map.
 * Uses the bindings helpers to pack move actions and render frames.
 */
export function runMvpMovement({
  core,
  actorIdLabel = "actor_mvp",
  actorIdValue = 1,
  maxTicks = 20,
  seed = 1337,
} = {}) {
  if (!core || typeof core.applyAction !== "function") {
    throw new Error("runMvpMovement requires a core with applyAction.");
  }
  assertCoreSupportsGrid(core);
  if (typeof core.init === "function") {
    core.init(seed);
  }
  if (typeof core.loadMvpScenario === "function") {
    core.loadMvpScenario();
  }
  if (typeof core.clearEffects === "function") {
    core.clearEffects();
  }

  const baseTiles = renderBaseTiles(core);
  const exit = findChar(baseTiles, "E");
  if (!exit) {
    throw new Error("MVP map is missing an exit tile.");
  }

  const frames = [renderFrameBuffer(core, { actorIdLabel })];
  const actions = [];

  for (let i = 0; i < maxTicks; i += 1) {
    const from = { x: core.getActorX(), y: core.getActorY() };
    if (from.x === exit.x && from.y === exit.y) {
      break;
    }
    const path = shortestPath(baseTiles, from, exit);
    if (!path || path.length < 2) {
      break;
    }
    const to = path[1];
    const tick = (typeof core.getCurrentTick === "function" ? core.getCurrentTick() : 0) + 1;
    const packed = packMoveAction({ actorId: actorIdValue, from, to, direction: directionFromDelta({ dx: to.x - from.x, dy: to.y - from.y }), tick });
    applyMoveAction(core, packed);
    const action = {
      schema: "agent-kernel/Action",
      schemaVersion: 1,
      actorId: actorIdLabel,
      tick,
      kind: "move",
      params: {
        direction: directionFromDelta({ dx: to.x - from.x, dy: to.y - from.y }),
        from,
        to,
      },
    };
    actions.push(action);
    if (typeof core.clearEffects === "function") {
      core.clearEffects();
    }
    frames.push(renderFrameBuffer(core, { actorIdLabel }));
  }

  return { actions, frames, baseTiles };
}
