/**
 * The game controller: turns intents into play-session commands and tracks
 * presentation state (which level, how many turns, the last message). No
 * terminal IO and no rules — `cli.mjs` owns the terminal, the runtime play
 * session owns the simulation.
 */
import { createPlaySession, replayPlaySession } from "../../runtime/src/runner/play-session.js";
import { INTENT } from "./keymap.js";
import { motivationNote, renderScreen } from "./screen.js";

/** Friendlier words for core's rejection codes; the raw name is the fallback. */
const REJECTION_MESSAGES = Object.freeze({
  BlockedByWall: "A wall blocks the way.",
  ActorCollision: "Something is in the way.",
  OutOfBounds: "You cannot leave the map that way.",
  InsufficientStamina: "Too tired to move.",
  InsufficientMana: "Not enough mana.",
  NoActiveAffinity: "Nothing is equipped. Press i to equip an affinity.",
  AffinityNotCastable: "Emit and draw work on their own while equipped. Only push and pull are cast.",
  TargetOutOfRange: "Out of range. The target panel shows how far each cast reaches.",
  InvalidTarget: "That cannot be targeted.",
  UnknownAffinity: "You do not know that affinity.",
  AffinityAlreadyEquipped: "That affinity is already equipped.",
  NothingToTake: "Nothing left to take there.",
  NotAdjacent: "Too far away to take that.",
  InvalidCapability: "You cannot do that.",
  AffinityNotEquipped: "That affinity is not equipped.",
  InvalidAffinityStacks: "You cannot run it at that many stacks.",
  not_playable: "Only your party (actors authored user_controlled) takes your commands.",
  unknown_actor: "No actor goes by that name.",
  exited: "They have already left the level.",
  defeated: "They were defeated.",
  not_yours: "Only your party and actors on your side take orders.",
});

function rejectionMessage(reason, player) {
  if (reason === "AffinitySlotsFull") return `You already have every affinity slot (${player?.maxAffinitySlots}).`;
  return REJECTION_MESSAGES[reason] || `Rejected (${reason}).`;
}

export function affinityLabel(pair) {
  return `${pair.kind} ${pair.expression} ×${pair.stacks}`;
}

/** The stacks an equipped affinity runs at: what is held unless run lower (#230). */
function runningStacks(player, pair) {
  const running = player?.equippedAffinityStacks?.[`${pair.kind}:${pair.expression}`];
  return Number.isInteger(running) ? running : pair.stacks;
}

function keyLabel(affinityKey) {
  return String(affinityKey || "").replace(":", " ");
}

/** The equipped slots core would cast, with their reach, as the play session reports them. */
const castable = (player) => player?.castableAffinities || {};

/** Equipped keys in equip order, as the play session reports them. */
const equippedKeys = (player) => player?.equippedAffinityKeys || [];

function lootLabel(item) {
  if (item.kind === "affinity") return `${item.affinity} ${item.expression}`;
  if (item.kind === "slot") return item.slots === 1 ? "a new affinity slot" : `${item.slots} new affinity slots`;
  return "a vital boost";
}

const chebyshev = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));

