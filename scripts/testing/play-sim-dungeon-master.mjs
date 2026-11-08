/**
 * #681 (AI L3): a dungeon-master seat, prototype. A model sets standing orders (goals, the same
 * strategies `ak_play_order` takes) for the level's `ai_controlled` wardens and hazards every
 * `cadence` ticks, and the Actor plays every move in between. The delver is the autonomous Actor.
 * Local runs only, never a merge gate.
 *
 * Assumptions (stated for the PR, change on request):
 * - The master only orders actors that already exist and are `ai_controlled`. It never spawns,
 *   moves or re-equips anything itself; an order is a strategy the Actor carries out.
 * - Cadence: one master call every 5 ticks (`cadence`), at most 12 calls a run (`callBudget`).
 *   An order costs a tick, as it does for a player: the seat gives it, the actor takes it.
 * - The master sees only what an AI seat sees: for each of its living actors, that actor's own
 *   fogged screen, HUD line and who is in its sight (the session's view from that seat). No
 *   exit position, no vitals of others, no positions it has not seen.
 *
 * The score is the delver's, from logic-tactic-benefit's `scoreRun`: token value acquired
 * (Allocator price), non-renewable use, per-vital time under 50% and 25% with whether it reacted,
 * kills, turns (recorded only). Reported per run, never collapsed. The harness reads the true
 * state to score; the master never sees it.
 *
 *   node scripts/testing/play-sim-dungeon-master.mjs --level <ak create out-dir> [--model id]
 *     [--provider ollama|anthropic] [--cadence 5] [--budget 12] [--ticks 60] [--fake]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createPlaySession, AI_MOTIVATION } from "../../packages/runtime/src/runner/play-session.js";
import { hudLine, renderScreen } from "../../packages/ui-ascii/src/screen.js";
import { createHoldingPricer, scoreRun } from "./logic-tactic-benefit.mjs";
import { resolveModelEnv } from "./play-sim-model-env.mjs";
import { createAnthropicAdapter, resolveProvider } from "./play-sim-anthropic.mjs";

export const DM_DEFAULTS = Object.freeze({ cadence: 5, callBudget: 12, maxTicks: 60 });
const GOAL_KINDS = Object.freeze(["reach", "defeat", "guard", "follow", "lead", "take", "hold", "survive"]);

/** What one `ai_controlled` actor's seat shows: its own fogged screen, HUD and who it sees. */
export function seatObservation(session, actorId) {
  session.switchTo(actorId);
  const view = session.view();
  return {
    id: actorId,
    label: view.player?.label ?? null,
    hud: hudLine(view),
    screen: renderScreen({ view }),
    inSight: (view.actors ?? []).map((actor) => ({ label: actor.label ?? actor.id, role: actor.role, position: { ...actor.position } })),
    order: (view.orders ?? []).find((entry) => entry.id === actorId) ?? null,
  };
}

/**
 * Deterministic stand-in for a model, for tests and dry runs: each actor that sees the delver and
 * is not already after it is ordered to defeat it; the rest keep what they are doing (no call
 * spent on them). Sees only the observations.
 */
export function fakeMaster({ delverRole = "delver" } = {}) {
  return async ({ observations }) => ({
    orders: observations.flatMap((obs) => {
      const quarry = obs.inSight.find((actor) => actor.role === delverRole);
      const already = obs.order?.doing?.kind === "defeat" && !["done", "stalled", "ignored"].includes(obs.order.status);
      return quarry && !already ? [{ actor: obs.label ?? obs.id, goals: [{ kind: "defeat", target: quarry.label }] }] : [];
    }),
  });
}

