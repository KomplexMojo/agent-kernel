import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = resolve(process.env.AGENT_KERNEL_ROOT || process.cwd());
const CLI = join(ROOT, "packages/adapters-cli/src/cli/ak.mjs");
const OUTPUT_DIR = resolve(
  process.env.AK_BENCHMARK_OUTPUT_DIR || join(ROOT, "tools/benchmark/out"),
);
// Kept as VAULT_DIR for downstream references; output may target the vault or a local dir.
const VAULT_DIR = OUTPUT_DIR;
const ARTIFACT_ROOT = join(VAULT_DIR, "Reference Artifacts");
const CREATED_AT = "2026-05-03T17:00:00.000Z";
const BUDGET = 1500;
// Non-binding ceiling for budget-UNCONSTRAINED scenarios: the builder spends only
// what the scenario requires, so injecting new configuration costs never forces a
// budget bump. Budget-CONSTRAINED scenarios use a tight per-case budgetTokens instead.
const UNCONSTRAINED_BUDGET = 1_000_000;

// Guard: the Codex rescue sandbox cannot write to the Obsidian vault. When syncing
// regenerated output into the vault, run this generator OUTSIDE the sandbox (e.g. by the
// orchestrating Claude/host) with AK_BENCHMARK_OUTPUT_DIR pointed at the vault path.
const VAULT_PREFIX = process.env.AK_BENCHMARK_VAULT_PREFIX || "/Users/darren/Documents/Obsidian/agent-kernel-vault";
const ALLOW_VAULT_WRITE = process.env.AK_BENCHMARK_ALLOW_VAULT_WRITE === "1";

if (!ALLOW_VAULT_WRITE && VAULT_PREFIX && VAULT_DIR.startsWith(VAULT_PREFIX)) {
  throw new Error(
    `Refusing to write benchmark output under the read-only vault path: ${VAULT_DIR}\n` +
    `Set AK_BENCHMARK_ALLOW_VAULT_WRITE=1 to override (only when running outside a write-restricted sandbox).`,
  );
}

