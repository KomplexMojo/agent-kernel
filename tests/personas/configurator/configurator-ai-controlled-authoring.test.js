/** `ai_controlled` may sit beside any autonomous kind, on any role; never beside `user_controlled`. */
const assert = require("node:assert/strict");

test("authorMotivations accepts ai_controlled beside an autonomous kind and refuses a second controller", async () => {
  const { authorMotivations } = await import("../../../packages/runtime/src/personas/configurator/actor-authoring.js");
  assert.deepEqual(authorMotivations({ role: "warden", index: 0, raw: "defending+ai_controlled" }), ["defending", "ai_controlled"]);
  assert.throws(() => authorMotivations({ role: "warden", index: 0, raw: "ai_controlled+user_controlled" }), /both control/);
});
