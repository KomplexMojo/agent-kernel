/**
 * The game controller (#505, step 1b): turns intents into play-session commands and tracks
 * presentation state (which level, how many turns, the last message, the open panel). No terminal
 * IO and no rules: the runtime play session owns the simulation, and a client draws `frame()` its own
 * way (the terminal client's `createGame` adds the ASCII screen on top of this).
 */
import { createPlaySession, PLAY_DIRECTION_STEPS, replayPlaySession } from "../runner/play-session.js";
import { INTENT } from "./intents.js";
import { affinityRole } from "../render/affinity-role.js";
import { AFFINITY_COLOR_HEX } from "../render/affinity-palette.js";
import { WINDOW_DEFAULT } from "../render/window-size.js";
import { LEVELS, affinityLabel, aimLabel, allyWarningLines, battleLines, castable, currentMana, equippedKeys, keyLabel, lootLabel, orderChoices, rejectionMessage, runningLevel, takeRefusal, targetsInSight, vitalChangeLine } from "./messages.js";

/**
 * @param {object} args
 * @param {Array<{name: string, simConfig: object, initialState: object}>} args.levels
 * @param {number} [args.startIndex]
 * @param {Function} [args.createSession] injectable for tests
 * @param {boolean} [args.fog] fog of war: you see only what is in sight (default on)
 * @param {boolean} [args.showHelp] start with the key help shown (default)
 */