const cases = [
  {
    title: "Create Single Delver",
    task: "create a single fire Delver tuned for attack, with explicit fire affinity, mana, stamina, and health settings",
    delver: ["count=1;affinity=fire;motivation=attacking;affinities=fire:emit:2;vitals=health:8:1,stamina:6:1,mana:4:1;goals=max_mana:high,mana_regen:medium"],
  },
  {
    title: "Create Single Warden",
    task: "create a single dark Warden tuned for defense, with explicit dark affinity and durable vitals",
    warden: ["count=1;affinity=dark;motivation=defending;affinities=dark:emit:2;vitals=health:12:1,stamina:4:1,mana:3:1,durability:6:0"],
  },
  {
    title: "Create Small Dark Room",
    task: "create one small dark starter room with a localized dark field",
    room: ["size=small;count=1;affinities=dark:emit:2"],
    dungeonAffinity: "dark",
  },
  {
    title: "Create Floor Tile Starter Room",
    task: "create one small starter room with twelve floor tiles and no actors",
    room: ["size=small;count=1"],
    floorTile: ["count=12"],
  },
  {
    title: "Create Emit Trap Room",
    task: "create a small fire trap room with floor tiles and one non-blocking emit trap",
    room: ["size=small;count=1"],
    floorTile: ["count=16"],
    trap: ["x=2;y=2;affinity=fire;expression=emit;stacks=1;blocking=false"],
    dungeonAffinity: "fire",
  },
  {
    title: "Create Dark Obscuring Trap",
    task: "create a small room with a dark emit trap strong enough to test darkness stack handling",
    room: ["size=small;count=1;affinities=dark:emit:1"],
    floorTile: ["count=16"],
    trap: ["x=2;y=3;affinity=dark;expression=emit;stacks=2;blocking=false"],
    dungeonAffinity: "dark",
  },
  {
    title: "Create Two Exploring Delvers",
    task: "create two water Delvers configured for exploration and sustain",
    delver: ["count=2;affinity=water;motivation=exploring;affinities=water:draw:1;vitals=health:7:1,stamina:7:1,mana:5:1;goals=max_mana:medium,mana_regen:medium"],
    dungeonAffinity: "water",
  },
  {
    title: "Create Mixed Delver Pair",
    task: "create a two-person Delver party with one fire attacker and one life-friendly support Delver",
    delver: [
      "count=1;affinity=fire;motivation=attacking;affinities=fire:push:1;vitals=health:9:1,stamina:6:1,mana:4:1",
      "count=1;affinity=life;motivation=friendly;affinities=life:pull:1;vitals=health:8:2,stamina:5:1,mana:5:1",
    ],
  },
  {
    title: "Create Warden Patrol Pair",
    task: "create two earth Wardens configured for patrol and spatial control",
    warden: ["count=2;affinity=earth;motivation=patrolling;affinities=earth:pull:1;vitals=health:10:1,stamina:6:1,mana:3:1,durability:5:0"],
    dungeonAffinity: "earth",
  },
  {
    title: "Create Delver Versus Warden Arena",
    task: "create a medium arena with one fire Delver, one dark Warden, and a dark emit trap",
    room: ["size=medium;count=1;affinities=dark:emit:1"],
    floorTile: ["count=20"],
    trap: ["x=3;y=3;affinity=dark;expression=emit;stacks=1;blocking=false"],
    delver: ["count=1;affinity=fire;motivation=attacking;affinities=fire:push:1;vitals=health:9:1,stamina:6:1,mana:4:1"],
    warden: ["count=1;affinity=dark;motivation=defending;affinities=dark:emit:2;vitals=health:11:1,stamina:4:1,mana:4:1,durability:6:0"],
  },
  {
    title: "Create Fire Trial Room",
    task: "create a large fire trial room with two emit traps and a water Delver counter-pick",
    room: ["size=large;count=1;affinities=fire:emit:2"],
    floorTile: ["count=24"],
    trap: [
      "x=2;y=2;affinity=fire;expression=emit;stacks=1;blocking=false",
      "x=4;y=4;affinity=fire;expression=emit;stacks=2;blocking=false",
    ],
    delver: ["count=1;affinity=water;motivation=exploring;affinities=water:draw:1;vitals=health:8:1,stamina:7:1,mana:5:1"],
    dungeonAffinity: "fire",
  },
  {
    title: "Create Water Recovery Room",
    task: "create a water-themed recovery encounter with a life support Delver and a water mana hazard",
    room: ["size=medium;count=1;affinities=water:emit:1"],
    floorTile: ["count=18"],
    hazard: ["affinity=water;expression=emit;proximityRadius=2;mana=regen:4:4:1"],
    delver: ["count=1;affinity=life;motivation=friendly;affinities=life:pull:1,water:draw:1;vitals=health:8:2,stamina:5:1,mana:6:1"],
    dungeonAffinity: "water",
  },
  {
    title: "Create Earth Barrier Ambush",
    task: "create an earth ambush room with an earth emit trap and a fortify Warden",
    room: ["size=medium;count=1;affinities=earth:emit:2"],
    floorTile: ["count=18"],
    trap: ["x=3;y=2;affinity=earth;expression=emit;stacks=2;blocking=true"],
    warden: ["count=1;affinity=fortify;motivation=defending;affinities=fortify:emit:2;vitals=health:13:1,stamina:4:1,mana:3:1,durability:8:0"],
    dungeonAffinity: "earth",
  },
  {
    title: "Create Wind Patrol Corridor",
    task: "create two medium wind patrol rooms with a wind Warden and an earth Delver",
    room: ["size=medium;count=2;affinities=wind:emit:1"],
    floorTile: ["count=24"],
    warden: ["count=1;affinity=wind;motivation=patrolling;affinities=wind:push:1;vitals=health:9:1,stamina:7:1,mana:4:1,durability:4:0"],
    delver: ["count=1;affinity=earth;motivation=exploring;affinities=earth:pull:1;vitals=health:9:1,stamina:6:1,mana:4:1"],
    dungeonAffinity: "wind",
  },
  {
    title: "Create Life Shrine Encounter",
    task: "create a life shrine room with a permanent vital regen resource and opposing decay Warden",
    room: ["size=small;count=1;affinities=life:emit:1"],
    floorTile: ["count=14"],
    resource: ["tier=permanent;stat=vitalRegen;delta=1;dropRate=10"],
    delver: ["count=1;affinity=life;motivation=friendly;affinities=life:pull:2;vitals=health:9:2,stamina:5:1,mana:5:1"],
    warden: ["count=1;affinity=decay;motivation=stationary;affinities=decay:emit:1;vitals=health:10:0,stamina:3:0,mana:4:1,durability:5:0"],
    dungeonAffinity: "life",
  },
  {
    title: "Create Decay Hazard Cell",
    task: "create a decay cell with a decay mana hazard and a defending decay Warden",
    room: ["size=small;count=1;affinities=decay:emit:2"],
    floorTile: ["count=12"],
    hazard: ["affinity=decay;expression=emit;proximityRadius=2;mana=regen:3:3:1"],
    warden: ["count=1;affinity=decay;motivation=defending;affinities=decay:emit:2;vitals=health:10:0,stamina:4:1,mana:4:1,durability:5:0"],
    dungeonAffinity: "decay",
  },
  {
    title: "Create Corrode Resource Cache",
    task: "create a corrode-themed cache with a level affinity stack resource and stealth Delver",
    room: ["size=medium;count=1;affinities=corrode:emit:1"],
    floorTile: ["count=14"],
    resource: ["tier=level;stat=affinityStack;delta=1;dropRate=15"],
    delver: ["count=1;affinity=corrode;motivation=stealthy;affinities=corrode:emit:2;vitals=health:7:1,stamina:8:1,mana:4:1"],
    dungeonAffinity: "corrode",
  },
  {
    title: "Create Fortify Guard Post",
    task: "create a fortify guard post with a blocking fortify emit trap and one defensive Warden",
    room: ["size=medium;count=1;affinities=fortify:emit:2"],
    floorTile: ["count=18"],
    trap: ["x=2;y=4;affinity=fortify;expression=emit;stacks=2;blocking=true;vitals=mana:4:1,durability:6:0"],
    warden: ["count=1;affinity=fortify;motivation=defending;affinities=fortify:emit:2;vitals=health:12:1,stamina:4:1,mana:4:1,durability:8:0"],
    dungeonAffinity: "fortify",
  },
  {
    title: "Create Light Scout Entry",
    task: "create a light scout entry room that counters a dark trap",
    room: ["size=small;count=1;affinities=light:emit:1"],
    floorTile: ["count=12"],
    trap: ["x=2;y=2;affinity=dark;expression=emit;stacks=2;blocking=false"],
    delver: ["count=1;affinity=light;motivation=exploring;affinities=light:emit:1;vitals=health:8:1,stamina:7:1,mana:5:1"],
    dungeonAffinity: "light",
  },
  {
    title: "Create Dark Sentinel Entry",
    task: "create a dark sentinel room with a stationary dark Warden and darkness pressure",
    room: ["size=small;count=1;affinities=dark:emit:2"],
    floorTile: ["count=12"],
    trap: ["x=3;y=3;affinity=dark;expression=emit;stacks=2;blocking=false"],
    warden: ["count=1;affinity=dark;motivation=stationary;affinities=dark:emit:3;vitals=health:11:0,stamina:3:0,mana:5:1,durability:6:0"],
    dungeonAffinity: "dark",
  },
  {
    title: "Create Balanced Three Actors",
    task: "create a balanced medium encounter with fire, water, and earth actors",
    room: ["size=medium;count=1;affinities=earth:emit:1"],
    floorTile: ["count=20"],
    delver: [
      "count=1;affinity=fire;motivation=attacking;affinities=fire:push:1;vitals=health:8:1,stamina:6:1,mana:4:1",
      "count=1;affinity=water;motivation=exploring;affinities=water:draw:1;vitals=health:8:1,stamina:6:1,mana:5:1",
    ],
    warden: ["count=1;affinity=earth;motivation=defending;affinities=earth:pull:1;vitals=health:11:1,stamina:4:1,mana:3:1,durability:5:0"],
  },
  {
    title: "Create Four Delver Squad",
    task: "create a four-Delver wind squad for party-scaling tests",
    room: ["size=large;count=1;affinities=wind:emit:1"],
    floorTile: ["count=25"],
    delver: ["count=4;affinity=wind;motivation=exploring;affinities=wind:push:1;vitals=health:7:1,stamina:7:1,mana:4:1"],
    dungeonAffinity: "wind",
  },
  {
    title: "Create Three Wardens Defense",
    task: "create a three-Warden dark defense for actor-count scaling",
    room: ["size=large;count=1;affinities=dark:emit:2"],
    floorTile: ["count=25"],
    warden: ["count=3;affinity=dark;motivation=defending;affinities=dark:emit:2;vitals=health:10:1,stamina:4:1,mana:4:1,durability:5:0"],
    dungeonAffinity: "dark",
  },
  {
    title: "Create Mixed Affinity Boss Room",
    task: "create a large boss room with light Delver pressure against a strategy-focused dark Warden",
    room: ["size=large;count=1;affinities=dark:emit:3,light:emit:1"],
    floorTile: ["count=28"],
    trap: ["x=3;y=3;affinity=dark;expression=emit;stacks=2;blocking=false"],
    hazard: ["affinity=decay;expression=emit;proximityRadius=2;mana=regen:4:4:1"],
    delver: ["count=1;affinity=light;motivation=attacking;affinities=light:emit:2;vitals=health:10:1,stamina:7:1,mana:6:1"],
    warden: ["count=1;affinity=dark;motivation=strategy_focused;affinities=dark:emit:3,decay:emit:1;vitals=health:16:1,stamina:5:1,mana:7:1,durability:9:0"],
    dungeonAffinity: "dark",
  },
  {
    title: "Create Trap Gauntlet",
    task: "create a gauntlet with four non-blocking emit traps and one stealth Delver",
    room: ["size=large;count=2;affinities=fire:emit:1,dark:emit:1"],
    floorTile: ["count=32"],
    trap: [
      "x=1;y=1;affinity=fire;expression=emit;stacks=1;blocking=false",
      "x=2;y=2;affinity=dark;expression=emit;stacks=2;blocking=false",
      "x=3;y=3;affinity=decay;expression=emit;stacks=1;blocking=false",
      "x=4;y=4;affinity=corrode;expression=emit;stacks=1;blocking=false",
    ],
    delver: ["count=1;affinity=light;motivation=stealthy;affinities=light:emit:1;vitals=health:8:1,stamina:8:1,mana:5:1"],
  },
  {
    title: "Create Hazard Gauntlet",
    task: "create a hazard gauntlet with fire, water, and decay mana zones",
    room: ["size=large;count=1;affinities=fire:emit:1,water:emit:1,decay:emit:1"],
    floorTile: ["count=28"],
    hazard: [
      "affinity=fire;expression=emit;proximityRadius=1;mana=regen:3:3:1",
      "affinity=water;expression=emit;proximityRadius=1;mana=regen:3:3:1",
      "affinity=decay;expression=emit;proximityRadius=2;mana=regen:4:4:1",
    ],
    delver: ["count=1;affinity=fortify;motivation=defending;affinities=fortify:emit:1;vitals=health:10:1,stamina:5:1,mana:4:1"],
  },
  {
    title: "Create Resource Heavy Shrine",
    task: "create a shrine room with multiple resources and one friendly life Delver",
    room: ["size=medium;count=1;affinities=life:emit:2"],
    floorTile: ["count=18"],
    resource: [
      "tier=permanent;stat=vitalMax;delta=6;dropRate=5",
      "tier=level;stat=vitalRegen;delta=1;dropRate=20",
      "tier=level;stat=affinityStack;delta=1;dropRate=15",
    ],
    delver: ["count=1;affinity=life;motivation=friendly;affinities=life:pull:2;vitals=health:9:2,stamina:5:1,mana:5:1"],
    dungeonAffinity: "life",
  },
  {
    title: "Create Opposed Fire Water Room",
    task: "create a room that pits fire attack pressure against water sustain",
    room: ["size=medium;count=1;affinities=fire:emit:1,water:emit:1"],
    floorTile: ["count=20"],
    trap: ["x=2;y=2;affinity=fire;expression=emit;stacks=2;blocking=false"],
    delver: ["count=1;affinity=water;motivation=exploring;affinities=water:draw:2;vitals=health:8:1,stamina:6:1,mana:6:1"],
    warden: ["count=1;affinity=fire;motivation=attacking;affinities=fire:push:1;vitals=health:10:1,stamina:5:1,mana:5:1,durability:5:0"],
  },
  {
    title: "Create Opposed Earth Wind Room",
    task: "create a room that tests earth and wind opposition through actors and room affinity",
    room: ["size=medium;count=1;affinities=earth:emit:1,wind:emit:1"],
    floorTile: ["count=20"],
    delver: ["count=1;affinity=wind;motivation=exploring;affinities=wind:push:2;vitals=health:8:1,stamina:8:1,mana:5:1"],
    warden: ["count=1;affinity=earth;motivation=patrolling;affinities=earth:pull:2;vitals=health:11:1,stamina:5:1,mana:4:1,durability:5:0"],
  },
  {
    title: "Create Opposed Life Decay Room",
    task: "create a room that tests life support against decay pressure",
    room: ["size=medium;count=1;affinities=life:emit:1,decay:emit:1"],
    floorTile: ["count=20"],
    hazard: ["affinity=decay;expression=emit;proximityRadius=2;mana=regen:4:4:1"],
    delver: ["count=1;affinity=life;motivation=friendly;affinities=life:pull:2;vitals=health:10:2,stamina:5:1,mana:5:1"],
    warden: ["count=1;affinity=decay;motivation=attacking;affinities=decay:emit:2;vitals=health:10:0,stamina:5:1,mana:5:1,durability:5:0"],
  },
  {
    title: "Create Opposed Light Dark Room",
    task: "create a room that tests light visibility against dark obscuring pressure",
    room: ["size=medium;count=1;affinities=light:emit:1,dark:emit:2"],
    floorTile: ["count=20"],
    trap: ["x=3;y=3;affinity=dark;expression=emit;stacks=2;blocking=false"],
    delver: ["count=1;affinity=light;motivation=exploring;affinities=light:emit:2;vitals=health:8:1,stamina:7:1,mana:6:1"],
    warden: ["count=1;affinity=dark;motivation=defending;affinities=dark:emit:2;vitals=health:11:1,stamina:4:1,mana:5:1,durability:6:0"],
  },
  {
    title: "Create Random Movement Lab",
    task: "create a small room with randomly moving fire and water actors",
    room: ["size=small;count=1"],
    floorTile: ["count=16"],
    delver: ["count=1;affinity=fire;motivation=random;affinities=fire:emit:1;vitals=health:7:1,stamina:7:1,mana:4:1"],
    warden: ["count=1;affinity=water;motivation=random;affinities=water:draw:1;vitals=health:9:1,stamina:5:1,mana:4:1,durability:4:0"],
  },
  {
    title: "Create Stationary Puzzle Room",
    task: "create a stationary puzzle room with one trap and two stationary Wardens",
    room: ["size=medium;count=1;affinities=fortify:emit:1"],
    floorTile: ["count=18"],
    trap: ["x=2;y=3;affinity=fortify;expression=emit;stacks=1;blocking=true"],
    warden: ["count=2;affinity=fortify;motivation=stationary;affinities=fortify:emit:1;vitals=health:10:0,stamina:3:0,mana:3:1,durability:7:0"],
    dungeonAffinity: "fortify",
  },
  {
    title: "Create Stealth Infiltration Room",
    task: "create a dark infiltration room with stealth Delver and patrolling Warden",
    room: ["size=medium;count=1;affinities=dark:emit:2"],
    floorTile: ["count=18"],
    trap: ["x=3;y=2;affinity=dark;expression=emit;stacks=2;blocking=false"],
    delver: ["count=1;affinity=dark;motivation=stealthy;affinities=dark:emit:1;vitals=health:7:1,stamina:8:1,mana:4:1"],
    warden: ["count=1;affinity=light;motivation=patrolling;affinities=light:emit:1;vitals=health:10:1,stamina:6:1,mana:4:1,durability:4:0"],
  },
  {
    title: "Create Friendly Rescue Room",
    task: "create a rescue room with friendly and defending actors around a life resource",
    room: ["size=medium;count=1;affinities=life:emit:1"],
    floorTile: ["count=18"],
    resource: ["tier=level;stat=vitalMax;delta=4;dropRate=25"],
    delver: ["count=1;affinity=life;motivation=friendly;affinities=life:pull:1;vitals=health:8:2,stamina:5:1,mana:5:1"],
    warden: ["count=1;affinity=fortify;motivation=defending;affinities=fortify:emit:1;vitals=health:12:1,stamina:4:1,mana:4:1,durability:7:0"],
  },
  {
    title: "Create Reflexive Actor Test",
    task: "create a reflexive dark Warden test case with a simple Delver opponent",
    room: ["size=small;count=1;affinities=dark:emit:1"],
    floorTile: ["count=14"],
    delver: ["count=1;affinity=fire;motivation=attacking;affinities=fire:push:1;vitals=health:8:1,stamina:6:1,mana:4:1"],
    warden: ["count=1;affinity=dark;motivation=reflexive;affinities=dark:emit:1;vitals=health:10:1,stamina:4:1,mana:4:1,durability:5:0"],
  },
  {
    title: "Create Goal Oriented Actor Test",
    task: "create a goal-oriented wind Delver test case with one guarding Warden",
    room: ["size=medium;count=1;affinities=wind:emit:1"],
    floorTile: ["count=18"],
    delver: ["count=1;affinity=wind;motivation=goal_oriented;affinities=wind:push:1;vitals=health:8:1,stamina:8:1,mana:5:1"],
    warden: ["count=1;affinity=earth;motivation=defending;affinities=earth:pull:1;vitals=health:11:1,stamina:4:1,mana:4:1,durability:5:0"],
  },
  {
    title: "Create Strategy Warden Test",
    task: "create a strategy-focused Warden test case with layered dark and decay pressure",
    room: ["size=medium;count=1;affinities=dark:emit:2,decay:emit:1"],
    floorTile: ["count=20"],
    hazard: ["affinity=decay;expression=emit;proximityRadius=2;mana=regen:4:4:1"],
    delver: ["count=1;affinity=light;motivation=attacking;affinities=light:emit:1;vitals=health:9:1,stamina:7:1,mana:5:1"],
    warden: ["count=1;affinity=dark;motivation=strategy_focused;affinities=dark:emit:2,decay:emit:1;vitals=health:14:1,stamina:5:1,mana:6:1,durability:8:0"],
  },
  {
    title: "Create User Setup Delver",
    task: "create a Delver configured with user setup mode so agents must preserve setup-mode in the request",
    room: ["size=small;count=1"],
    floorTile: ["count=12"],
    delver: ["count=1;affinity=fire;motivation=attacking;setup-mode=user;affinities=fire:push:2;vitals=health:9:1,stamina:6:1,mana:5:1"],
    warden: ["count=1;affinity=dark;motivation=defending;affinities=dark:emit:1;vitals=health:10:1,stamina:4:1,mana:4:1,durability:5:0"],
  },
  {
    title: "Create Hybrid Setup Delver",
    task: "create a Delver configured with hybrid setup mode and two affinities",
    room: ["size=medium;count=1;affinities=water:emit:1"],
    floorTile: ["count=18"],
    delver: ["count=1;affinity=water;motivation=exploring;setup-mode=hybrid;affinities=water:draw:2,life:pull:1;vitals=health:8:2,stamina:6:1,mana:6:1"],
    dungeonAffinity: "water",
  },
  {
    title: "Create Auto Setup Delver",
    task: "create an auto setup Delver and compare the generated artifacts against explicit user and hybrid setup cases",
    room: ["size=small;count=1;affinities=earth:emit:1"],
    floorTile: ["count=14"],
    delver: ["count=1;affinity=earth;motivation=exploring;setup-mode=auto;affinities=earth:pull:1;vitals=health:9:1,stamina:6:1,mana:4:1"],
    warden: ["count=1;affinity=wind;motivation=patrolling;affinities=wind:push:1;vitals=health:9:1,stamina:6:1,mana:4:1,durability:4:0"],
  },
  {
    title: "Create Max Mana Goal Delver",
    task: "create a Delver with explicit max_mana and mana_regen optimization goals",
    room: ["size=small;count=1"],
    floorTile: ["count=12"],
    delver: ["count=1;affinity=fire;motivation=attacking;affinities=fire:emit:1;vitals=health:8:1,stamina:6:1,mana:6:2;goals=max_mana:high,mana_regen:high"],
  },
  {
    title: "Create Mana Regen Goal Squad",
    task: "create a two-Delver squad with mana regeneration goals and mixed water and life affinity",
    room: ["size=medium;count=1;affinities=water:emit:1,life:emit:1"],
    floorTile: ["count=18"],
    delver: [
      "count=1;affinity=water;motivation=exploring;affinities=water:draw:2;vitals=health:8:1,stamina:6:1,mana:6:2;goals=mana_regen:high",
      "count=1;affinity=life;motivation=friendly;affinities=life:pull:2;vitals=health:8:2,stamina:5:1,mana:5:1;goals=max_mana:medium,mana_regen:medium",
    ],
  },
  {
    title: "Create Blocking Trap Choke",
    task: "create a choke room with a blocking trap and one patrolling Warden",
    room: ["size=medium;count=1;affinities=earth:emit:1"],
    floorTile: ["count=18"],
    trap: ["x=2;y=2;affinity=earth;expression=emit;stacks=2;blocking=true;vitals=mana:4:1,durability:8:0"],
    delver: ["count=1;affinity=wind;motivation=exploring;affinities=wind:push:1;vitals=health:8:1,stamina:8:1,mana:4:1"],
    warden: ["count=1;affinity=earth;motivation=patrolling;affinities=earth:pull:1;vitals=health:11:1,stamina:5:1,mana:4:1,durability:5:0"],
  },
  {
    title: "Create Nonblocking Trap Field",
    task: "create a trap field with three non-blocking emit traps and a light scout",
    room: ["size=large;count=1;affinities=dark:emit:1"],
    floorTile: ["count=28"],
    trap: [
      "x=1;y=2;affinity=dark;expression=emit;stacks=1;blocking=false",
      "x=2;y=3;affinity=fire;expression=emit;stacks=1;blocking=false",
      "x=3;y=4;affinity=corrode;expression=emit;stacks=1;blocking=false",
    ],
    delver: ["count=1;affinity=light;motivation=exploring;affinities=light:emit:1;vitals=health:8:1,stamina:7:1,mana:5:1"],
  },
  {
    title: "Create Trap Vital Budget Test",
    task: "create a trap with explicit mana and durability vitals so the cost receipt shows trap vital spend",
    room: ["size=small;count=1;affinities=fire:emit:1"],
    floorTile: ["count=14"],
    trap: ["x=2;y=2;affinity=fire;expression=emit;stacks=2;blocking=false;vitals=mana:6:2,durability:9:0"],
    dungeonAffinity: "fire",
  },
  {
    title: "Create Hazard Mana Budget Test",
    task: "create a hazard with explicit mana reserve and regeneration so the cost receipt shows hazard mana spend",
    room: ["size=small;count=1;affinities=water:emit:1"],
    floorTile: ["count=14"],
    hazard: ["affinity=water;expression=emit;proximityRadius=2;mana=regen:6:6:2"],
    dungeonAffinity: "water",
  },
  {
    title: "Create Multi Room Delver Route",
    task: "create three connected rooms with one exploring Delver route baseline",
    room: ["size=medium;count=3;affinities=wind:emit:1"],
    floorTile: ["count=36"],
    delver: ["count=1;affinity=wind;motivation=exploring;affinities=wind:push:1;vitals=health:8:1,stamina:8:1,mana:4:1"],
    dungeonAffinity: "wind",
  },
  {
    title: "Create Multi Room Warden Route",
    task: "create three connected rooms with patrolling Wardens and a trap checkpoint",
    room: ["size=medium;count=3;affinities=earth:emit:1"],
    floorTile: ["count=36"],
    trap: ["x=3;y=3;affinity=earth;expression=emit;stacks=1;blocking=true"],
    warden: ["count=2;affinity=earth;motivation=patrolling;affinities=earth:pull:1;vitals=health:10:1,stamina:6:1,mana:4:1,durability:5:0"],
    dungeonAffinity: "earth",
  },
  {
    title: "Create Multi Room Balanced Encounter",
    task: "create three rooms with two Delvers, two Wardens, and a balanced light-dark trap mix",
    room: ["size=medium;count=3;affinities=light:emit:1,dark:emit:1"],
    floorTile: ["count=36"],
    trap: [
      "x=2;y=2;affinity=dark;expression=emit;stacks=2;blocking=false",
      "x=4;y=3;affinity=light;expression=emit;stacks=1;blocking=false",
    ],
    delver: [
      "count=1;affinity=light;motivation=exploring;affinities=light:emit:1;vitals=health:8:1,stamina:7:1,mana:5:1",
      "count=1;affinity=fire;motivation=attacking;affinities=fire:push:1;vitals=health:8:1,stamina:6:1,mana:4:1",
    ],
    warden: [
      "count=1;affinity=dark;motivation=defending;affinities=dark:emit:2;vitals=health:11:1,stamina:4:1,mana:5:1,durability:6:0",
      "count=1;affinity=water;motivation=patrolling;affinities=water:draw:1;vitals=health:10:1,stamina:5:1,mana:5:1,durability:5:0",
    ],
  },
  {
    title: "Create Large Dark Maze",
    task: "create a large dark maze-style level baseline with multiple dark traps and one light scout",
    room: ["size=large;count=3;affinities=dark:emit:3"],
    floorTile: ["count=45"],
    trap: [
      "x=1;y=1;affinity=dark;expression=emit;stacks=2;blocking=false",
      "x=2;y=4;affinity=dark;expression=emit;stacks=2;blocking=false",
      "x=4;y=2;affinity=dark;expression=emit;stacks=2;blocking=false",
    ],
    delver: ["count=1;affinity=light;motivation=exploring;affinities=light:emit:2;vitals=health:9:1,stamina:8:1,mana:6:1"],
    warden: ["count=2;affinity=dark;motivation=patrolling;affinities=dark:emit:2;vitals=health:10:1,stamina:5:1,mana:5:1,durability:5:0"],
    dungeonAffinity: "dark",
  },
  {
    title: "Create Large Fire Arena",
    task: "create a large fire arena with fire traps, a water Delver, and a fire Warden",
    room: ["size=large;count=2;affinities=fire:emit:2"],
    floorTile: ["count=40"],
    trap: [
      "x=2;y=2;affinity=fire;expression=emit;stacks=2;blocking=false",
      "x=4;y=4;affinity=fire;expression=emit;stacks=2;blocking=false",
    ],
    hazard: ["affinity=fire;expression=emit;proximityRadius=2;mana=regen:5:5:1"],
    delver: ["count=1;affinity=water;motivation=attacking;affinities=water:draw:2;vitals=health:10:1,stamina:7:1,mana:6:1"],
    warden: ["count=1;affinity=fire;motivation=strategy_focused;affinities=fire:push:2;vitals=health:14:1,stamina:5:1,mana:7:1,durability:7:0"],
    dungeonAffinity: "fire",
  },
  {
    title: "Create Large Resource Dungeon",
    task: "create a large dungeon with several resources and mixed actors",
    room: ["size=large;count=2;affinities=life:emit:1,fortify:emit:1"],
    floorTile: ["count=38"],
    resource: [
      "tier=permanent;stat=vitalMax;delta=8;dropRate=5",
      "tier=level;stat=vitalRegen;delta=1;dropRate=15",
      "tier=level;stat=affinityStack;delta=1;dropRate=20",
    ],
    delver: [
      "count=1;affinity=life;motivation=friendly;affinities=life:pull:2;vitals=health:9:2,stamina:5:1,mana:5:1",
      "count=1;affinity=fire;motivation=attacking;affinities=fire:push:1;vitals=health:8:1,stamina:6:1,mana:4:1",
    ],
    warden: ["count=1;affinity=fortify;motivation=defending;affinities=fortify:emit:2;vitals=health:13:1,stamina:4:1,mana:4:1,durability:8:0"],
    dungeonAffinity: "life",
  },
  {
    title: "Create Cross Affinity Dungeon",
    task: "create a dungeon that includes every affinity family at least once across rooms, traps, hazards, and actors",
    room: ["size=large;count=2;affinities=fire:emit:1,water:emit:1,earth:emit:1,wind:emit:1,life:emit:1,decay:emit:1,light:emit:1,dark:emit:1"],
    floorTile: ["count=40"],
    trap: [
      "x=1;y=1;affinity=corrode;expression=emit;stacks=1;blocking=false",
      "x=2;y=2;affinity=fortify;expression=emit;stacks=1;blocking=true",
    ],
    hazard: ["affinity=decay;expression=emit;proximityRadius=2;mana=regen:4:4:1"],
    delver: [
      "count=1;affinity=fire;motivation=attacking;affinities=fire:push:1,wind:push:1;vitals=health:8:1,stamina:7:1,mana:5:1",
      "count=1;affinity=life;motivation=friendly;affinities=life:pull:1,water:draw:1;vitals=health:8:2,stamina:5:1,mana:5:1",
    ],
    warden: [
      "count=1;affinity=dark;motivation=defending;affinities=dark:emit:2,decay:emit:1;vitals=health:12:1,stamina:4:1,mana:5:1,durability:6:0",
      "count=1;affinity=earth;motivation=patrolling;affinities=earth:pull:1,fortify:emit:1;vitals=health:11:1,stamina:5:1,mana:4:1,durability:6:0",
    ],
  },
  {
    title: "Create Minimal Budget Comparison",
    task: "create a deliberately minimal level with one room, one floor tile batch, and no actors for budget comparison",
    room: ["size=small;count=1"],
    floorTile: ["count=5"],
  },
  {
    title: "Create Actor Only Comparison",
    task: "create actor-only artifacts with one Delver and one Warden and no explicit room request",
    delver: ["count=1;affinity=fire;motivation=attacking;affinities=fire:emit:1;vitals=health:8:1,stamina:6:1,mana:4:1"],
    warden: ["count=1;affinity=dark;motivation=defending;affinities=dark:emit:1;vitals=health:10:1,stamina:4:1,mana:4:1,durability:5:0"],
  },
  {
    title: "Create Room Only Comparison",
    task: "create room-only artifacts with two medium rooms and explicit dark affinity but no actors",
    room: ["size=medium;count=2;affinities=dark:emit:2"],
    floorTile: ["count=20"],
    dungeonAffinity: "dark",
  },
  {
    title: "Create Full Evaluation Dungeon",
    task: "create a full evaluation dungeon with multiple rooms, traps, hazards, resources, Delvers, and Wardens",
    room: ["size=large;count=3;affinities=fire:emit:1,water:emit:1,earth:emit:1,dark:emit:2"],
    floorTile: ["count=48"],
    trap: [
      "x=1;y=1;affinity=fire;expression=emit;stacks=2;blocking=false",
      "x=2;y=2;affinity=earth;expression=emit;stacks=2;blocking=true",
      "x=3;y=3;affinity=dark;expression=emit;stacks=2;blocking=false",
      "x=4;y=4;affinity=fortify;expression=emit;stacks=1;blocking=true",
    ],
    hazard: [
      "affinity=water;expression=emit;proximityRadius=2;mana=regen:5:5:1",
      "affinity=decay;expression=emit;proximityRadius=2;mana=regen:4:4:1",
    ],
    resource: [
      "tier=permanent;stat=vitalMax;delta=6;dropRate=5",
      "tier=level;stat=affinityStack;delta=1;dropRate=20",
    ],
    delver: [
      "count=1;affinity=fire;motivation=attacking;setup-mode=user;affinities=fire:push:2;vitals=health:10:1,stamina:7:1,mana:6:1",
      "count=1;affinity=life;motivation=friendly;setup-mode=hybrid;affinities=life:pull:2,water:draw:1;vitals=health:9:2,stamina:5:1,mana:6:1",
      "count=1;affinity=light;motivation=exploring;affinities=light:emit:2;vitals=health:8:1,stamina:8:1,mana:5:1",
    ],
    warden: [
      "count=1;affinity=dark;motivation=strategy_focused;affinities=dark:emit:3,decay:emit:1;vitals=health:16:1,stamina:5:1,mana:7:1,durability:9:0",
      "count=1;affinity=earth;motivation=patrolling;affinities=earth:pull:2,fortify:emit:1;vitals=health:12:1,stamina:6:1,mana:5:1,durability:7:0",
      "count=1;affinity=water;motivation=defending;affinities=water:draw:1;vitals=health:12:1,stamina:5:1,mana:6:1,durability:6:0",
    ],
  },
  {
    title: "Create Stationary Warden Trap Room",
    task: "create a puzzle-style trap room where wardens hold stationary positions guarding trap zones, with blocking traps at key choke points and an exploring Delver",
    budgetMode: "constrained",
    budgetTokens: 500,
    room: ["size=medium;count=1"],
    trap: [
      "x=2;y=1;affinity=fire;expression=emit;stacks=3;blocking=true",
      "x=4;y=1;affinity=dark;expression=emit;stacks=2;blocking=true",
    ],
    delver: ["count=1;affinity=light;motivation=exploring"],
    warden: [
      "count=1;affinity=fire;motivation=stationary",
      "count=1;affinity=dark;motivation=stationary",
    ],
  },
  {
    title: "Create Resource Capture Dungeon",
    task: "create a resource-capture dungeon where a Delver collects level-up resources while avoiding fire traps guarded by a defending Warden",
    budgetMode: "constrained",
    budgetTokens: 600,
    room: ["size=medium;count=1"],
    trap: [
      "x=3;y=1;affinity=fire;expression=emit;stacks=2;blocking=false",
      "x=5;y=1;affinity=earth;expression=emit;stacks=1;blocking=false",
    ],
    resource: [
      "tier=level;stat=vitalMax;delta=10;dropRate=50",
      "tier=permanent;stat=affinityStack;delta=1;dropRate=20",
    ],
    delver: ["count=1;affinity=fire;motivation=attacking"],
    warden: ["count=1;affinity=dark;motivation=defending"],
  },
  {
    title: "Create Tick Session Ready Dungeon",
    task: "create a tick-session-ready dungeon with an exploring Delver, a stationary Warden, a fire trap emitting affinity stacks, and a level resource pickup",
    budgetMode: "constrained",
    budgetTokens: 500,
    room: ["size=medium;count=1"],
    trap: ["x=3;y=1;affinity=fire;expression=emit;stacks=3;blocking=false"],
    resource: ["tier=level;stat=vitalMax;delta=10;dropRate=50"],
    delver: ["count=1;affinity=fire;motivation=exploring"],
    warden: ["count=1;affinity=dark;motivation=stationary"],
  },
  {
    title: "Create Mixed Motivation Encounter",
    task: "create a mixed-motivation encounter with one exploring Delver, one attacking Delver, one defending Warden, one stationary Warden, and a dark-affinity hazard",
    budgetMode: "constrained",
    budgetTokens: 500,
    room: ["size=medium;count=1"],
    hazard: ["affinity=dark;expression=emit;proximityRadius=2;mana=regen:3:3:1"],
    delver: [
      "count=1;affinity=fire;motivation=exploring",
      "count=1;affinity=light;motivation=attacking",
    ],
    warden: [
      "count=1;affinity=dark;motivation=defending",
      "count=1;affinity=earth;motivation=stationary",
    ],
  },

  // ---------------------------------------------------------------------------
  // Budget-CONSTRAINED baselines — base rooms + base actors only.
  //
  // Minimal configuration (no explicit affinities=/vitals=/goals=) keeps the cost
  // dominated by stable base prices: a room is ~0t (tiles are the room cost surface),
  // and a base actor is ~45-50t (spawn 5 + motivation 2-3 + one base affinity ~35 +
  // default vitals). The tight per-case budgets below sit ~2-3x above that base, so
  // they stay valid as configuration costs grow elsewhere — no budget bumps needed.
  // ---------------------------------------------------------------------------
  {
    title: "Constrained Single Delver Room",
    task: "create a base room with a single exploring delver and no extra configuration",
    budgetMode: "constrained",
    budgetTokens: 250,
    room: ["size=small;count=1"],
    delver: ["count=1;affinity=fire;motivation=exploring"],
  },
  {
    title: "Constrained Single Warden Room",
    task: "create a base room with a single defending warden and no extra configuration",
    budgetMode: "constrained",
    budgetTokens: 150,
    room: ["size=small;count=1"],
    warden: ["count=1;affinity=dark;motivation=defending"],
  },
  {
    title: "Constrained Delver Versus Warden",
    task: "create a base room with one attacking delver and one defending warden",
    budgetMode: "constrained",
    budgetTokens: 350,
    room: ["size=medium;count=1"],
    delver: ["count=1;affinity=fire;motivation=attacking"],
    warden: ["count=1;affinity=dark;motivation=defending"],
  },
  {
    title: "Constrained Two Delver Party",
    task: "create a base room with two exploring delvers",
    budgetMode: "constrained",
    budgetTokens: 400,
    room: ["size=medium;count=1"],
    delver: ["count=2;affinity=water;motivation=exploring"],
  },
  {
    title: "Constrained Two Warden Patrol",
    task: "create a base room with two patrolling wardens",
    budgetMode: "constrained",
    budgetTokens: 300,
    room: ["size=medium;count=1"],
    warden: ["count=2;affinity=earth;motivation=patrolling"],
  },
  {
    title: "Constrained Four Actor Encounter",
    task: "create a base room with two attacking delvers and two defending wardens",
    budgetMode: "constrained",
    budgetTokens: 550,
    room: ["size=medium;count=1"],
    delver: ["count=2;affinity=fire;motivation=attacking"],
    warden: ["count=2;affinity=dark;motivation=defending"],
  },
  {
    title: "Constrained Two Room Delver Route",
    task: "create two base rooms with a single exploring delver",
    budgetMode: "constrained",
    budgetTokens: 300,
    room: ["size=small;count=2"],
    delver: ["count=1;affinity=wind;motivation=exploring"],
  },
  {
    title: "Constrained Floor Tile Guard Room",
    task: "create a base room with twelve floor tiles and one stationary warden",
    budgetMode: "constrained",
    budgetTokens: 250,
    room: ["size=medium;count=1"],
    floorTile: ["count=12"],
    warden: ["count=1;affinity=fortify;motivation=stationary"],
  },
  {
    title: "Constrained Trap Defense Room",
    task: "create a base room with one exploring delver, one defending warden, and a single basic trap",
    budgetMode: "constrained",
    budgetTokens: 400,
    room: ["size=medium;count=1"],
    trap: ["x=2;y=2;affinity=fire;expression=emit;stacks=1;blocking=false"],
    delver: ["count=1;affinity=water;motivation=exploring"],
    warden: ["count=1;affinity=fire;motivation=defending"],
  },
  {
    title: "Constrained Three Warden Hold",
    task: "create a base room with three defending wardens",
    budgetMode: "constrained",
    budgetTokens: 420,
    room: ["size=large;count=1"],
    warden: ["count=3;affinity=dark;motivation=defending"],
  },
];

