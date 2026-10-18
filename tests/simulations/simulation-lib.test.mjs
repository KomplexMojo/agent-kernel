// The rule checks the simulation tests rely on, against small hand-built run records.
import {
  REFUSED_STREAK_LIMIT,
  SILENT_STREAK_LIMIT,
  analyzeRun,
  checkRules,
  compareWithKnown,
  parseAuthoredVitals,
} from "../../scripts/testing/simulation-lib.mjs";

const delver = (id, motivations = ["attacking"]) => ({
  id, position: { x: 1, y: 1 }, lifecycle: "alive", motivations,
  capabilities: { canMove: true }, vitals: { health: { current: 10, max: 10, regen: 1 }, mana: { current: 10, max: 10, regen: 1 } },
});
const object = (id, x, y) => ({ id, position: { x, y }, lifecycle: "alive", motivations: [], capabilities: { canMove: false },
  vitals: { durability: { current: 1, max: 1, regen: 0 } } });

/** One decide frame and one apply frame per tick, from `[{ proposed: {id: n}, accepted: [{actorId, kind}], actors }]`. */
function frames(ticks) {
  return ticks.flatMap(({ proposed = {}, accepted = [], actors }, index) => [
    { tick: index + 1, phaseDetail: "decide",
      personaActions: Object.entries(proposed).flatMap(([actorId, n]) => Array.from({ length: n }, () => ({ actorId, kind: "cast_affinity" }))) },
    { tick: index + 1, phaseDetail: "apply", acceptedActions: accepted, emittedSnapshot: { view: { registry: { actors } } } },
  ]);
}

test("parses authored vitals in both max:regen and current:max:regen forms", () => {
  expect(parseAuthoredVitals("count=1;vitals=health:30:2,mana:10:30:3;motivation=x")).toEqual({
    health: { max: 30, regen: 2 }, mana: { current: 10, max: 30, regen: 3 },
  });
  expect(parseAuthoredVitals("count=1;motivation=x")).toBeNull();
});

test("a run of refused proposals at the limit is a violation, one short of it is not", () => {
  const actor = delver("a-1");
  const refused = { proposed: { "a-1": 1 }, actors: [actor] };
  const accepted = { proposed: { "a-1": 1 }, accepted: [{ actorId: "a-1", kind: "cast_affinity" }], actors: [actor] };
  const scenario = { args: [] };
  const short = analyzeRun({ initialState: { actors: [actor] }, frames: frames([...Array(REFUSED_STREAK_LIMIT - 1).fill(refused), accepted]) });
  expect(checkRules(scenario, short).map((v) => v.rule)).not.toContain("refused_streak");
  const long = analyzeRun({ initialState: { actors: [actor] }, frames: frames(Array(REFUSED_STREAK_LIMIT).fill(refused)) });
  expect(checkRules(scenario, long).map((v) => v.rule)).toContain("refused_streak");
});

test("a silent mobile actor is a violation; a silent stationary one is not", () => {
  const mover = delver("m-1", ["exploring"]);
  const holder = delver("s-1", ["stationary"]);
  const quiet = Array(SILENT_STREAK_LIMIT).fill({ actors: [mover, holder] });
  const analysis = analyzeRun({ initialState: { actors: [mover, holder] }, frames: frames(quiet) });
  const silent = checkRules({ args: [] }, analysis).filter((v) => v.rule === "silent_actor").map((v) => v.actor);
  expect(silent).toEqual(["m-1"]);
});

test("objects seated touching are a violation; a gap of one tile is not", () => {
  const actors = [object("hazard_1", 2, 2), object("hazard_2", 3, 3), object("hazard_3", 5, 5)];
  const analysis = analyzeRun({ initialState: { actors }, frames: frames([{ actors }]) });
  const touching = checkRules({ args: [] }, analysis).filter((v) => v.rule === "adjacent_objects");
  expect(touching).toEqual([{ rule: "adjacent_objects", actor: "hazard_1", detail: "touches hazard_2" }]);
});

test("authored vitals that the built actor does not keep are a violation", () => {
  const built = delver("a-1");
  const scenario = { args: ["--delver", "count=1;id=a;vitals=health:10:1,mana:12:1"] };
  const analysis = analyzeRun({ initialState: { actors: [built] }, frames: frames([{ actors: [built] }]) });
  const differs = checkRules(scenario, analysis).filter((v) => v.rule === "authored_vitals");
  expect(differs.map((v) => v.detail)).toEqual(['mana authored {"max":12,"regen":1}, built {"current":10,"max":10,"regen":1}']);
});

test("known issues hide their violations and are reported once they stop happening", () => {
  const scenario = { knownIssues: [{ rule: "no_exit", issue: "#1" }, { rule: "silent_actor", actor: "x-1", issue: "#2" }] };
  const { unexpected, fixed } = compareWithKnown(scenario, [{ rule: "no_exit" }, { rule: "refused_streak", actor: "y-1" }]);
  expect(unexpected).toEqual([{ rule: "refused_streak", actor: "y-1" }]);
  expect(fixed).toEqual([{ rule: "silent_actor", actor: "x-1", issue: "#2" }]);
});