export async function createGameController({ levels, startIndex = 0, createSession = createPlaySession, fog = true, showHelp: initialHelp = true, glyphSet = "unicode", window: initialWindow = WINDOW_DEFAULT } = {}) {
  let windowSize = initialWindow;
  if (!Array.isArray(levels) || levels.length === 0) {
    throw new Error("createGame: at least one level is required");
  }
  let levelIndex = Math.max(0, Math.min(levels.length - 1, startIndex));
  let session = null;
  let turns = 0;
  let message = "";
  // #757: the sound cues of the last call that ran a tick (the session's turn result), for a client with audio.
  let cues = [];
  let showHelp = initialHelp;
  let finished = false;
  // An open panel: the affinity list, the target picker or the loot list. Opening,
  // browsing and closing one is free; only the command it sends takes a turn.
  let panel = null;
  // `x` / Sprint toggles sticky sprint (#437 / sticky latch): every move sprints until toggled off.
  let sprintArmed = false;

  async function startLevel(index) {
    levelIndex = index;
    const level = levels[levelIndex];
    session = await createSession({ simConfig: level.simConfig, initialState: level.initialState, fog, glyphSet,
      ...(level.costing ? { costing: level.costing } : {}) });
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
    const playerBefore = actorId === undefined ? session.view().player : null;
    const result = await session.act(command, actorId === undefined ? {} : { actorId });
    cues = result.cues ?? [];
    // A command the session refused outright (not your party, already gone) runs no tick.
    if (result.tick !== before.tick) turns += 1;
    const rejected = result.rejected[0];
    // At the exit, or once defeated, the status line already says what to do next.
    if (result.status.defeated) message = "";
    else if (rejected && !result.status.atExit) message = rejectionMessage(rejected.reason, playerBefore, rejected.params);
    else if (result.accepted.length > 0) message = describe();
    // #463: name what the tick's casts did to and by the player.
    if (result.tick !== before.tick && !result.status.defeated) {
      const battle = battleLines(session.view());
      if (battle.own && result.accepted.length > 0) message = battle.own;
      message = [message, ...battle.others, ...allyWarningLines(session.view()), vitalChangeLine(session.view())].filter(Boolean).join("   ");
    }
    return result;
  }

  /** One tick commanding several `ai_controlled` actors (#680); refused entries come back in `rejected`. */
  async function tickAll(actorCommands) {
    panel = null;
    const before = session.status();
    const result = await session.actTick(actorCommands);
    cues = result.cues ?? [];
    if (result.tick !== before.tick) turns += 1;
    message = "";
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
    cues = result.cues ?? [];
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
    cues = result.cues ?? [];
    turns += result.ticks;
    message = result.stoppedBy === "contact" ? "Someone hostile comes into sight."
      : result.stoppedBy === "orders_done" ? "Every order has run its course." : "";
    return result;
  }

  /**
   * A structured command, for a caller that is not pressing keys (`--commands`):
   * `{ kind: "switch", actorId }`, `{ kind: "order", actorId, strategy }`,
   * `{ kind: "advance", ticks?, until? }`, `{ kind: "tick", actorCommands: { actorId: command } }`
   * (one tick for several `ai_controlled` actors, #680), or any play command with an optional `actorId`.
   * Targets and actors may be given by label. Returns what the session reported.
   */
  async function command(entry) {
    if (!entry || typeof entry !== "object") throw new Error("a command must be an object with a kind");
    message = "";
    cues = [];
    if (entry.kind === "switch") return switchTo(entry.actorId);
    if (entry.kind === "order") return order(entry.actorId, entry.strategy);
    if (entry.kind === "advance") return advance({ ticks: entry.ticks ?? 1, until: entry.until });
    if (entry.kind === "tick") return tickAll(entry.actorCommands);
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

  // #497: `v` picks a target in sight and spends a turn looking at it.
  function openInspect() {
    const targets = targetsInSight(session.view());
    if (targets.length === 0) {
      message = "Nothing in sight to inspect.";
      return;
    }
    panel = { type: "target", items: targets, index: 0, inspect: true };
  }

  // #519: `e` picks a target in sight to watch (a mana upkeep a turn) or, if already watched, to stop watching.
  function openWatch() {
    const view = session.view();
    const targets = targetsInSight(view);
    if (targets.length === 0) {
      message = "Nothing in sight to watch.";
      return;
    }
    const watched = new Set((view.inspections ?? []).filter((entry) => entry.watched).map((entry) => entry.id));
    panel = { type: "target", items: targets.map((target) => ({ ...target, watched: watched.has(target.id) })), index: 0, watch: true };
  }

  async function watchTarget() {
    const target = panel.items[panel.index];
    panel = null;
    await act({ kind: "watch", params: { targetId: target.id } },
      () => (target.watched ? `You stop watching ${target.id}.` : `You watch ${target.id}.`));
  }

  async function inspectTarget() {
    const target = panel.items[panel.index];
    panel = null;
    await act({ kind: "inspect", params: { targetId: target.id } }, () => `You study ${target.id}.`);
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
      const barrierCells = () => {
        const { rows, legend } = session.view();
        return rows.reduce((total, row) => total + [...row].filter((glyph) => glyph === legend.barrier).length, 0);
      };
      const had = barrierCells();
      await act({ kind: "raise_barrier", params }, () => {
        const count = barrierCells() - had;
        return `You raise ${keyLabel(used)} ${aimLabel(at, cursor)}: ${count} barrier${count === 1 ? "" : "s"}.`;
      });
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
  // `replaceKey` (an equipped key) names the slot a packed affinity swaps into, in the one turn;
  // without it, full slots make the oldest give way (core's rule).
  async function toggleAffinity(pair, replaceKey = null) {
    const key = `${pair.kind}:${pair.expression}`;
    const player = session.view().player;
    const equipped = equippedKeys(player);
    if (equipped.includes(key)) {
      await act({ kind: "unequip_affinity", params: { affinityKey: key } }, () => `Unequipped ${keyLabel(key)}.`);
      return;
    }
    const named = replaceKey && equipped.includes(replaceKey) ? replaceKey : null;
    const replaced = named ?? (equipped.length >= (player?.affinitySlots ?? 1) ? equipped[0] : null);
    await act({ kind: "equip_affinity", params: { affinityKey: key, ...(named ? { replaceKey: named } : {}) } },
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
      if (intent.type === INTENT.MOVE && !panel.inspect && !panel.watch) {
        openAim(panel.affinityKey, PLAY_DIRECTION_STEPS[intent.direction]);
        return true;
      }
      if (intent.type === INTENT.NEXT_TARGET) {
        panel.index = (panel.index + 1) % panel.items.length;
        return true;
      }
      if (intent.type === INTENT.NEXT_LEVEL || intent.type === INTENT.CAST || (panel.inspect && intent.type === INTENT.INSPECT)
        || (panel.watch && intent.type === INTENT.WATCH)) {
        await (panel.inspect ? inspectTarget() : panel.watch ? watchTarget() : castAtTarget());
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
    } else if (panel.type === "map" && intent.type === INTENT.MAP) {
      panel = null;
      return true;
    }
    panel = null;
    return false;
  }

  async function handle(intent) {
    if (!intent) return { quit: false };
    message = "";
    cues = [];
    if (panel && await handlePanel(intent)) return { quit: false };
    switch (intent.type) {
      case INTENT.QUIT:
        return { quit: true };
      case INTENT.HELP:
        showHelp = !showHelp;
        break;
      case INTENT.MAP:
        panel = { type: "map" };
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
        // Sprint (#437): shift+move one-shot, or sticky latch from x / Sprint until toggled off.
        const sprint = Boolean(intent.sprint) || sprintArmed;
        await act({ kind: "move", params: { direction: intent.direction, ...(sprint ? { sprint: true } : {}) } },
          () => (sprint ? "You sprint." : ""));
        break;
      }
      case INTENT.SPRINT:
        sprintArmed = !sprintArmed;
// AK-19: status/battle-log band is combat observation, not a how-to; sprint cost lives in Keys/help.
        message = sprintArmed ? "Sprint armed." : "Sprint off.";
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
      case INTENT.INSPECT:
        openInspect();
        break;
      case INTENT.WATCH:
        openWatch();
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

  function state() {
    return {
      levelIndex,
      levelName: levels[levelIndex].name,
      turns,
      status: session.status(),
      finished,
      message,
      panel: panel?.type ?? null,
      // What the open panel is for, so a touch UI can label its keys: casting, raising, looking, watching.
      panelFlags: { raise: Boolean(panel?.raise), inspect: Boolean(panel?.inspect), watch: Boolean(panel?.watch) },
      sprintArmed,
      active: session.activeActorId?.() ?? null,
      party: session.view().party ?? [],
      orders: session.view().orders ?? [],
      // #757: what the last key or command's ticks sounded like; empty when it ran none.
      cues,
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
  /**
   * The seated actor's affinity slots as buttons need them (the phone app, #552): each slot's
   * kind and expression, range and intensity (running of held), whether it is cast, whether it
   * is drained, and the known affinities that are not equipped (what an empty slot can take).
   */
  function slots() {
    const player = session.view().player;
    const known = player?.affinities || [];
    const equipped = equippedKeys(player);
    const off = Array.isArray(player?.exhaustedAffinityKeys) ? player.exhaustedAffinityKeys : (player?.affinityExhausted ? equipped : []);
    const count = Math.max(player?.affinitySlots ?? 1, equipped.length);
    const level = (pair, field) => ({ running: runningLevel(player, pair, field), held: LEVELS[field].held(pair) });
    const entry = (pair) => {
      const key = `${pair.kind}:${pair.expression}`;
      return { key, kind: pair.kind, expression: pair.expression, color: AFFINITY_COLOR_HEX[pair.kind] ?? null,
        stacks: level(pair, "stacks"), intensity: level(pair, "intensity"), label: affinityLabel(pair),
        role: affinityRole(pair.kind, pair.expression) ?? null };
    };
    return {
      slots: Array.from({ length: count }, (_, index) => {
        const pair = known.find((candidate) => `${candidate.kind}:${candidate.expression}` === equipped[index]);
        if (!pair) return { index, empty: true };
        const item = entry(pair);
        return { index, ...item, castable: Boolean(castable(player)[item.key]), mana: castable(player)[item.key]?.mana ?? null,
          overMana: (castable(player)[item.key]?.mana ?? 0) > currentMana(player),
          armed: panel?.affinityKey === item.key, off: off.includes(item.key) };
      }),
      picks: known.filter((pair) => !equipped.includes(`${pair.kind}:${pair.expression}`)).map(entry),
    };
  }

  /**
   * Equip a known affinity into a free slot, or unequip it if it is equipped (a turn, as with its
   * number). With `replaceKey`, a packed affinity swaps into that equipped one's slot, in one turn.
   */
  async function toggleSlotAffinity(affinityKey, replaceKey = null) {
    panel = null;
    message = "";
    const pair = (session.view().player?.affinities || []).find((candidate) => `${candidate.kind}:${candidate.expression}` === affinityKey);
    if (pair) await toggleAffinity(pair, replaceKey);
  }

  /** Run an equipped affinity one range or intensity higher or lower, as the affinity list's + - ] [ do. */
  async function tuneSlot(affinityKey, field, step) {
    const items = session.view().player?.affinities || [];
    const index = items.findIndex((candidate) => `${candidate.kind}:${candidate.expression}` === affinityKey);
    message = "";
    if (index < 0 || !LEVELS[field]) return;
    panel = { type: "affinities", items, index };
    await relevel(field, step);
    panel = null;
  }

  /** What a list panel offers as buttons (loot, orders, the affinity list): one label each, picked by its number. */
  function panelChoices() {
    if (!panel || !Array.isArray(panel.items) || !["loot", "order_actor", "order_goal", "affinities"].includes(panel.type)) return null;
    const player = session.view().player;
    const labels = {
      loot: (item) => `${lootLabel(item)} from ${item.targetId}`,
      order_actor: (item) => `${item.label ? `${item.label} ` : ""}${item.id}`,
      order_goal: (item) => item.label,
      affinities: (pair) => affinityLabel(pair) + (equippedKeys(player).includes(`${pair.kind}:${pair.expression}`) ? " (equipped)" : ""),
    };
    return { type: panel.type, items: panel.items.map(labels[panel.type]) };
  }

  /**
   * Point at a level tile (a tap or a click on the board). While aiming it moves the cursor there;
   * in a target, inspect or watch list it picks whoever stands there (and a cast list falls back to
   * aiming at the tile); with no panel open, a tile next to the seat is a step that way. Confirming
   * is still the cast intent. Returns whether the point meant anything.
   * @param {{x: number, y: number}} tile level coordinates (a board frame's tile plus its `origin`)
   */
  async function pointAt(tile) {
    if (!Number.isInteger(tile?.x) || !Number.isInteger(tile?.y)) return false;
    if (panel?.type === "aim") {
      panel.cursor = { x: tile.x, y: tile.y };
      return true;
    }
    if (panel?.type === "target") {
      const index = panel.items.findIndex((item) => item.position?.x === tile.x && item.position?.y === tile.y);
      if (index >= 0) {
        panel.index = index;
        return true;
      }
      if (panel.inspect || panel.watch) return false;
      panel = { type: "aim", cursor: { x: tile.x, y: tile.y }, ...(panel.affinityKey ? { affinityKey: panel.affinityKey } : {}) };
      return true;
    }
    if (panel) return false;
    const at = session.view().player?.position;
    if (!at) return false;
    const direction = Object.keys(PLAY_DIRECTION_STEPS).find((name) => (
      PLAY_DIRECTION_STEPS[name].dx === tile.x - at.x && PLAY_DIRECTION_STEPS[name].dy === tile.y - at.y));
    if (!direction) return false;
    await handle({ type: INTENT.MOVE, direction });
    return true;
  }

  /** Resize the play window (tiles square; null shows the whole board), e.g. when the display changes. */
  function setWindow(tiles) { windowSize = Number.isInteger(tiles) && tiles > 0 ? tiles : null; }
  /**
   * What a client needs to draw the current frame: the session's view, the level, the turn count,
   * the message, whether help shows, the window, the aim cursor and the open panel (raw: wording and
   * layout are the client's, `panelChoices()` is the button form).
   */
  function frame() {
    return {
      view: session.view(),
      levelName: levels[levelIndex].name,
      grade: levels[levelIndex].simConfig?.meta?.cost?.grade ?? null,
      levelIndex,
      levelCount: levels.length,
      turns,
      message,
      showHelp,
      windowSize,
      aim: panel?.type === "aim" ? panel.cursor : null,
      panel,
    };
  }
  return { handle, command, switchTo, frame, state, view, debugView, captureInput, replay, slots, toggleSlotAffinity, tuneSlot, panelChoices, setWindow, pointAt };
}