/** A master backed by a model: it answers `{ "orders": [{ "actor": "W1", "goals": [...] }] }`. */
export function llmMaster({ adapter, model }) {
  return async ({ observations, tick, history = [] }) => {
    const prompt = [
      "You are the dungeon master of a small dungeon game. Your side is the dungeon: the actors listed below.",
      "An intruder (a delver, letter D) is somewhere in the dungeon. Your aim is to stop it leaving and to protect what the dungeon holds.",
      "Every few turns you give each of your actors standing orders; they carry them out move by move until your next orders.",
      "You see only what each of your actors sees. Answer JSON only:",
      "{\"orders\": [{\"actor\": \"<label>\", \"goals\": [{\"kind\": \"<kind>\", \"target\": \"<label>\"}]}]}",
      `Goal kinds: ${GOAL_KINDS.join(", ")}. defeat, follow and guard need a target label (guard keeps near that ally);`,
      "hold needs a place {\"x\":n,\"y\":n} and ticks; reach needs a place or \"exit\"; survive needs nothing.",
      "Leave an actor out to keep its current orders. Each order you give costs a turn.",
      `Tick ${tick}.`,
      ...(history.length ? ["Your last orders (oldest first):", ...history.slice(-4).map((entry) => `  tick ${entry.tick}: ${JSON.stringify(entry.orders)}`)] : []),
      ...observations.flatMap((obs) => [
        `--- ${obs.label} ---`, obs.hud,
        `Current order: ${obs.order ? `${obs.order.status}${obs.order.doing ? ` ${JSON.stringify(obs.order.doing)}` : ""}` : "none"}`,
        `In sight: ${obs.inSight.map((actor) => `${actor.label} (${actor.role}) at ${JSON.stringify(actor.position)}`).join("; ") || "nobody"}`,
        obs.screen,
      ]),
    ].join("\n");
    const answer = await adapter.generate({ model, prompt, format: "json", think: false, options: { temperature: 0.2 } });
    const text = String(answer?.response ?? answer?.text ?? answer).trim().replace(/^```(?:json)?|```$/g, "");
    const parsed = JSON.parse(text);
    return { orders: Array.isArray(parsed?.orders) ? parsed.orders : [] };
  };
}

const vitalsOf = (actor) => Object.fromEntries(Object.entries(actor?.vitals ?? {}).map(([key, record]) => [key, { ...record }]));

/** A turn's coarse signature for the 25% reaction check: the step it took, or "stay". */
function stepSignature(before, after) {
  if (!before || !after) return "none";
  const dx = Math.sign(after.x - before.x);
  const dy = Math.sign(after.y - before.y);
  return dx === 0 && dy === 0 ? "stay" : `move:${dx},${dy}`;
}

/**
 * One run. `level` is `{ simConfig, initialState }`; `master` is a function from the observations
 * to `{ orders }`. Returns the per-run report: the delver's score, the master's calls and orders.
 */
export async function runDungeonMaster({ level, master, cadence = DM_DEFAULTS.cadence, callBudget = DM_DEFAULTS.callBudget,
  maxTicks = DM_DEFAULTS.maxTicks, tokenValueOf } = {}) {
  const { simConfig, initialState } = level;
  const aiIds = initialState.actors.filter((actor) => actor.motivations?.includes(AI_MOTIVATION)).map((actor) => actor.id);
  if (aiIds.length === 0) throw new Error("dungeon master: the level has no ai_controlled actors to order");
  const roles = Object.fromEntries(Object.entries(initialState.presentation ?? {}).map(([id, entry]) => [id, entry.category]));
  const delverId = initialState.actors.find((actor) => roles[actor.id] === "delver")?.id;
  if (!delverId) throw new Error("dungeon master: the level has no delver");
  const session = await createPlaySession({ simConfig, initialState, playerActorId: aiIds[0], fog: true });
  const truth = () => session.debugView().actors;
  const delver = () => truth().find((actor) => actor.id === delverId);
  const living = () => aiIds.filter((id) => { const state = truth().find((actor) => actor.id === id); return state?.lifecycle === "alive" && !state.exited; });
  const frames = [];
  const calls = [];
  let nextCall = 0;
  let refused = 0;

  // Every tick the world runs, the delver's vitals before and after and the step it took.
  async function tick(run) {
    const before = delver();
    await run();
    const after = delver();
    frames.push({ signature: stepSignature(before.position, after.position), before: vitalsOf(before), after: vitalsOf(after) });
  }
  const over = () => {
    const state = delver();
    if (state.lifecycle === "defeated") return "delver_defeated";
    if (state.exited || state.lifecycle === "exited") return "delver_exited";
    if (living().length === 0) return "master_has_no_actors";
    return null;
  };

  while (frames.length < maxTicks && !over()) {
    const seats = living();
    if (!seats.includes(session.activeActorId())) session.switchTo(seats[0]);
    if (frames.length >= nextCall && calls.length < callBudget) {
      nextCall = frames.length + cadence;
      const seat = session.activeActorId();
      const observations = seats.map((id) => seatObservation(session, id));
      session.switchTo(seat);
      let plan;
      try {
        plan = await master({ observations, tick: session.status().tick, history: calls });
      } catch (error) {
        calls.push({ tick: session.status().tick, error: String(error?.message ?? error) });
        await tick(() => session.advance({ ticks: 1 }));
        continue;
      }
      const given = [];
      for (const entry of Array.isArray(plan?.orders) ? plan.orders : []) {
        if (frames.length >= maxTicks || over()) break;
        const actorId = session.resolveActorRef(String(entry?.actor ?? ""));
        if (!aiIds.includes(actorId)) { refused += 1; given.push({ ...entry, refused: "not_yours" }); continue; }
        let result;
        await tick(async () => { result = await session.order(actorId, { goals: entry.goals }); });
        if (!result?.ok) { refused += 1; frames.pop(); given.push({ ...entry, refused: result?.reason ?? "refused" }); continue; }
        given.push({ actor: entry.actor, goals: result.strategy.goals });
      }
      calls.push({ tick: session.status().tick, orders: given });
      continue;
    }
    await tick(() => session.advance({ ticks: 1 }));
  }
  const stoppedBy = over() ?? "ticks";
  const final = { actors: truth().map((actor) => ({ ...actor, lifecycle: actor.exited ? "exited" : actor.lifecycle })) };
  const score = scoreRun({ frames, final, roles }, { tokenValueOf, delverId });
  return { stoppedBy, ticks: session.status().tick, delverId, master: { calls: calls.length, callBudget, cadence, refused, log: calls }, score };
}

