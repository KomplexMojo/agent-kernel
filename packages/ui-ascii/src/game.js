/**
 * The game controller: turns intents into play-session commands and tracks
 * presentation state (which level, how many turns, the last message). No
 * terminal IO and no rules — `cli.mjs` owns the terminal, the runtime play
 * session owns the simulation.
 */
import { createPlaySession, PLAY_DIRECTION_STEPS, replayPlaySession } from "../../runtime/src/runner/play-session.js";
import { INTENT } from "./keymap.js";
import { renderScreen, revealedDetail, revealNote, slotLevelLabel } from "./screen.js";
import { HUD_VITAL_LABELS } from "../../runtime/src/render/actor-hud-model.js";

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
  InvalidAffinityStacks: "You cannot run it at that range.",
  InvalidAffinityIntensity: "You cannot run it at that intensity.",
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

/** An affinity as held: kind, expression, range and intensity, e.g. `fire push r6 ×2` (#345). */
export function affinityLabel(pair) {
  return `${pair.kind} ${pair.expression} ${slotLevelLabel(null, pair)}`;
}

/**
 * What an equipped affinity runs at, per number: what is held unless run lower. `stacks`
 * is its range (#230), `intensity` its strength (#345).
 */
const LEVELS = Object.freeze({
  stacks: { running: "equippedAffinityStacks", held: (pair) => pair.stacks, name: "range" },
  intensity: { running: "equippedAffinityIntensity", held: (pair) => pair.intensity ?? 1, name: "intensity" },
});
function runningLevel(player, pair, field) {
  const running = player?.[LEVELS[field].running]?.[`${pair.kind}:${pair.expression}`];
  return Number.isInteger(running) ? running : LEVELS[field].held(pair);
}

/** Where an aimed tile is from the player, in steps: "2 east, 1 north of you". */
function aimLabel(from, to) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const parts = [...(dx ? [`${Math.abs(dx)} ${dx > 0 ? "east" : "west"}`] : []),
    ...(dy ? [`${Math.abs(dy)} ${dy > 0 ? "south" : "north"}`] : [])];
  return parts.length ? `${parts.join(", ")} of you` : "under you";
}

function keyLabel(affinityKey) {
  return String(affinityKey || "").replace(":", " ");
}

/** A vital change as the HUD names it: `HP −8`, `MP +3` (#463). */
function changeLabel({ vital, delta }) {
  return `${HUD_VITAL_LABELS[vital] ?? vital} ${delta < 0 ? "\u2212" : "+"}${Math.abs(delta)}`;
}

/**
 * The battle lines of the last tick (#463): the player's own hit (`You hit W1 with decay push:
 * HP −8`) and every hit on the player by others (`W1 hits you with growth push: HP +3`),
 * from the casts the play session reports. Self-casts and casts at nobody have no line.
 */
export function battleLines(view) {
  const me = view.player?.id;
  const name = (id, label) => label ?? id;
  const lines = { own: null, others: [] };
  for (const cast of view.casts || []) {
    if (!cast.targetId || cast.targetId === cast.sourceId || !me) continue;
    const changes = cast.changes.filter((change) => change.actorId === cast.targetId);
    const what = `${cast.kind} ${cast.expression}: ${changes.length ? changes.map(changeLabel).join(", ") : "no effect"}`;
    if (cast.sourceId === me) lines.own = `You hit ${name(cast.targetId, cast.targetLabel)} with ${what}`;
    else if (cast.targetId === me) lines.others.push(`${name(cast.sourceId, cast.sourceLabel)} hits you with ${what}`);
  }
  return lines;
}

const signed = (value) => `${value < 0 ? "\u2212" : "+"}${Math.abs(value)}`;
const VITAL_LINE_LIMIT = 3;

/**
 * What hit whom last tick and what regen gave back (#410), e.g. `W1 DU 10/10 (−1 +1)`, so a
 * hit regen cancels is still seen landing. The player's own line comes first (`You HP ...`);
 * only vitals that were hit are named, at most three.
 */
