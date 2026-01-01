const DIR_MAP = Object.freeze({
  north: 0,
  east: 1,
  south: 2,
  west: 3,
});

const DIR_BY_CODE = Object.freeze({
  0: "north",
  1: "east",
  2: "south",
  3: "west",
});

/**
 * Pack a move action into the bit layout expected by core-as.
 * Fields are masked to keep deterministic size (4-bit coords, 8-bit tick, 4-bit actorId).
 */
export function packMoveAction({ actorId, from, to, direction, tick }) {
  const dirCode = typeof direction === "number" ? direction : DIR_MAP[String(direction).toLowerCase()];
  const actorCode = actorId & 0xf;
  const tickCode = tick & 0xff;
  return (
    ((actorCode & 0xf) << 28) |
    ((tickCode & 0xff) << 20) |
    ((to.y & 0xf) << 16) |
    ((to.x & 0xf) << 12) |
    ((from.y & 0xf) << 8) |
    ((from.x & 0xf) << 4) |
    (dirCode & 0xf)
  );
}

export function unpackMoveAction(value) {
  return {
    direction: DIR_BY_CODE[(value >> 0) & 0xf],
    from: {
      x: (value >> 4) & 0xf,
      y: (value >> 8) & 0xf,
    },
    to: {
      x: (value >> 12) & 0xf,
      y: (value >> 16) & 0xf,
    },
    tick: (value >> 20) & 0xff,
    actorId: (value >> 28) & 0xf,
  };
}

export function renderBaseTiles(core) {
  const width = core.getMapWidth();
  const height = core.getMapHeight();
  const rows = [];
  for (let y = 0; y < height; y += 1) {
    let row = "";
    for (let x = 0; x < width; x += 1) {
      row += String.fromCharCode(core.renderBaseCellChar(x, y));
    }
    rows.push(row);
  }
  return rows;
}

export function renderFrameBuffer(core, { actorIdLabel = "actor_mvp" } = {}) {
  const width = core.getMapWidth();
  const height = core.getMapHeight();
  const rows = [];
  for (let y = 0; y < height; y += 1) {
    let row = "";
    for (let x = 0; x < width; x += 1) {
      row += String.fromCharCode(core.renderCellChar(x, y));
    }
    rows.push(row);
  }
  return {
    tick: core.getCurrentTick(),
    buffer: rows,
    actorPositions: {
      [actorIdLabel]: { x: core.getActorX(), y: core.getActorY() },
    },
  };
}

export function readObservation(core, { actorIdLabel = "actor_mvp" } = {}) {
  return {
    tick: core.getCurrentTick(),
    actor: {
      id: actorIdLabel,
      x: core.getActorX(),
      y: core.getActorY(),
      hp: core.getActorHp(),
      maxHp: core.getActorMaxHp(),
    },
    map: {
      width: core.getMapWidth(),
      height: core.getMapHeight(),
    },
  };
}
