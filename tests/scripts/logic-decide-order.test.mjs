import { describe, expect, it } from "vitest";
import { isArrayOrderDependent, isOrderDependent, runScenario } from "../../scripts/testing/logic-decide-order.mjs";

// #164 asks whether decide order settles contested tiles, measured before any rule is
// adopted. These pin the harness so its numbers keep meaning something: the Configurator
// normalizes the roster by id (so authoring order is a no-op), a lone actor cannot depend
// on naming, and the contested shape the measurement reports does register.
const role = (id, category, x, y, motivation = "exploring") => ({
  id, category, position: { x, y }, motivations: [motivation], vitals: { health: { current: 6, max: 6, regen: 0 } },
});

describe("decide-order measurement (#164)", () => {
  it("finds the authored array order irrelevant because the roster is normalized by id", async () => {
    const roles = [role("delver_1", "delver", 3, 3), role("delver_2", "delver", 3, 2)];
    expect(await isArrayOrderDependent(roles)).toBe(false);
  });

  it("keys outcomes by role, so renaming a lone actor changes nothing", async () => {
    const roles = [role("delver_1", "delver", 1, 1)];
    expect(await isOrderDependent(roles)).toBe(false);
    expect(await runScenario(roles, { ids: ["actor_a"] })).toEqual(await runScenario(roles, { ids: ["actor_z"] }));
  });

  it("detects a contested approach to the exit settled by who is named first", async () => {
    const roles = [role("delver_1", "delver", 3, 3), role("delver_2", "delver", 3, 2)];
    expect(await isOrderDependent(roles)).toBe(true);
  });
});