const omittedTitles = new Set([
  "Create Floor Tile Starter Room",
  "Create Random Movement Lab",
  "Create Friendly Rescue Room",
  "Create Auto Setup Delver",
  "Create Max Mana Goal Delver",
  "Create Minimal Budget Comparison",
  "Create Actor Only Comparison",
  "Create Room Only Comparison",
]);

const selectedCases = cases
  .filter((testCase) => !omittedTitles.has(testCase.title))
  .map(normalizeForCodeLaw);

function hasSizeSmall(spec) {
  return String(spec || "")
    .split(";")
    .map((segment) => segment.trim().toLowerCase())
    .some((segment) => segment === "small" || segment === "size=small");
}

function forceMediumRoomSpec(spec) {
  const segments = String(spec || "").split(";").map((segment) => segment.trim()).filter(Boolean);
  let sawSize = false;
  const next = segments.map((segment) => {
    if (!segment.includes("=")) {
      if (segment.toLowerCase() === "small") {
        sawSize = true;
        return "medium";
      }
      return segment;
    }
    const separator = segment.indexOf("=");
    const key = segment.slice(0, separator).trim();
    const value = segment.slice(separator + 1).trim();
    if (key.toLowerCase() === "size") {
      sawSize = true;
      return value.toLowerCase() === "small" ? `${key}=medium` : segment;
    }
    return segment;
  });
  if (!sawSize) {
    next.unshift("size=medium");
  }
  return next.join(";");
}

