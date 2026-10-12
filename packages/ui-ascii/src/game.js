/**
 * The game controller: turns intents into play-session commands and tracks
 * presentation state (which level, how many turns, the last message). No
 * terminal IO and no rules — `cli.mjs` owns the terminal, the runtime play
 * session owns the simulation.
 */
import { createPlaySession } from "../../runtime/src/runner/play-session.js";
import { INTENT } from "./keymap.js";
import { renderScreen } from "./screen.js";

/** Friendlier words for core's rejection codes; the raw name is the fallback. */
const REJECTION_MESSAGES = Object.freeze({
  BlockedByWall: "A wall blocks the way.",
  ActorCollision: "Something is in the way.",
  OutOfBounds: "You cannot leave the map that way.",
  InsufficientStamina: "Too tired to move.",
  InsufficientMana: "Not enough mana.",
  NoActiveAffinity: "Nothing is equipped. Press i to equip an affinity.",
  AffinityNotCastable: "Emit and draw work on their own while equipped. Only push and pull are cast.",
  TargetOutOfRange: "Out of range. Push and pull reach one tile per stack.",
  InvalidTarget: "That cannot be targeted.",
  UnknownAffinity: "You do not know that affinity.",
  AffinityAlreadyEquipped: "That affinity is already equipped.",
  AffinityNotEquipped: "That affinity is not equipped.",
  NothingToTake: "Nothing left to take there.",
  NotAdjacent: "Too far away to take that.",
  InvalidCapability: "You cannot do that.",
});

const CASTABLE_EXPRESSIONS = new Set(["push", "pull"]);

function rejectionMessage(reason) {
  return REJECTION_MESSAGES[reason] || `Rejected (${reason}).`;
}

export function affinityLabel(pair) {
  return `${pair.kind} ${pair.expression} ×${pair.stacks}`;
}

function keyLabel(affinityKey) {
  return String(affinityKey || "").replace(":", " ");
}

function pairKey(pair) {
  return `${pair.kind}:${pair.expression}`;
}

const chebyshev = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));