export function vitalChangeLine(view) {
  const me = view.player?.id;
  const hits = (view.vitalChanges || []).filter((change) => change.hit !== 0)
    .sort((left, right) => Number(right.actorId === me) - Number(left.actorId === me));
  return hits.slice(0, VITAL_LINE_LIMIT).map((change) => {
    const who = change.actorId === me ? "You" : change.label ?? change.actorId;
    const regen = change.regen !== 0 ? ` ${signed(change.regen)}` : "";
    return `${who} ${HUD_VITAL_LABELS[change.vital] ?? change.vital} ${change.current}/${change.max} (${signed(change.hit)}${regen})`;
  }).join("  ");
}

/** The equipped slots core would cast, with their reach, as the play session reports them. */
const castable = (player) => player?.castableAffinities || {};

/** Equipped keys in equip order, as the play session reports them. */
const equippedKeys = (player) => player?.equippedAffinityKeys || [];

/** What a vital grant changes: `MP max +5, regen +1` for a lasting grant, `HP +5` for a consumable (#487). */
function grantLabel(item) {
  const lasting = item.permanenceMode !== "consumable";
  return (item.vitals || []).map((grant) => {
    const name = HUD_VITAL_LABELS[grant.key] ?? grant.key;
    const sign = (n) => `${n < 0 ? "\u2212" : "+"}${Math.abs(n)}`;
    return [`${name}${lasting ? " max" : ""} ${sign(grant.delta)}`, ...(grant.regen ? [`regen ${sign(grant.regen)}`] : [])].join(", ");
  }).join("; ");
}

function lootLabel(item) {
  if (item.kind === "affinity") return `${item.affinity} ${item.expression}`;
  if (item.kind === "slot") return item.slots === 1 ? "a new affinity slot" : `${item.slots} new affinity slots`;
  return item.vitals?.length ? grantLabel(item) : "a vital boost";
}

/** Why `g` finds nothing (#479): who is next to the player and why their holdings are closed. */
function takeRefusal(view) {
  const from = view.player?.position;
  const near = from ? [...(view.actors || []), ...(view.hazards || [])]
    .filter((actor) => actor.position && Math.max(Math.abs(actor.position.x - from.x), Math.abs(actor.position.y - from.y)) <= 1) : [];
  if (near.length === 0) return "Nothing here to take.";
  const spent = near.filter((actor) => actor.role === "resource");
  if (spent.length > 0) return `${spent[0].id} has nothing left to take.`;
  const other = near[0];
  return `${other.label ?? other.id} is still standing: defeat it first, then g takes what it held.`;
}

const chebyshev = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));