function normalizeForCodeLaw(testCase) {
  const convertedHazards = [];
  const normalizationNotes = [];
  const hasExplicitTrapOrHazard = (testCase.trap || []).length > 0 || (testCase.hazard || []).length > 0;
  const trap = (testCase.trap || []).slice();
  let room = (testCase.room || []).map((spec, roomIndex) => {
    const segments = String(spec).split(";").map((segment) => segment.trim()).filter(Boolean);
    const kept = [];
    for (const segment of segments) {
      if (!segment.startsWith("affinities=")) {
        kept.push(segment);
        continue;
      }
      if (hasExplicitTrapOrHazard) {
        normalizationNotes.push(`Dropped unsupported room affinity field for room ${roomIndex + 1}; explicit trap/hazard specs carry affinity pressure in current create.`);
        continue;
      }
      const rawAffinities = segment.slice("affinities=".length);
      rawAffinities.split(",").map((entry) => entry.trim()).filter(Boolean).forEach((entry, affinityIndex) => {
        const [kindRaw, expressionRaw = "emit", stacksRaw = "1"] = entry.split(":").map((part) => part.trim());
        const kind = kindRaw || testCase.dungeonAffinity || "fire";
        const expression = expressionRaw === "emit" ? "emit" : "emit";
        const stacks = Math.max(1, Number.parseInt(stacksRaw, 10) || 1);
        const mana = stacks + 2;
        convertedHazards.push(
          `id=room_${roomIndex + 1}_field_${affinityIndex + 1};affinity=${kind};expression=${expression};proximityRadius=${Math.min(4, stacks + 1)};mana=regen:${mana}:${mana}:1`,
        );
      });
      normalizationNotes.push(`Converted unsupported room affinity field to hazard field(s) for room ${roomIndex + 1}.`);
    }
    return kept.join(";");
  });
  const hasTrapOrHazard = hasExplicitTrapOrHazard || convertedHazards.length > 0;
  if (hasTrapOrHazard && room.some(hasSizeSmall)) {
    room = room.map((spec) => (hasSizeSmall(spec) ? forceMediumRoomSpec(spec) : spec));
    normalizationNotes.push("Upgraded size=small room to size=medium because current create rejects small rooms containing traps or hazards.");
  }
  const task = normalizationNotes.some((note) => note.includes("size=medium"))
    ? String(testCase.task || "").replace(/\bsmall\b/g, "medium")
    : testCase.task;
  return {
    ...testCase,
    task,
    room,
    ...(trap.length > 0 ? { trap } : {}),
    ...(convertedHazards.length > 0 ? { hazard: [...(testCase.hazard || []), ...convertedHazards] } : {}),
    ...(normalizationNotes.length > 0 ? { normalizationNotes } : {}),
  };
}

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function parseJsonLine(stdout) {
  const lines = stdout.split("\n").map((line) => line.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    try {
      return JSON.parse(lines[i]);
    } catch {}
  }
  throw new Error(`No JSON payload found in stdout:\n${stdout}`);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function markdownTable(headers, rows) {
  const escaped = rows.map((row) => row.map((cell) => String(cell ?? "").replace(/\|/g, "\\|").replace(/\n/g, "<br>")));
  return [
    `| ${headers.join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...escaped.map((row) => `| ${row.join(" | ")} |`),
  ].join("\n");
}

function pushSpecs(args, flag, values = []) {
  for (const value of values) {
    args.push(flag, value);
  }
}

function objectRows(testCase) {
  const rows = [];
  for (const [label, field] of [
    ["Room", "room"],
    ["Floor tile", "floorTile"],
    ["Trap", "trap"],
    ["Hazard", "hazard"],
    ["Resource", "resource"],
    ["Delver", "delver"],
    ["Warden", "warden"],
  ]) {
    for (const spec of testCase[field] || []) {
      rows.push([label, spec]);
    }
  }
  if (rows.length === 0) rows.push(["None", "No authored object specs"]);
  return rows;
}

function costTotals(lineItems = []) {
  const totals = new Map();
  for (const item of lineItems) {
    const key = `${item.kind}:${item.status}`;
    const current = totals.get(key) || { kind: item.kind, status: item.status, total: 0 };
    current.total += Number(item.totalCost || 0);
    totals.set(key, current);
  }
  return Array.from(totals.values())
    .sort((a, b) => a.kind.localeCompare(b.kind) || a.status.localeCompare(b.status))
    .map((entry) => [entry.kind, entry.status, entry.total]);
}

function listJsonFiles(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((entry) => entry.endsWith(".json"))
    .sort()
    .map((entry) => join(dir, entry));
}

function isConstrained(testCase) {
  return testCase?.budgetMode === "constrained";
}

function budgetFor(testCase) {
  if (!isConstrained(testCase)) {
    // Budget-unconstrained: hand the builder a non-binding ceiling so it spends only
    // what the scenario actually needs (config-cost growth never breaks the run).
    return UNCONSTRAINED_BUDGET;
  }
  return Number.isInteger(testCase?.budgetTokens) && testCase.budgetTokens > 0
    ? testCase.budgetTokens
    : BUDGET;
}

function promptFor(testCase) {
  const budgetTokens = budgetFor(testCase);
  const budgetClause = isConstrained(testCase)
    ? `Use a ${budgetTokens} token hard budget,`
    : "Use whatever token budget the scenario requires (the budget is effectively unconstrained),";
  return [
    "Using the agent-kernel skill and the agent-kernel MCP,",
    `${testCase.task}.`,
    `${budgetClause} prefer MCP tools over shell commands, emit intermediates,`,
    "remember that create/ak_create room specs are generic so affinity pressure belongs in traps or hazards,",
    "and report generated artifact paths plus budget receipt cost details.",
  ].join(" ");
}

function argsFor(testCase, runId, outDir) {
  const budgetTokens = budgetFor(testCase);
  const args = [
    "create",
    "--text",
    promptFor(testCase),
    "--budget-tokens",
    String(budgetTokens),
    "--run-id",
    runId,
    "--created-at",
    CREATED_AT,
    "--out-dir",
    outDir,
    "--emit-intermediates",
  ];
  if (testCase.dungeonAffinity) args.push("--dungeon-affinity", testCase.dungeonAffinity);
  pushSpecs(args, "--room", testCase.room);
  pushSpecs(args, "--floor-tile", testCase.floorTile);
  pushSpecs(args, "--trap", testCase.trap);
  pushSpecs(args, "--hazard", testCase.hazard);
  pushSpecs(args, "--resource", testCase.resource);
  pushSpecs(args, "--delver", testCase.delver);
  pushSpecs(args, "--warden", testCase.warden);
  return args;
}

function renderNote({ index, testCase, runId, outDir, result, receipt, jsonFiles }) {
  const budgetTokens = budgetFor(testCase);
  const artifactRows = jsonFiles.map((file) => [basename(file), file]);
  const lineItems = Array.isArray(receipt.lineItems) ? receipt.lineItems : [];
  const costRows = lineItems.map((item) => [
    item.id,
    item.kind,
    item.quantity,
    item.unitCost,
    item.totalCost,
    item.status,
  ]);
  const totalRows = costTotals(lineItems);
  const mcpPayload = {
    text: promptFor(testCase),
    budgetTokens,
    runId,
    createdAt: CREATED_AT,
    outDir,
    emitIntermediates: true,
    ...(testCase.dungeonAffinity ? { dungeonAffinity: testCase.dungeonAffinity } : {}),
    ...(testCase.room ? { room: testCase.room } : {}),
    ...(testCase.floorTile ? { floorTile: testCase.floorTile } : {}),
    ...(testCase.trap ? { trap: testCase.trap } : {}),
    ...(testCase.hazard ? { hazard: testCase.hazard } : {}),
    ...(testCase.resource ? { resource: testCase.resource } : {}),
    ...(testCase.delver ? { delver: testCase.delver } : {}),
    ...(testCase.warden ? { warden: testCase.warden } : {}),
  };

  return `# ${String(index).padStart(2, "0")} ${testCase.title}

Prompt: ${promptFor(testCase)}

## Reference Result

- MCP tool to call: \`ak_create\`
- Reference generation path: \`ak.mjs create\` through the same implementation used by the MCP server
- Run id: \`${runId}\`
- Output directory: \`${outDir}\`
- Budget cap: \`${receipt.scenarioSpendReport?.budget ?? result.cost?.budgetTokens ?? budgetTokens}\`
- Total spend: \`${receipt.totalCost ?? result.cost?.totalSpend ?? "unknown"}\`
- Remaining: \`${receipt.remaining ?? result.cost?.remaining ?? "unknown"}\`
- Receipt status: \`${receipt.status ?? result.cost?.status ?? "unknown"}\`
${testCase.normalizationNotes?.length ? `\n## Generator Normalization\n\n${testCase.normalizationNotes.map((note) => `- ${note}`).join("\n")}\n` : ""}

## Resulting Artifact File Locations

${markdownTable(["Artifact", "Path"], artifactRows)}

## Items Created

${markdownTable(["Kind", "Requested configuration"], objectRows(testCase))}

## Cost By Kind

${markdownTable(["Kind", "Status", "Total cost"], totalRows)}

## Configuration Cost Details

${markdownTable(["Item", "Kind", "Quantity", "Unit cost", "Total cost", "Status"], costRows)}

## MCP Payload

\`\`\`json
${JSON.stringify(mcpPayload, null, 2)}
\`\`\`
`;
}

function main() {
  if (selectedCases.length !== 64) {
    throw new Error(`Expected 64 selected cases, found ${selectedCases.length}.`);
  }

  mkdirSync(VAULT_DIR, { recursive: true });
  mkdirSync(ARTIFACT_ROOT, { recursive: true });

  const indexRows = [];

  selectedCases.forEach((testCase, caseIndex) => {
    const index = caseIndex + 1;
    const number = String(index).padStart(2, "0");
    const slug = slugify(testCase.title);
    const runId = `ak_prompt_${number}_${slug.replace(/-/g, "_")}`;
    const artifactDir = join(ARTIFACT_ROOT, `${number}-${slug}`);
    const outDir = join(artifactDir, "create");
    const notePath = join(VAULT_DIR, `${number} ${testCase.title}.md`);

    rmSync(artifactDir, { recursive: true, force: true });
    mkdirSync(outDir, { recursive: true });

    const args = argsFor(testCase, runId, outDir);
    const result = spawnSync(process.execPath, [CLI, ...args], {
      cwd: ROOT,
      encoding: "utf8",
      maxBuffer: 1024 * 1024 * 20,
    });
    if (result.status !== 0) {
      throw new Error([
        `Case ${number} ${testCase.title} failed with status ${result.status}`,
        `Command: node ${CLI} ${args.join(" ")}`,
        result.stdout,
        result.stderr,
      ].filter(Boolean).join("\n"));
    }

    const payload = parseJsonLine(result.stdout);
    const receiptPath = payload.artifactPaths?.budget_receipt || join(outDir, "budget-receipt.json");
    const receipt = readJson(receiptPath);
    const jsonFiles = listJsonFiles(outDir);
    const note = renderNote({ index, testCase, runId, outDir, result: payload, receipt, jsonFiles });
    writeFileSync(notePath, note);

    indexRows.push([
      number,
      testCase.title,
      notePath,
      runId,
      receipt.totalCost ?? payload.cost?.totalSpend ?? "",
      receipt.remaining ?? payload.cost?.remaining ?? "",
      receipt.status ?? payload.cost?.status ?? "",
      outDir,
    ]);
  });

  const index = `# Agent Kernel MCP Prompt Baselines

Generated: ${new Date().toISOString()}

These 64 prompts are intended for comparing how different LLMs and reasoning levels use the agent-kernel skill plus MCP tools. They split into **budget-constrained** scenarios (base rooms + base actors under a tight token cap, for budget-enforcement comparison) and **budget-unconstrained** scenarios (the builder spends whatever the configuration requires). Each prompt file contains a copyable prompt, the reference \`ak_create\` payload, actual artifact file locations generated through the shared CLI/MCP implementation, and budget receipt cost tables.

${markdownTable(["#", "Prompt file", "Note path", "Run id", "Spend", "Remaining", "Status", "Artifact dir"], indexRows)}
`;

  writeFileSync(join(VAULT_DIR, "Index.md"), index);
  console.log(JSON.stringify({ ok: true, count: selectedCases.length, vaultDir: VAULT_DIR, artifactRoot: ARTIFACT_ROOT }, null, 2));
}

main();