/** `{ simConfig, initialState }` from an `ak create` out-dir. */
export function loadLevel(dir) {
  const read = (file) => JSON.parse(readFileSync(join(dir, file), "utf8"));
  return { simConfig: read("sim-config.json"), initialState: read("initial-state.json") };
}

function parseArgs(argv) {
  const options = { cadence: DM_DEFAULTS.cadence, callBudget: DM_DEFAULTS.callBudget, maxTicks: DM_DEFAULTS.maxTicks };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--level") options.level = argv[++i];
    else if (arg === "--model") options.model = argv[++i];
    else if (arg === "--provider") options.provider = argv[++i];
    else if (arg === "--ollama-url") options.ollamaUrl = argv[++i];
    else if (arg === "--cadence") options.cadence = Number(argv[++i]);
    else if (arg === "--budget") options.callBudget = Number(argv[++i]);
    else if (arg === "--ticks") options.maxTicks = Number(argv[++i]);
    else if (arg === "--out") options.out = argv[++i];
    else if (arg === "--fake") options.fake = true;
    else throw new Error(`unknown argument ${arg}`);
  }
  if (!options.level) throw new Error("--level <ak create out-dir> is required");
  return options;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseArgs(process.argv.slice(2));
    let master;
    if (options.fake) master = fakeMaster();
    else {
      const { model, baseUrl } = resolveModelEnv(options);
      if (!model) throw new Error("--model (or OLLAMA_MODEL) is required unless --fake");
      const { provider, apiKey } = resolveProvider(options.provider);
      const adapter = provider === "anthropic"
        ? createAnthropicAdapter({ apiKey, baseUrl: process.env.ANTHROPIC_BASE_URL || undefined })
        : (await import("../../packages/adapters-cli/src/adapters/llm/index.js")).createLlmAdapter(baseUrl ? { baseUrl } : {});
      master = llmMaster({ adapter, model });
    }
    const report = await runDungeonMaster({ level: loadLevel(resolve(options.level)), master, cadence: options.cadence,
      callBudget: options.callBudget, maxTicks: options.maxTicks, tokenValueOf: await createHoldingPricer() });
    const text = JSON.stringify(report, null, 2);
    if (options.out) writeFileSync(options.out, `${text}\n`);
    console.log(text);
  } catch (error) {
    console.error(error.message);
    process.exit(2);
  }
}