/** Everyone in sight the player could aim at, nearest first. Range is core's to judge. */
function targetsInSight(view) {
  const from = view.player?.position;
  if (!from) return [];
  return [...(view.actors || []), ...(view.hazards || [])]
    .map((actor) => ({ id: actor.id, distance: chebyshev(from, actor.position), motivations: actor.motivations ?? [] }))
    .sort((a, b) => a.distance - b.distance || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** How many turns "hold here" keeps a companion in place: the session needs a count. */
export const HOLD_ORDER_TICKS = 10;

/**
 * The orders the terminal offers (#272), as strategies the play session takes. Each is
 * built from what the screen knows: who is seated, where the ordered actor stands, and
 * the nearest hostile in sight. A choice with nothing to aim at is left out. What a
 * goal means is the Actor's; this only names it.
 */
function orderChoices({ playerId, actor, hostile }) {
  return [
    { label: `follow you`, strategy: { goals: [{ kind: "follow", target: playerId }] } },
    { label: `guard you`, strategy: { goals: [{ kind: "guard", target: playerId }] } },
    { label: `lead you to the exit`, strategy: { goals: [{ kind: "lead", target: playerId, place: "exit" }] } },
    { label: `go to the exit`, strategy: { goals: [{ kind: "reach", place: "exit" }] } },
    ...(hostile ? [{ label: `defeat ${hostile.label ?? hostile.id}`, strategy: { goals: [{ kind: "defeat", target: hostile.id }] } }] : []),
    ...(actor?.position ? [{ label: `hold where it stands for ${HOLD_ORDER_TICKS} turns`,
      strategy: { goals: [{ kind: "hold", place: { ...actor.position }, ticks: HOLD_ORDER_TICKS }] } }] : []),
    { label: `keep away from hostiles`, strategy: { goals: [{ kind: "survive" }] } },
  ];
}

/**
 * @param {object} args
 * @param {Array<{name: string, simConfig: object, initialState: object}>} args.levels
 * @param {number} [args.startIndex]
 * @param {Function} [args.createSession] injectable for tests
 * @param {boolean} [args.fog] fog of war: you see only what is in sight (default on)
 * @param {boolean} [args.showHelp] start with the key help shown (default)
 */
export async function createGame({ levels, startIndex = 0, createSession = createPlaySession, fog = true, showHelp: initialHelp = true } = {}) {
  if (!Array.isArray(levels) || levels.length === 0) {
    throw new Error("createGame: at least one level is required");
  }
  let levelIndex = Math.max(0, Math.min(levels.length - 1, startIndex));
  let session = null;
  let turns = 0;
  let message = "";
  let showHelp = initialHelp;
  let finished = false;
  // An open panel: the affinity list, the target picker or the loot list. Opening,
  // browsing and closing one is free; only the command it sends takes a turn.
  let panel = null;

  async function startLevel(index) {
    levelIndex = index;
    const level = levels[levelIndex];
    session = await createSession({ simConfig: level.simConfig, initialState: level.initialState, fog });
    turns = 0;
    message = "";
    panel = null;
  }

  await startLevel(levelIndex);

  // `actorId` commands a party member other than the seated one (a label works too).
  async function act(command, describe = () => "", { actorId } = {}) {
    const before = session.status();
    if (actorId === undefined && (before.exited || before.defeated)) return null;
    const result = await session.act(command, actorId === undefined ? {} : { actorId });
    // A command the session refused outright (not your party, already gone) runs no tick.
    if (result.tick !== before.tick) turns += 1;
    const rejected = result.rejected[0];
    // At the exit, or once defeated, the status line already says what to do next.
    if (result.status.defeated) message = "";
    else if (rejected && !result.status.atExit) message = rejectionMessage(rejected.reason, session.view().player);
    else if (result.accepted.length > 0) message = describe();
    return result;
  }

  /** Seat another party member (an id or a label). Free: no turn passes. */
  function switchTo(ref) {
    panel = null;
    const result = session.switchTo(ref);
    if (!result.ok) {
      message = rejectionMessage(result.reason);
      return result;
    }
    const member = session.view().party.find((entry) => entry.id === result.actorId);
    message = `You now play ${result.actorId}${member?.label ? ` (${member.label})` : ""}.`;
    return result;
  }

  // Tab outside a panel: the next party member, in party order.
  function nextPartyMember() {
    const party = session.view().party || [];
    if (party.length < 2) {
      message = "No one else in your party to play.";
      return;
    }
    const at = party.findIndex((member) => member.active);
    switchTo(party[(at + 1) % party.length].id);
  }

  /** Give a party member or companion a new strategy (Phase 2b). Costs a turn when it lands. */
  async function order(actorId, strategy) {
    panel = null;
    const result = await session.order(actorId, strategy);
    if (!result.ok) {
      message = result.reason === "invalid_strategy" ? `That order does not make sense: ${result.error}` : rejectionMessage(result.reason);
      return result;
    }
    turns += 1;
    const member = (session.view().orders || []).find((entry) => entry.id === result.actorId);
    message = `${member?.label ?? result.actorId} takes the order.`;
    return result;
  }

  /** Let the world run up to `ticks` ticks, or until `until` (Phase 2b). */
  async function advance({ ticks, until } = {}) {
    panel = null;
    const result = await session.advance({ ticks, until });
    turns += result.ticks;
    message = result.stoppedBy === "contact" ? "Someone hostile comes into sight."
      : result.stoppedBy === "orders_done" ? "Every order has run its course." : "";
    return result;
  }

  /**
   * A structured command, for a caller that is not pressing keys (`--commands`):
   * `{ kind: "switch", actorId }`, `{ kind: "order", actorId, strategy }`,
   * `{ kind: "advance", ticks?, until? }`, or any play command with an optional `actorId`.
   * Targets and actors may be given by label. Returns what the session reported.
   */
  async function command(entry) {
    if (!entry || typeof entry !== "object") throw new Error("a command must be an object with a kind");
    message = "";
    if (entry.kind === "switch") return switchTo(entry.actorId);
    if (entry.kind === "order") return order(entry.actorId, entry.strategy);
    if (entry.kind === "advance") return advance({ ticks: entry.ticks ?? 1, until: entry.until });
    const { actorId, ...rest } = entry;
    const result = await act(rest, () => "", { actorId });
    return result ?? { accepted: [], rejected: [{ kind: rest.kind, reason: session.status().defeated ? "defeated" : "exited" }] };
  }

  // o: who to order. Party members and companions on your side, as the session says.
  function openOrders() {
    const items = session.view().orderable || [];
    if (items.length === 0) {
      message = "No one on your side to order.";
      return;
    }
    if (items.length === 1) openOrderChoices(items[0]);
    else panel = { type: "order_actor", items };
  }

  function openOrderChoices(target) {
    const view = session.view();
    const actor = (view.actors || []).find((entry) => entry.id === target.id)
      ?? (view.party || []).find((entry) => entry.id === target.id);
    const ours = new Set([...(view.orderable || []), ...(view.party || [])].map((entry) => entry.id));
    const nearest = targetsInSight(view).find(({ id }) => !ours.has(id));
    const hostile = nearest ? [...(view.actors || []), ...(view.hazards || [])].find((entry) => entry.id === nearest.id) : null;
    panel = { type: "order_goal", target, items: orderChoices({ playerId: view.player?.id, actor, hostile }) };
  }

  function openAffinities() {
    const affinities = session.view().player?.affinities || [];
    if (affinities.length === 0) {
      message = "You know no affinities yet.";
      return;
    }
    panel = { type: "affinities", items: affinities, index: 0 };
  }

  // + / - in the panel: run the highlighted equipped affinity one stack higher or
  // lower (#230). Re-equipping at a new level costs the turn; the panel stays open.
  async function relevel(step) {
    const pair = panel.items[panel.index];
    const player = session.view().player;
    if (!equippedKeys(player).includes(`${pair.kind}:${pair.expression}`)) {
      message = "Equip it first (press its number).";
      return;
    }
    const stacks = runningStacks(player, pair) + step;
    // Core refuses these too (InvalidAffinityStacks), but a refused command still
    // costs the turn; the bounds come from the view: 1 up to the stacks held.
    if (stacks < 1) {
      message = "It already runs at its lowest, 1 stack.";
      return;
    }
    if (stacks > pair.stacks) {
      message = `It already runs at all ${pair.stacks} stacks you hold.`;
      return;
    }
    await act({ kind: "equip_affinity", params: { affinityKey: `${pair.kind}:${pair.expression}`, stacks } },
      () => `${keyLabel(`${pair.kind}:${pair.expression}`)} now runs at ${stacks} of ${pair.stacks} stacks.`);
  }

  // Without a slot, core casts the first equipped push or pull.
  function openTargets(affinityKey) {
    const targets = targetsInSight(session.view());
    if (targets.length === 0) {
      message = "Nothing in sight to cast at.";
      return;
    }
    panel = { type: "target", items: targets, index: 0, ...(affinityKey ? { affinityKey } : {}) };
  }

  // A slot's digit outside a panel: aim that slot. Emit and draw need no cast.
  function aimSlot(index) {
    const player = session.view().player;
    const key = equippedKeys(player)[index];
    if (!key) {
      message = `Slot ${index + 1} is empty.`;
      return;
    }
    if (!castable(player)[key]) {
      message = `${keyLabel(key)} works on its own while equipped.`;
      return;
    }
    openTargets(key);
  }

  async function castAtTarget() {
    const target = panel.items[panel.index];
    const named = panel.affinityKey;
    panel = null;
    const player = session.view().player;
    const used = named ?? equippedKeys(player).find((key) => castable(player)[key]);
    await act({ kind: "cast_affinity", params: { targetId: target.id, ...(named ? { affinityKey: named } : {}) } },
      () => `You cast ${keyLabel(used)} at ${target.id}.`);
  }

  // A known affinity's digit in the panel: unequip it if equipped, else equip it
  // (core fills a free slot, or replaces the oldest when every slot is full).
  async function toggleAffinity(pair) {
    const key = `${pair.kind}:${pair.expression}`;
    const player = session.view().player;
    const equipped = equippedKeys(player);
    if (equipped.includes(key)) {
      await act({ kind: "unequip_affinity", params: { affinityKey: key } }, () => `Unequipped ${keyLabel(key)}.`);
      return;
    }
    const replaced = equipped.length >= (player?.affinitySlots ?? 1) ? equipped[0] : null;
    await act({ kind: "equip_affinity", params: { affinityKey: key } },
      () => `Equipped ${affinityLabel(pair)}${replaced ? ` in place of ${keyLabel(replaced)}` : ""}.`);
  }

  async function take(item) {
    panel = null;
    await act({ kind: "take", params: { targetId: item.targetId, holdingId: item.holdingId } },
      () => `You take ${lootLabel(item)} from ${item.targetId}.`);
  }

  async function openLoot() {
    const loot = session.view().loot || [];
    if (loot.length === 0) {
      message = "Nothing here to take.";
      return;
    }
    if (loot.length === 1) {
      await take(loot[0]);
      return;
    }
    panel = { type: "loot", items: loot };
  }

  // A panel answers its own keys; Esc (or q) closes it; any other key closes it and
  // then does what it always does.
  async function handlePanel(intent) {
    if (intent.type === INTENT.QUIT) {
      panel = null;
      return true;
    }
    if (panel.type === "target") {
      if (intent.type === INTENT.NEXT_TARGET) {
        panel.index = (panel.index + 1) % panel.items.length;
        return true;
      }
      if (intent.type === INTENT.NEXT_LEVEL || intent.type === INTENT.CAST) {
        await castAtTarget();
        return true;
      }
    } else if (panel.type === "affinities" && intent.type === INTENT.NEXT_TARGET) {
      panel.index = (panel.index + 1) % panel.items.length;
      return true;
    } else if (panel.type === "affinities" && (intent.type === INTENT.LEVEL_UP || intent.type === INTENT.LEVEL_DOWN)) {
      await relevel(intent.type === INTENT.LEVEL_UP ? 1 : -1);
      return true;
    } else if (intent.type === INTENT.SELECT) {
      const item = panel.items[intent.index];
      if (!item) return true;
      if (panel.type === "order_actor") {
        openOrderChoices(item);
        return true;
      }
      if (panel.type === "order_goal") {
        await order(panel.target.id, item.strategy);
        return true;
      }
      if (panel.type === "loot") {
        await take(item);
        return true;
      }
      panel = null;
      await toggleAffinity(item);
      return true;
    } else if (panel.type === "affinities" && intent.type === INTENT.AFFINITIES) {
      panel = null;
      return true;
    }
    panel = null;
    return false;
  }

  async function handle(intent) {
    if (!intent) return { quit: false };
    message = "";
    if (panel && await handlePanel(intent)) return { quit: false };
    switch (intent.type) {
      case INTENT.QUIT:
        return { quit: true };
      case INTENT.HELP:
        showHelp = !showHelp;
        break;
      case INTENT.RESTART:
        finished = false;
        await startLevel(levelIndex);
        break;
      case INTENT.NEXT_LEVEL:
        if (!session.status().exited) break;
        if (levelIndex + 1 < levels.length) {
          await startLevel(levelIndex + 1);
        } else {
          finished = true;
          message = "That was the last level. Press r to replay it or q to quit.";
        }
        break;
      case INTENT.WAIT:
        await act({ kind: "wait" });
        break;
      case INTENT.MOVE:
        await act({ kind: "move", params: { direction: intent.direction } });
        break;
      case INTENT.AFFINITIES:
        openAffinities();
        break;
      case INTENT.CAST:
        openTargets();
        break;
      case INTENT.SELECT:
        aimSlot(intent.index);
        break;
      case INTENT.TAKE:
        await openLoot();
        break;
      case INTENT.NEXT_TARGET:
        nextPartyMember();
        break;
      case INTENT.ORDER:
        openOrders();
        break;
      default:
        break;
    }
    return { quit: false };
  }

  function panelLines() {
    if (!panel) return null;
    if (panel.type === "affinities") {
      const player = session.view().player;
      const equipped = equippedKeys(player);
      return ["Affinities (a number equips or unequips; Tab picks, + / - change stacks; Esc closes):",
        ...panel.items.map((pair, i) => {
          const slot = equipped.indexOf(`${pair.kind}:${pair.expression}`);
          const running = runningStacks(player, pair);
          const at = slot >= 0 && running < pair.stacks ? `, running ${running}` : "";
          return `${i === panel.index ? ">" : " "} ${i + 1}) ${affinityLabel(pair)}${slot >= 0 ? `  [slot ${slot + 1}${at}]` : ""}`;
        })];
    }
    if (panel.type === "order_actor") {
      return ["Order who? (a number picks, Esc closes):",
        ...panel.items.map((item, i) => `  ${i + 1}) ${item.label ? `${item.label} ` : ""}${item.id}`)];
    }
    if (panel.type === "order_goal") {
      return [`Order ${panel.target.label ?? panel.target.id} to (a number gives the order, a turn; Esc closes):`,
        ...panel.items.map((item, i) => `  ${i + 1}) ${item.label}`)];
    }
    if (panel.type === "loot") {
      return ["Take (a number picks, Esc closes):",
        ...panel.items.map((item, i) => `  ${i + 1}) ${item.kind === "vital" ? item.holdingId : lootLabel(item)} from ${item.targetId}`)];
    }
    const target = panel.items[panel.index];
    const player = session.view().player;
    const key = panel.affinityKey ?? equippedKeys(player).find((k) => castable(player)[k]);
    const reach = key ? castable(player)[key]?.range : undefined;
    const tiles = (n) => `${n} ${n === 1 ? "tile" : "tiles"}`;
    return [`Target: ${target.id}${motivationNote(target.motivations)}${panel.affinityKey ? ` with ${keyLabel(panel.affinityKey)}` : ""} (${tiles(target.distance)} away${reach !== undefined ? `, reaches ${tiles(reach)}` : ""})   Tab next, Enter cast, Esc cancel`];
  }

  function screen({ color = false } = {}) {
    return renderScreen({
      view: session.view(),
      levelName: levels[levelIndex].name,
      levelIndex,
      levelCount: levels.length,
      turns,
      message,
      showHelp,
      color,
      panel: panelLines(),
    });
  }

  function state() {
    return {
      levelIndex,
      levelName: levels[levelIndex].name,
      turns,
      status: session.status(),
      finished,
      message,
      panel: panel?.type ?? null,
      active: session.activeActorId?.() ?? null,
      party: session.view().party ?? [],
      orders: session.view().orders ?? [],
      warnings: [...(session.pricingReport || []).map(({ message: text }) => text), ...viabilityWarnings()],
    };
  }

  /** The Configurator's report on this level's actors below the viability floor, worded. */
  function viabilityWarnings() {
    return (session.viabilityReport || []).map(({ actorId, vital, field, value, floor }) =>
      `${actorId} ${vital} ${field} is ${value}, below the viability floor of ${floor}.`);
  }

  /** This level's played commands as a player capture (#204), naming the level it was played on. */
  function captureInput(meta) {
    const capture = session.captureInput({ meta });
    return { ...capture, source: { ...capture.source, request: { level: levels[levelIndex].name } } };
  }

  /** Re-run a capture on the current level and continue from where it ended. */
  async function replay(capture) {
    const level = levels[levelIndex];
    session = await replayPlaySession({ simConfig: level.simConfig, initialState: level.initialState, capturedInput: capture, fog });
    turns = capture.payload.commands.length;
    message = "";
    panel = null;
    finished = false;
  }

  /** The play session's current view (board, player, party, actors in sight). */
  const view = () => session.view();

  return { handle, command, switchTo, screen, state, view, captureInput, replay };
}
