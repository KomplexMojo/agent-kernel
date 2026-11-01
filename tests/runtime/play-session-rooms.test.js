/**
 * The notebook's input: `view().rooms` lists only the rooms the seat has been near, with what it
 * has seen in each and what of that is done. Unseen rooms and unseen contents are not in it.
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createPlaySession } = require("../../packages/runtime/src/runner/play-session.js");

const dir = path.join(__dirname, "../../packages/ui-ascii/levels");
const read = (name) => JSON.parse(fs.readFileSync(path.join(dir, name), "utf8"));
const level = (name) => ({ simConfig: read(`${name}.sim-config.json`), initialState: read(`${name}.initial-state.json`) });

test("with fog only the room you start in is in the notebook; without it, all three", async () => {
  const fogged = await createPlaySession({ ...level("trap-rooms"), fog: true });
  assert.equal(fogged.view().rooms.length, 1);
  assert.equal(fogged.view().rooms[0].seen, 0);
  const open = await createPlaySession({ ...level("trap-rooms"), fog: false });
  assert.equal(open.view().rooms.length, 3);
});

test("#593: start is marked from turn 1; the exit only once its tile has been seen", async () => {
  const session = await createPlaySession({ ...level("trap-rooms"), fog: true });
  const first = session.view().rooms;
  assert.equal(first.length, 1);
  assert.equal(first[0].start, true);
  assert.ok(first.every((room) => room.exit === false), "no exit before it has been in sight");
  const open = await createPlaySession({ ...level("trap-rooms"), fog: false });
  const all = open.view().rooms;
  assert.equal(all.filter((room) => room.exit).length, 1, "with the whole level known, exactly one room holds the exit");
  assert.equal(all.filter((room) => room.start).length, 1);
});