/** Everyone in sight the player could aim at, nearest first. Range is core's to judge. */
function targetsInSight(view) {
  const from = view.player?.position;
  if (!from) return [];
  return [...(view.actors || []), ...(view.hazards || [])]
    .map((actor) => ({ id: actor.id, distance: chebyshev(from, actor.position) }))
    .sort((a, b) => a.distance - b.distance || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** Equipped push/pull pairs the player can name in a cast, in equip order. */
function castableEquipped(view) {
  const player = view.player;
  if (!player) return [];
  const known = new Map((player.affinities || []).map((pair) => [pairKey(pair), pair]));
  return (player.equippedAffinityKeys || [])
    .map((key) => {
      const pair = known.get(key);
      return pair && CASTABLE_EXPRESSIONS.has(pair.expression) ? { key, ...pair } : null;
    })
    .filter(Boolean);
}

/**
 * @param {object} args
 * @param {Array<{name: string, simConfig: object, initialState: object}>} args.levels
 * @param {number} [args.startIndex]
 * @param {Function} [args.createSession] injectable for tests
 * @param {boolean} [args.fog] fog of war: you see only what is in sight (default on)
 */
export async function createGame({ levels, startIndex = 0, createSession = createPlaySession, fog = true } = {}) {
  if (!Array.isArray(levels) || levels.length === 0) {
    throw new Error("createGame: at least one level is required");
  }
  let levelIndex = Math.max(0, Math.min(levels.length - 1, startIndex));
  let session = null;
  let turns = 0;
  let message = "";
  let showHelp = true;
  let finished = false;
  // An open panel: affinities, replace-slot, cast affinity pick, target picker, loot.
  // Opening, browsing and closing one is free; only the command it sends takes a turn.
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

  async function act(command, describe = () => "") {
    if (session.status().exited) return;
    const result = await session.act(command);
    turns += 1;
    const rejected = result.rejected[0];
    // At the exit the status line already says how to step through.
    if (rejected && !result.status.atExit) message = rejectionMessage(rejected.reason);
    else if (result.accepted.length > 0) message = describe();
  }

  function openAffinities() {
    const affinities = session.view().player?.affinities || [];
    if (affinities.length === 0) {
      message = "You know no affinities yet.";
      return;
    }
    panel = { type: "affinities", items: affinities };
  }

  function openUnequip() {
    const equipped = session.view().player?.equippedAffinityKeys || [];
    if (equipped.length === 0) {
      message = "Nothing is equipped.";
      return;
    }
    panel = { type: "unequip", items: equipped };
  }

  function openTargets(affinityKey = null) {
    const targets = targetsInSight(session.view());
    if (targets.length === 0) {
      message = "Nothing in sight to cast at.";
      return;
    }
    panel = { type: "target", items: targets, index: 0, affinityKey };
  }

  function openCast() {
    const castables = castableEquipped(session.view());
    if (castables.length > 1) {
      panel = { type: "cast_pick", items: castables };
      return;
    }
    openTargets(castables[0]?.key ?? null);
  }

  async function castAtTarget() {
    const target = panel.items[panel.index];
    const affinityKey = panel.affinityKey;
    panel = null;
    const params = { targetId: target.id };
    if (affinityKey) params.affinityKey = affinityKey;
    const active = affinityKey || session.view().player?.activeAffinityKey;
    await act({ kind: "cast_affinity", params },
      () => `You cast ${keyLabel(active)} at ${target.id}.`);
  }

  async function take(item) {
    panel = null;
    await act({ kind: "take", params: { targetId: item.targetId, holdingId: item.holdingId } },
      () => `You take ${item.kind === "affinity" ? `${item.affinity} ${item.expression}` : "a vital boost"} from ${item.targetId}.`);
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

  async function equipAffinity(pair, replaceKey = undefined) {
    const affinityKey = pairKey(pair);
    const params = { affinityKey };
    if (replaceKey) params.replaceKey = replaceKey;
    panel = null;
    await act({ kind: "equip_affinity", params },
      () => replaceKey
        ? `Equipped ${affinityLabel(pair)} (replaced ${keyLabel(replaceKey)}).`
        : `Equipped ${affinityLabel(pair)}.`);
  }

  async function unequipKey(affinityKey) {
    panel = null;
    await act({ kind: "unequip_affinity", params: { affinityKey } },
      () => `Unequipped ${keyLabel(affinityKey)}.`);
  }

  async function selectFromAffinities(index) {
    const pair = panel.items[index];
    if (!pair) return;
    const key = pairKey(pair);
    const player = session.view().player;
    const equipped = player?.equippedAffinityKeys || [];
    if (equipped.includes(key)) {
      await unequipKey(key);
      return;
    }
    const slots = player?.affinitySlots ?? 1;
    if (equipped.length >= slots) {
      panel = { type: "replace", items: equipped, pending: pair };
      return;
    }
    await equipAffinity(pair);
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
    } else if (panel.type === "cast_pick") {
      if (intent.type === INTENT.SELECT) {
        const item = panel.items[intent.index];
        if (!item) return true;
        panel = null;
        openTargets(item.key);
        return true;
      }
      if (intent.type === INTENT.CAST) {
        panel = null;
        return true;
      }
    } else if (panel.type === "replace") {
      if (intent.type === INTENT.SELECT) {
        const replaceKey = panel.items[intent.index];
        if (!replaceKey) return true;
        await equipAffinity(panel.pending, replaceKey);
        return true;
      }
    } else if (intent.type === INTENT.SELECT) {
      const item = panel.items[intent.index];
      if (!item) return true;
      if (panel.type === "loot") {
        await take(item);
        return true;
      }
      if (panel.type === "unequip") {
        await unequipKey(item);
        return true;
      }
      if (panel.type === "affinities") {
        await selectFromAffinities(intent.index);
        return true;
      }
    } else if (panel.type === "affinities" && intent.type === INTENT.AFFINITIES) {
      panel = null;
      return true;
    } else if (panel.type === "unequip" && intent.type === INTENT.UNEQUIP) {
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
      case INTENT.UNEQUIP:
        openUnequip();
        break;
      case INTENT.CAST:
        openCast();
        break;
      case INTENT.TAKE:
        await openLoot();
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
      const equipped = new Set(player?.equippedAffinityKeys || []);
      const slots = player?.affinitySlots ?? 1;
      return [
        `Affinities ${equipped.size}/${slots} equipped (a number equips or unequips, Esc closes):`,
        ...panel.items.map((pair, i) => {
          const key = pairKey(pair);
          const mark = equipped.has(key) ? "  [equipped]" : "";
          return `  ${i + 1}) ${affinityLabel(pair)}${mark}`;
        }),
      ];
    }
    if (panel.type === "replace") {
      return [
        `Slots full — replace which for ${affinityLabel(panel.pending)}?`,
        ...panel.items.map((key, i) => `  ${i + 1}) ${keyLabel(key)}`),
      ];
    }
    if (panel.type === "unequip") {
      return [
        "Unequip (a number picks, Esc closes):",
        ...panel.items.map((key, i) => `  ${i + 1}) ${keyLabel(key)}`),
      ];
    }
    if (panel.type === "cast_pick") {
      return [
        "Cast which affinity? (a number picks, Esc cancels):",
        ...panel.items.map((item, i) => `  ${i + 1}) ${affinityLabel(item)}`),
      ];
    }
    if (panel.type === "loot") {
      return ["Take (a number picks, Esc closes):",
        ...panel.items.map((item, i) => `  ${i + 1}) ${item.kind === "affinity" ? `${item.affinity} ${item.expression}` : item.holdingId} from ${item.targetId}`)];
    }
    const target = panel.items[panel.index];
    const affinity = panel.affinityKey ? ` with ${keyLabel(panel.affinityKey)}` : "";
    return [`Target: ${target.id} (${target.distance} ${target.distance === 1 ? "tile" : "tiles"} away)${affinity}   Tab next, Enter cast, Esc cancel`];
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
    };
  }

  return { handle, screen, state };
}
