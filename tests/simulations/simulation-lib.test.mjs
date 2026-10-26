// The rule checks the simulation tests rely on, against small hand-built run records.
import {
  IDLE_ATTACKER_LIMIT,
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

// #415: an attacking actor with a hostile in its cast reach must land a cast now and then.
const fighter = (id, alignment, motivations, x) => ({
  id, alignment, position: { x, y: 1 }, lifecycle: "alive", motivations, capabilities: { canMove: true },
  vitals: { health: { current: 10, max: 10, regen: 1 }, mana: { current: 10, max: 10, regen: 1 } },
  affinities: [{ kind: "decay", expression: "pull", stacks: 2 }], activeAffinityKey: "decay:pull",
});

test("an attacker with a hostile in reach that lands no cast for the limit is a violation", () => {
  const attacker = fighter("w-1", "dungeon", ["attacking"], 1);
  const target = fighter("d-1", "external", ["exploring"], 3);
  const idle = { proposed: { "w-1": 1, "d-1": 1 }, accepted: [{ actorId: "d-1", kind: "move" }], actors: [attacker, target] };
  const cast = { ...idle, accepted: [{ actorId: "w-1", kind: "cast_affinity" }] };
  const rules = (ticks) => checkRules({ args: [] }, analyzeRun({ initialState: { actors: [attacker, target] }, frames: frames(ticks) }))
    .filter((v) => v.rule === "idle_attacker");
  expect(rules([...Array(IDLE_ATTACKER_LIMIT - 1).fill(idle), cast, ...Array(IDLE_ATTACKER_LIMIT - 1).fill(idle)])).toEqual([]);
  expect(rules(Array(IDLE_ATTACKER_LIMIT).fill(idle)).map((v) => v.actor)).toEqual(["w-1"]);
});

test("an attacker with nobody hostile in reach, or a non-attacker in reach, is not an idle attacker", () => {
  const attacker = fighter("w-1", "dungeon", ["attacking"], 1);
  const far = fighter("d-1", "external", ["exploring"], 4);
  const ally = fighter("w-2", "dungeon", ["exploring"], 2);
  const holder = fighter("w-3", "dungeon", ["defending"], 5);
  const actors = [attacker, far, ally, holder];
  const analysis = analyzeRun({ initialState: { actors }, frames: frames(Array(IDLE_ATTACKER_LIMIT).fill({ actors })) });
  expect(checkRules({ args: [] }, analysis).filter((v) => v.rule === "idle_attacker")).toEqual([]);
});

test("an attacker whose hostile is in reach but out of its sight (an unlit room) is not an idle attacker", () => {
  const full = (actor) => ({ ...actor, defeatVital: "health", holdings: [],
    capabilities: { canMove: true, canCast: true, canEquip: true, canTake: true, canExit: true, blocksMovement: true, blocksSight: false } });
  const attacker = full(fighter("w-1", "dungeon", ["attacking"], 1));
  const target = full(fighter("d-1", "external", ["exploring"], 3));
  const snapshot = (actors) => ({ dimensions: { width: 5, height: 3 }, terrain: Array(15).fill("floor"), actors });
  const ticks = Array.from({ length: IDLE_ATTACKER_LIMIT }, (_, index) => [
    { tick: index + 1, phaseDetail: "decide", personaActions: [{ actorId: "w-1", kind: "wait" }] },
    { tick: index + 1, phaseDetail: "apply", acceptedActions: [], emittedSnapshot: { view: { registry: snapshot([attacker, target]) } } },
  ]).flat();
  const analysis = analyzeRun({ initialState: { actors: [attacker, target] }, frames: ticks });
  expect(checkRules({ args: [] }, analysis).filter((v) => v.rule === "idle_attacker")).toEqual([]);
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

test("actors a tactic adds beside an authored one are not held to its authored vitals (#400)", () => {
  const minion = delver("a-1_minion_1");
  const scenario = { args: ["--warden", "count=1;id=a;vitals=mana:12:1"] };
  const analysis = analyzeRun({ initialState: { actors: [minion] }, frames: frames([{ actors: [minion] }]) });
  expect(checkRules(scenario, analysis).filter((v) => v.rule === "authored_vitals")).toEqual([]);
});

test("an equipped push or pull that costs more than max mana can never be cast, so it is a violation (#478)", () => {
  // Price is base × intensity × range(range + 1)/2: fire:push 3:3 at base 2 costs 36, against max mana 30.
  const caster = (id, intensity) => ({ ...delver(id), vitals: { mana: { current: 30, max: 30, regen: 3 } },
    affinities: [{ kind: "fire", expression: "push", stacks: 3, intensity }], equippedAffinityKeys: ["fire:push"] });
  const actors = [caster("over-1", 3), caster("fits-1", 2)];
  const analysis = analyzeRun({ initialState: { actors }, frames: frames([{ actors }]), castManaBase: { "fire:push": 2 } });
  expect(checkRules({ args: [] }, analysis).filter((v) => v.rule === "unaffordable_cast"))
    .toEqual([{ rule: "unaffordable_cast", actor: "over-1", detail: "fire:push costs 36, max mana 30" }]);
});

test("without cast prices nothing is judged unaffordable", () => {
  const actor = { ...delver("a-1"), affinities: [{ kind: "fire", expression: "push", stacks: 9, intensity: 9 }], equippedAffinityKeys: ["fire:push"] };
  const analysis = analyzeRun({ initialState: { actors: [actor] }, frames: frames([{ actors: [actor] }]) });
  expect(checkRules({ args: [] }, analysis).filter((v) => v.rule === "unaffordable_cast")).toEqual([]);
});

test("known issues hide their violations and are reported once they stop happening", () => {
  const scenario = { knownIssues: [{ rule: "no_exit", issue: "#1" }, { rule: "silent_actor", actor: "x-1", issue: "#2" }] };
  const { unexpected, fixed } = compareWithKnown(scenario, [{ rule: "no_exit" }, { rule: "refused_streak", actor: "y-1" }]);
  expect(unexpected).toEqual([{ rule: "refused_streak", actor: "y-1" }]);
  expect(fixed).toEqual([{ rule: "silent_actor", actor: "x-1", issue: "#2" }]);
});