/** Everyone in sight the player could aim at, nearest first. Range is core's to judge. */
function targetsInSight(view) {
  const from = view.player?.position;
  if (!from) return [];
  return [...(view.actors || []), ...(view.hazards || [])]
    .map((actor) => ({ id: actor.id, distance: chebyshev(from, actor.position), motivations: actor.motivations ?? [],
      ...(actor.revealed !== undefined ? { revealed: actor.revealed } : {}), vitals: actor.vitals, affinities: actor.affinities }))
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
  // `x` arms a sprint for the next move (#437), for keyboards and screens without shift.
  let sprintArmed = false;

  async function startLevel(index) {
    levelIndex = index;
    const level = levels[levelIndex];
    session = await createSession({ simConfig: level.simConfig, initialState: level.initialState, fog });
    turns = 0;
    message = "";
    panel = null;
    sprintArmed = false;
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
    // #463: name what the tick's casts did to and by the player.
    if (result.tick !== before.tick && !result.status.defeated) {
      const battle = battleLines(session.view());
      if (battle.own && result.accepted.length > 0) message = battle.own;
      message = [message, ...battle.others, vitalChangeLine(session.view())].filter(Boolean).join("   ");
    }
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

  // In the panel, + / - run the highlighted equipped affinity one range higher or lower
  // (#230) and ] / [ one intensity higher or lower (#345). Re-equipping at a new level
  // costs the turn; the panel stays open.
  async function relevel(field, step) {
    const pair = panel.items[panel.index];
    const player = session.view().player;
    const affinityKey = `${pair.kind}:${pair.expression}`;
    if (!equippedKeys(player).includes(affinityKey)) {
      message = "Equip it first (press its number).";
      return;
    }
    const { name, held } = LEVELS[field];
    const value = runningLevel(player, pair, field) + step;
    // Core refuses these too (InvalidAffinityStacks / InvalidAffinityIntensity), but a refused
    // command still costs the turn; the bounds come from the view: 1 up to what is held.
    if (value < 1) {
      message = `It already runs at its lowest ${name}, 1.`;
      return;
    }
    if (value > held(pair)) {
      message = `It already runs at all the ${name} you hold, ${held(pair)}.`;
      return;
    }
    // Both numbers go with every re-level, so changing one keeps the other where it runs.
    const levels = { stacks: runningLevel(player, pair, "stacks"), intensity: runningLevel(player, pair, "intensity"), [field]: value };
    await act({ kind: "equip_affinity", params: { affinityKey, ...levels } },
      () => `${keyLabel(affinityKey)} now runs at ${name} ${value} of ${held(pair)}.`);
  }

  // Without a slot, core casts the first equipped push or pull. With nothing in sight the
  // cast aims at a tile instead (#413).
  function openTargets(affinityKey) {
    const targets = targetsInSight(session.view());
    if (targets.length === 0) {
      openAim(affinityKey);
      return;
    }
    panel = { type: "target", items: targets, index: 0, ...(affinityKey ? { affinityKey } : {}) };
  }

  // Aiming at a tile (#413): the cursor starts on the player and moves with the move keys.
  // A cast travels the line and hits the first actor or wall (#461); `raise` (key z, #460)
  // raises barriers there instead.
  function openAim(affinityKey, step = null, raise = false) {
    const at = session.view().player?.position;
    if (!at) return;
    panel = { type: "aim", cursor: { x: at.x + (step?.dx ?? 0), y: at.y + (step?.dy ?? 0) },
      ...(affinityKey ? { affinityKey } : {}), ...(raise ? { raise: true } : {}) };
  }

  // z (#460): aim the first equipped push at a tile to raise barriers there.
  function openRaise() {
    const player = session.view().player;
    const key = equippedKeys(player).find((k) => k.endsWith(":push"));
    if (!key) {
      message = "Equip a push to raise a barrier.";
      return;
    }
    openAim(key, null, true);
  }

  async function castAtTile() {
    const { cursor, affinityKey: named, raise } = panel;
    panel = null;
    const player = session.view().player;
    const used = named ?? equippedKeys(player).find((key) => castable(player)[key]);
    const at = player?.position ?? cursor;
    const params = { target: { ...cursor }, ...(named ? { affinityKey: named } : {}) };
    if (raise) {
      await act({ kind: "raise_barrier", params }, () => `You raise ${keyLabel(used)} ${aimLabel(at, cursor)}.`);
      return;
    }
    await act({ kind: "cast_affinity", params }, () => `You cast ${keyLabel(used)} ${aimLabel(at, cursor)}.`);
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
      () => {
        // An intact resource stays standing after it is taken from; say so once nothing is left in it.
        const spent = item.intact && !(session.view().loot || []).some((other) => other.targetId === item.targetId);
        return item.kind === "vital"
          ? `You take ${item.targetId}: ${lootLabel(item)}.${item.intact ? ` It stays on the floor${spent ? ", spent" : ""}.` : ""}`
          : `You take ${lootLabel(item)} from ${item.targetId}.`;
      });
  }

  async function openLoot() {
    const view = session.view();
    const loot = view.loot || [];
    if (loot.length === 0) {
      message = takeRefusal(view);
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
    if (panel.type === "aim") {
      if (intent.type === INTENT.MOVE) {
        const step = PLAY_DIRECTION_STEPS[intent.direction];
        panel.cursor = { x: panel.cursor.x + step.dx, y: panel.cursor.y + step.dy };
        return true;
      }
      if (intent.type === INTENT.NEXT_LEVEL || intent.type === INTENT.CAST || (panel.raise && intent.type === INTENT.RAISE)) {
        await castAtTile();
        return true;
      }
      if (intent.type === INTENT.NEXT_TARGET && !panel.raise) {
        const { affinityKey } = panel;
        panel = null;
        if (targetsInSight(session.view()).length > 0) openTargets(affinityKey);
        else openAim(affinityKey);
        return true;
      }
    }
    if (panel.type === "target") {
      // A move key leaves the target list to aim at a tile, one step that way (#413).
      if (intent.type === INTENT.MOVE) {
        openAim(panel.affinityKey, PLAY_DIRECTION_STEPS[intent.direction]);
        return true;
      }
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
      await relevel("stacks", intent.type === INTENT.LEVEL_UP ? 1 : -1);
      return true;
    } else if (panel.type === "affinities" && (intent.type === INTENT.INTENSITY_UP || intent.type === INTENT.INTENSITY_DOWN)) {
      await relevel("intensity", intent.type === INTENT.INTENSITY_UP ? 1 : -1);
      return true;
    } else if (intent.type === INTENT.SELECT) {
      const item = panel.items?.[intent.index]; // the aim panel has no list (a digit there is ignored)
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
      case INTENT.MOVE: {
        // Sprint (#437): shift+move, or x armed before the move; two tiles for more stamina.
        const sprint = Boolean(intent.sprint) || sprintArmed;
        sprintArmed = false;
        await act({ kind: "move", params: { direction: intent.direction, ...(sprint ? { sprint: true } : {}) } },
          () => (sprint ? "You sprint." : ""));
        break;
      }
      case INTENT.SPRINT:
        sprintArmed = !sprintArmed;
        message = sprintArmed ? "Sprint: your next move takes two tiles, for more stamina." : "Sprint off.";
        break;
      case INTENT.AFFINITIES:
        openAffinities();
        break;
      case INTENT.CAST:
        openTargets();
        break;
      case INTENT.RAISE:
        openRaise();
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
      return ["Affinities (a number equips or unequips; Tab picks, + / - range, ] / [ intensity; Esc closes):",
        ...panel.items.map((pair, i) => {
          const slot = equipped.indexOf(`${pair.kind}:${pair.expression}`);
          const lowered = ["stacks", "intensity"].some((field) => runningLevel(player, pair, field) < LEVELS[field].held(pair));
          const at = slot >= 0 && lowered
            ? `, running r${runningLevel(player, pair, "stacks")} ×${runningLevel(player, pair, "intensity")}` : "";
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
        ...panel.items.map((item, i) => `  ${i + 1}) ${lootLabel(item)} from ${item.targetId}`)];
    }
    const player = session.view().player;
    const key = panel.affinityKey ?? equippedKeys(player).find((k) => castable(player)[k]);
    const reach = key ? castable(player)[key]?.range : undefined;
    const tiles = (n) => `${n} ${n === 1 ? "tile" : "tiles"}`;
    if (panel.type === "aim") {
      const at = player?.position ?? panel.cursor;
      const away = Math.max(Math.abs(panel.cursor.x - at.x), Math.abs(panel.cursor.y - at.y));
      return [`${panel.raise ? "Raise" : "Aim"}: the tile ${aimLabel(at, panel.cursor)}${key ? ` with ${keyLabel(key)}` : ""} (${tiles(away)} away${reach !== undefined ? `, reaches ${tiles(reach)}` : ""})`,
        panel.raise ? "  Move keys aim, Enter raises a barrier line there, Esc cancels"
          : "  Move keys aim, Enter casts along the line: it hits the first actor or wall, Tab targets, Esc cancels"];
    }
    const target = panel.items[panel.index];
    return [`Target: ${target.id}${revealNote(target)}${target.revealed !== undefined ? revealedDetail(target) : ""}${panel.affinityKey ? ` with ${keyLabel(panel.affinityKey)}` : ""} (${tiles(target.distance)} away${reach !== undefined ? `, reaches ${tiles(reach)}` : ""})   Tab next, Enter cast, Esc cancel`];
  }

  function screen({ color = false } = {}) {
    return renderScreen({
      view: session.view(),
      levelName: levels[levelIndex].name,
      grade: levels[levelIndex].simConfig?.meta?.cost?.grade ?? null,
      levelIndex,
      levelCount: levels.length,
      turns,
      message,
      showHelp,
      color,
      panel: panelLines(),
      aim: panel?.type === "aim" ? panel.cursor : null,
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

  /** #500: the whole level for the analysis console (`--debug`), read from the play session. */
  const debugView = () => session.debugView();
  return { handle, command, switchTo, screen, state, view, debugView, captureInput, replay };
}
