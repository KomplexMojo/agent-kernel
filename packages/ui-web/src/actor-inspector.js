import { VITAL_KEYS } from "../../runtime/src/contracts/domain-constants.js";
import { calculateCardValue } from "./design-guidance.js";

const TYPE_ORDER = Object.freeze(["room", "attacker", "defender"]);

const TYPE_ICON_MAP = Object.freeze({
  room: "🏛️",
  attacker: "⚔️",
  defender: "🛡️",
  untyped: "◻️",
});

const AFFINITY_ICON_MAP = Object.freeze({
  fire: "🔥",
  water: "💧",
  earth: "🪨",
  wind: "🌪️",
  life: "🌿",
  decay: "🧪",
  corrode: "🧫",
  fortify: "🧱",
  light: "🌟",
  dark: "🌑",
});

const EXPRESSION_ICON_MAP = Object.freeze({
  push: "⬆️",
  pull: "⬇️",
  emit: "📡",
});

const MOTIVATION_ICON_MAP = Object.freeze({
  random: "🎲",
  stationary: "🧱",
  exploring: "🧭",
  attacking: "⚔️",
  defending: "🛡️",
  patrolling: "👣",
  reflexive: "⚡",
  goal_oriented: "🎯",
  strategy_focused: "♟️",
});

const VITAL_ICON_MAP = Object.freeze({
  health: "❤️",
  mana: "🔷",
  stamina: "👟",
  durability: "🛡️",
});

const ATTACKER_KEYWORDS = Object.freeze(["attack", "attacker", "assault", "intruder", "raider", "player"]);

function readPositiveInt(value, fallback = 0) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
}

function normalizeCardType(type) {
  const normalized = typeof type === "string" ? type.trim().toLowerCase() : "";
  return TYPE_ORDER.includes(normalized) ? normalized : "";
}

function normalizeName(value, fallback = "") {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized || fallback;
}

function iconForType(type) {
  const normalized = normalizeCardType(type);
  return TYPE_ICON_MAP[normalized] || TYPE_ICON_MAP.untyped;
}

function iconForAffinity(kind) {
  const normalized = typeof kind === "string" ? kind.trim().toLowerCase() : "";
  return AFFINITY_ICON_MAP[normalized] || "◈";
}

function iconForExpression(expression) {
  const normalized = typeof expression === "string" ? expression.trim().toLowerCase() : "";
  return EXPRESSION_ICON_MAP[normalized] || "✦";
}

function iconForMotivation(motivation) {
  const normalized = typeof motivation === "string" ? motivation.trim().toLowerCase() : "";
  return MOTIVATION_ICON_MAP[normalized] || "❖";
}

function iconForVital(vital) {
  const normalized = typeof vital === "string" ? vital.trim().toLowerCase() : "";
  return VITAL_ICON_MAP[normalized] || "◦";
}

function deriveTemplateInstanceId(templateId, index) {
  const base = normalizeName(templateId, "CARD");
  const ordinal = Math.max(1, readPositiveInt(index, 1));
  return `${base}-${ordinal}`;
}

function createDomElement(root, tagName) {
  const doc = root?.ownerDocument || globalThis.document;
  if (!doc || typeof doc.createElement !== "function") return null;
  return doc.createElement(tagName);
}

function clearElement(el) {
  if (!el) return;
  if (typeof el.replaceChildren === "function") {
    el.replaceChildren();
    return;
  }
  el.textContent = "";
}

function replaceChildren(el, children) {
  if (!el) return;
  if (typeof el.replaceChildren === "function") {
    el.replaceChildren(...children);
    return;
  }
  el.textContent = "";
  if (typeof el.append === "function") {
    children.forEach((child) => el.append(child));
  }
}

function buildTextBag(value) {
  if (!value || typeof value !== "object") return "";
  const parts = [];
  if (typeof value.id === "string") parts.push(value.id);
  if (typeof value.motivation === "string") parts.push(value.motivation);
  if (typeof value.role === "string") parts.push(value.role);
  if (Array.isArray(value.motivations)) {
    value.motivations.forEach((entry) => {
      if (typeof entry === "string") parts.push(entry);
      if (entry && typeof entry === "object" && typeof entry.kind === "string") parts.push(entry.kind);
    });
  }
  return parts.join(" ").toLowerCase();
}

function inferActorType(actor, specActor) {
  const bag = `${buildTextBag(specActor)} ${buildTextBag(actor)}`.trim();
  if (ATTACKER_KEYWORDS.some((token) => bag.includes(token))) {
    return "attacker";
  }
  return "defender";
}

function normalizeVitalRecord(entry = {}) {
  const current = Number.isFinite(entry?.current) ? Math.floor(entry.current) : 0;
  const max = Number.isFinite(entry?.max) ? Math.floor(entry.max) : 0;
  const regen = Number.isFinite(entry?.regen) ? Math.floor(entry.regen) : 0;
  return { current, max, regen };
}

function normalizeVitals(vitals) {
  if (!vitals || typeof vitals !== "object" || Array.isArray(vitals)) return null;
  const normalized = {};
  let populated = false;
  VITAL_KEYS.forEach((key) => {
    const record = normalizeVitalRecord(vitals[key]);
    normalized[key] = record;
    if (record.current > 0 || record.max > 0 || record.regen > 0) {
      populated = true;
    }
  });
  return populated ? normalized : null;
}

function normalizeCardAffinities(card) {
  const source = Array.isArray(card?.affinities) ? card.affinities : [];
  const normalized = source
    .map((entry) => {
      const kind = normalizeName(entry?.kind).toLowerCase();
      const expression = normalizeName(entry?.expression, "emit").toLowerCase();
      const stacks = Math.max(1, readPositiveInt(entry?.stacks, 1));
      if (!kind) return null;
      return {
        kind,
        expression,
        stacks,
        targetType: normalizeName(entry?.targetType).toLowerCase(),
      };
    })
    .filter(Boolean);

  if (normalized.length > 0) return normalized;

  const affinity = normalizeName(card?.affinity).toLowerCase();
  if (!affinity) return [];
  return [{ kind: affinity, expression: "emit", stacks: 1, targetType: "" }];
}

function normalizeActorAffinities(actor) {
  const normalized = [];
  if (Array.isArray(actor?.affinities)) {
    actor.affinities.forEach((entry) => {
      const kind = normalizeName(entry?.kind).toLowerCase();
      if (!kind) return;
      normalized.push({
        kind,
        expression: normalizeName(entry?.expression, "emit").toLowerCase(),
        stacks: Math.max(1, readPositiveInt(entry?.stacks, 1)),
        targetType: normalizeName(entry?.targetType).toLowerCase(),
      });
    });
  }

  const traitMap = actor?.traits?.affinities;
  if (traitMap && typeof traitMap === "object" && !Array.isArray(traitMap)) {
    Object.entries(traitMap).forEach(([rawKey, rawValue]) => {
      const stacks = Math.max(1, readPositiveInt(rawValue, 1));
      const [rawKind, rawExpression = "emit", rawTargetType = ""] = String(rawKey || "").split(":");
      const kind = normalizeName(rawKind).toLowerCase();
      if (!kind) return;
      normalized.push({
        kind,
        expression: normalizeName(rawExpression, "emit").toLowerCase(),
        stacks,
        targetType: normalizeName(rawTargetType).toLowerCase(),
      });
    });
  }

  const seen = new Set();
  return normalized.filter((entry) => {
    const signature = `${entry.kind}:${entry.expression}:${entry.targetType}:${entry.stacks}`;
    if (seen.has(signature)) return false;
    seen.add(signature);
    return true;
  });
}

function normalizeMotivations(card, fallbackType = "defender") {
  const source = Array.isArray(card?.motivations) ? card.motivations : [];
  const normalized = source
    .map((entry) => normalizeName(entry).toLowerCase())
    .filter(Boolean);
  if (normalized.length > 0) return normalized;

  const single = normalizeName(card?.motivation || card?.role).toLowerCase();
  if (single) return [single];
  return [fallbackType === "attacker" ? "attacking" : "defending"];
}

function sortById(list = [], key = "id") {
  return list
    .slice()
    .sort((a, b) => String(a?.[key] || "").localeCompare(String(b?.[key] || ""), undefined, { numeric: true }));
}

function resolveCardValue(card, { priceList, tileCosts } = {}) {
  const explicit = card?.cardValue && typeof card.cardValue === "object" ? card.cardValue : null;
  const explicitUnit = readPositiveInt(explicit?.unitTokens, 0);
  const explicitTotal = readPositiveInt(explicit?.totalTokens, 0);
  if (explicitUnit > 0 || explicitTotal > 0) {
    return {
      unitTokens: explicitUnit,
      totalTokens: explicitTotal || explicitUnit * Math.max(1, readPositiveInt(card?.count, 1)),
    };
  }

  const calculated = calculateCardValue(card, { priceList, tileCosts });
  return {
    unitTokens: readPositiveInt(calculated?.unitTokens, 0),
    totalTokens: readPositiveInt(calculated?.totalTokens, 0),
  };
}

function normalizeCardTemplate(card, index, options = {}) {
  const type = normalizeCardType(card?.type) || (card?.source === "room" ? "room" : "defender");
  if (!type) return null;
  const id = normalizeName(card?.id, `CARD-${index + 1}`);
  const count = Math.max(1, readPositiveInt(card?.count, 1));
  const affinities = normalizeCardAffinities(card);
  const motivations = type === "room" ? [] : normalizeMotivations(card, type);
  const vitals = type === "room" ? null : normalizeVitals(card?.vitals);
  const normalized = {
    id,
    type,
    count,
    affinity: normalizeName(card?.affinity).toLowerCase(),
    affinities,
    motivations,
    vitals,
  };
  normalized.cardValue = resolveCardValue(
    {
      ...card,
      id,
      type,
      count,
      affinities,
      motivations,
      vitals,
    },
    options,
  );
  return normalized;
}

function collectTemplateCards(spec) {
  const fromConfigurator = Array.isArray(spec?.configurator?.inputs?.cardSet)
    ? spec.configurator.inputs.cardSet
    : null;
  const fromPlanHints = Array.isArray(spec?.plan?.hints?.cardSet)
    ? spec.plan.hints.cardSet
    : null;
  const source = fromConfigurator || fromPlanHints || [];
  return source
    .map((card, index) => normalizeCardTemplate(card, index, {
      priceList: spec?.budget?.priceList,
      tileCosts: null,
    }))
    .filter(Boolean);
}

function actorAffinityKinds(actor) {
  const kinds = new Set();
  normalizeActorAffinities(actor).forEach((entry) => {
    if (entry.kind) kinds.add(entry.kind);
  });
  if (typeof actor?.affinity === "string" && actor.affinity.trim()) {
    kinds.add(actor.affinity.trim().toLowerCase());
  }
  return kinds;
}

function cardAffinityKinds(card) {
  const kinds = new Set();
  (Array.isArray(card?.affinities) ? card.affinities : []).forEach((entry) => {
    if (entry?.kind) kinds.add(String(entry.kind).toLowerCase());
  });
  if (card?.affinity) kinds.add(String(card.affinity).toLowerCase());
  return kinds;
}

function actorMatchesCardAffinities(actor, card) {
  const required = cardAffinityKinds(card);
  if (required.size === 0) return true;
  const available = actorAffinityKinds(actor);
  for (const kind of required.values()) {
    if (available.has(kind)) return true;
  }
  return false;
}

function roomAffinityKinds(room) {
  const kinds = new Set();
  const roomAffinities = Array.isArray(room?.affinities) ? room.affinities : [];
  roomAffinities.forEach((entry) => {
    const kind = normalizeName(entry?.kind).toLowerCase();
    if (kind) kinds.add(kind);
  });
  const direct = normalizeName(room?.affinity).toLowerCase();
  if (direct) kinds.add(direct);
  return kinds;
}

function roomMatchesCardAffinities(room, card) {
  const required = cardAffinityKinds(card);
  if (required.size === 0) return true;
  const available = roomAffinityKinds(room);
  for (const kind of required.values()) {
    if (available.has(kind)) return true;
  }
  return false;
}

function roomCenter(room = {}) {
  const bounds = normalizeRoomBounds(room);
  if (!bounds) return null;
  return {
    x: bounds.x + Math.floor(bounds.width / 2),
    y: bounds.y + Math.floor(bounds.height / 2),
  };
}

function normalizeRoomBounds(room = {}) {
  const x = Number(room?.x);
  const y = Number(room?.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const width = Number.isFinite(room?.width) ? Math.max(1, Math.floor(room.width)) : 1;
  const height = Number.isFinite(room?.height) ? Math.max(1, Math.floor(room.height)) : 1;
  return {
    x: Math.floor(x),
    y: Math.floor(y),
    width,
    height,
  };
}

function deriveRoomId(room, index) {
  return normalizeName(room?.id, `R${index + 1}`);
}

function deriveFallbackCardFromActor(actor, specActor) {
  const type = inferActorType(actor, specActor);
  const id = normalizeName(actor?.id, `${type.toUpperCase()}-GEN`);
  return {
    id,
    type,
    count: 1,
    affinity: normalizeName(actor?.affinity).toLowerCase(),
    affinities: normalizeActorAffinities(actor),
    motivations: normalizeMotivations(specActor || actor, type),
    vitals: normalizeVitals(actor?.vitals),
    cardValue: {
      unitTokens: readPositiveInt(actor?.tokenCost, readPositiveInt(actor?.cost, 0)),
      totalTokens: readPositiveInt(actor?.tokenCost, readPositiveInt(actor?.cost, 0)),
    },
  };
}

function buildInspectorModel({ simConfig, initialState, spec } = {}) {
  const templateCards = collectTemplateCards(spec);
  const specActors = sortById(Array.isArray(spec?.configurator?.inputs?.actors) ? spec.configurator.inputs.actors : []);
  const specActorsById = new Map(specActors.map((entry) => [normalizeName(entry?.id), entry]));
  const runtimeActors = sortById(Array.isArray(initialState?.actors) ? initialState.actors : []);
  const runtimeRooms = Array.isArray(simConfig?.layout?.data?.rooms)
    ? simConfig.layout.data.rooms.map((room, index) => ({
      ...room,
      id: deriveRoomId(room, index),
      center: roomCenter(room),
      templateInstanceId: normalizeName(room?.templateInstanceId),
      templateId: normalizeName(room?.templateId),
    }))
    : [];

  const groups = {
    room: [],
    attacker: [],
    defender: [],
  };

  const runtimeActorPool = runtimeActors
    .map((actor) => {
      const actorId = normalizeName(actor?.id);
      return {
        actor,
        actorId,
        specActor: specActorsById.get(actorId) || null,
      };
    })
    .filter((entry) => Boolean(entry.actorId));

  const runtimeRoomPool = runtimeRooms.slice();

  function takeRuntimeActor(predicate) {
    const index = runtimeActorPool.findIndex(predicate);
    if (index < 0) return null;
    return runtimeActorPool.splice(index, 1)[0];
  }

  function takeRuntimeRoom(predicate) {
    const index = runtimeRoomPool.findIndex(predicate);
    if (index < 0) return null;
    return runtimeRoomPool.splice(index, 1)[0];
  }

  templateCards.forEach((card) => {
    for (let ordinal = 1; ordinal <= card.count; ordinal += 1) {
      const instanceId = deriveTemplateInstanceId(card.id, ordinal);
      if (card.type === "room") {
        const room = takeRuntimeRoom((entry) => entry.templateInstanceId === instanceId)
          || takeRuntimeRoom((entry) => roomMatchesCardAffinities(entry, card))
          || takeRuntimeRoom(() => true);

        groups.room.push({
          instanceId,
          templateId: card.id,
          type: "room",
          ordinal,
          card,
          roomId: room?.id || "",
          runtimeActorId: "",
          position: room?.center || null,
          runtimeRoom: room || null,
        });
        continue;
      }

      const runtimeActor = takeRuntimeActor((entry) => entry.actorId === instanceId)
        || takeRuntimeActor((entry) => inferActorType(entry.actor, entry.specActor) === card.type && actorMatchesCardAffinities(entry.actor, card))
        || takeRuntimeActor((entry) => inferActorType(entry.actor, entry.specActor) === card.type)
        || takeRuntimeActor(() => true);

      const entity = {
        instanceId,
        templateId: card.id,
        type: card.type,
        ordinal,
        card,
        runtimeActorId: runtimeActor?.actorId || "",
        roomId: "",
        position: runtimeActor?.actor?.position || null,
        runtimeRoom: null,
      };
      groups[card.type].push(entity);
    }
  });

  runtimeRoomPool.forEach((room, index) => {
    const fallbackCard = {
      id: room.templateId || room.id,
      type: "room",
      count: 1,
      affinity: normalizeName(room?.affinity).toLowerCase(),
      affinities: normalizeCardAffinities(room),
      motivations: [],
      vitals: null,
      cardValue: { unitTokens: 0, totalTokens: 0 },
    };
    groups.room.push({
      instanceId: room.templateInstanceId || deriveTemplateInstanceId(fallbackCard.id, index + 1),
      templateId: fallbackCard.id,
      type: "room",
      ordinal: index + 1,
      card: fallbackCard,
      runtimeActorId: "",
      roomId: room.id,
      position: room.center || null,
      runtimeRoom: room,
    });
  });

  runtimeActorPool.forEach((entry) => {
    const type = inferActorType(entry.actor, entry.specActor);
    const fallbackCard = deriveFallbackCardFromActor(entry.actor, entry.specActor);
    groups[type].push({
      instanceId: entry.actorId,
      templateId: fallbackCard.id,
      type,
      ordinal: 1,
      card: fallbackCard,
      runtimeActorId: entry.actorId,
      roomId: "",
      position: entry.actor?.position || null,
      runtimeRoom: null,
    });
  });

  TYPE_ORDER.forEach((type) => {
    groups[type] = sortById(groups[type], "instanceId");
  });

  const all = TYPE_ORDER.flatMap((type) => groups[type]);
  const byInstanceId = new Map(all.map((entry) => [entry.instanceId, entry]));
  const runtimeActorToInstance = new Map(
    all
      .filter((entry) => entry.runtimeActorId)
      .map((entry) => [entry.runtimeActorId, entry.instanceId]),
  );

  return {
    groups,
    all,
    byInstanceId,
    runtimeActorToInstance,
  };
}

function createIconChip(root, {
  icon,
  title,
  className = "",
} = {}) {
  const chip = createDomElement(root, "span");
  if (!chip) return null;
  chip.className = className ? `design-card-icon-chip ${className}` : "design-card-icon-chip";
  if (title) chip.title = title;
  chip.textContent = icon || "◈";
  return chip;
}

function formatActorProfile(actor) {
  if (!actor) return "No actor selected.";
  const parts = [];
  parts.push(`id: ${actor.id || "-"}`);
  if (actor?.position) {
    parts.push(`position: (${actor.position.x}, ${actor.position.y})`);
  }
  const affinities = normalizeActorAffinities(actor)
    .map((entry) => `${entry.kind}:${entry.expression} x${entry.stacks}`)
    .join(", ");
  parts.push(`affinities: ${affinities || "-"}`);
  return parts.join("\n");
}

function formatActorCapabilities(actor) {
  if (!actor) return "No capabilities recorded.";
  const caps = actor.capabilities && typeof actor.capabilities === "object" ? actor.capabilities : null;
  if (!caps) return "No capabilities recorded.";
  const parts = [];
  if (Number.isFinite(caps.movementCost)) parts.push(`movementCost: ${caps.movementCost}`);
  if (Number.isFinite(caps.actionCostMana)) parts.push(`actionCostMana: ${caps.actionCostMana}`);
  if (Number.isFinite(caps.actionCostStamina)) parts.push(`actionCostStamina: ${caps.actionCostStamina}`);
  return parts.length > 0 ? parts.join("\n") : "No capabilities recorded.";
}

function formatActorConstraints(actor) {
  if (!actor) return "No constraints recorded.";
  const constraints = actor.constraints ?? actor.traits?.constraints;
  if (!constraints) return "No constraints recorded.";
  if (Array.isArray(constraints)) {
    return constraints.length > 0 ? constraints.map((entry) => String(entry)).join("\n") : "No constraints recorded.";
  }
  if (typeof constraints === "object") {
    const entries = Object.entries(constraints);
    if (entries.length === 0) return "No constraints recorded.";
    return entries.map(([key, value]) => `${key}: ${JSON.stringify(value)}`).join("\n");
  }
  return String(constraints);
}

function formatActorLiveState(actor, { tick, running } = {}) {
  if (!actor) return "No actor selected.";
  if (!running) return "Game paused.";
  const lines = [];
  if (Number.isFinite(tick)) lines.push(`tick: ${tick}`);
  if (actor?.position) lines.push(`position: (${actor.position.x}, ${actor.position.y})`);
  const vitals = normalizeVitals(actor?.vitals);
  if (vitals) {
    VITAL_KEYS.forEach((key) => {
      const record = vitals[key];
      lines.push(`${key}: ${record.current}/${record.max}+${record.regen}`);
    });
  }
  return lines.length > 0 ? lines.join("\n") : "No live state available.";
}

function buildRowMeta(entity, liveActor) {
  const position = liveActor?.position || entity?.position;
  if (position && Number.isFinite(position.x) && Number.isFinite(position.y)) {
    return `📍${position.x},${position.y}`;
  }
  if (entity?.roomId) return `📦${entity.roomId}`;
  if (entity?.runtimeActorId) return `🎯${entity.runtimeActorId}`;
  return "";
}

function resolveEntityAffinities(entity, liveActor) {
  const fromCard = Array.isArray(entity?.card?.affinities) ? entity.card.affinities : [];
  if (fromCard.length > 0) {
    return fromCard.map((entry) => ({
      kind: normalizeName(entry?.kind).toLowerCase(),
      expression: normalizeName(entry?.expression, "emit").toLowerCase(),
      stacks: Math.max(1, readPositiveInt(entry?.stacks, 1)),
      targetType: normalizeName(entry?.targetType).toLowerCase(),
    }));
  }
  return normalizeActorAffinities(liveActor);
}

function resolveEntityVitals(entity, liveActor) {
  const live = normalizeVitals(liveActor?.vitals);
  if (live) return live;
  return normalizeVitals(entity?.card?.vitals);
}

function resolveEntityValue(entity, liveActor) {
  const cardTotal = readPositiveInt(entity?.card?.cardValue?.totalTokens, 0);
  if (cardTotal > 0) return cardTotal;
  const runtimeCost = readPositiveInt(liveActor?.tokenCost, readPositiveInt(liveActor?.cost, 0));
  return runtimeCost;
}

export {
  deriveTemplateInstanceId,
  formatActorProfile,
  formatActorCapabilities,
  formatActorConstraints,
  formatActorLiveState,
};

export function createActorInspector({
  containerEl,
  statusEl,
  roomListEl,
  attackerListEl,
  defenderListEl,
  detailEl,
  onSelectEntity,
  onVisibilityChange,
} = {}) {
  let model = {
    groups: { room: [], attacker: [], defender: [] },
    all: [],
    byInstanceId: new Map(),
    runtimeActorToInstance: new Map(),
  };
  let selectedInstanceId = "";
  let liveActors = [];
  let liveActorById = new Map();
  let running = false;
  let tick = null;
  let visible = true;
  let hasInteractedWithSelection = false;

  function fallbackModelFromLiveActors() {
    if (!Array.isArray(liveActors) || liveActors.length === 0) {
      return {
        groups: { room: [], attacker: [], defender: [] },
        all: [],
        byInstanceId: new Map(),
        runtimeActorToInstance: new Map(),
      };
    }
    return buildInspectorModel({ initialState: { actors: liveActors }, spec: null, simConfig: null });
  }

  function activeModel() {
    return model.all.length > 0 ? model : fallbackModelFromLiveActors();
  }

  function getEntityById(instanceId) {
    return activeModel().byInstanceId.get(instanceId) || null;
  }

  function getLiveActor(entity) {
    const actorId = normalizeName(entity?.runtimeActorId);
    if (!actorId) return null;
    return liveActorById.get(actorId) || null;
  }

  function buildSelectionPayload(entity) {
    if (!entity || typeof entity !== "object") return null;
    const liveActor = getLiveActor(entity);
    return {
      instanceId: entity.instanceId,
      templateId: entity.templateId,
      type: entity.type,
      actorId: entity.runtimeActorId || "",
      roomId: entity.roomId || "",
      roomBounds: normalizeRoomBounds(entity.runtimeRoom),
      position: liveActor?.position || entity.position || null,
      tick,
      running,
    };
  }

  function setVisible(nextVisible) {
    const normalized = Boolean(nextVisible);
    if (containerEl && "hidden" in containerEl) {
      containerEl.hidden = !normalized;
    }
    if (normalized !== visible && typeof onVisibilityChange === "function") {
      onVisibilityChange(normalized);
    }
    visible = normalized;
  }

  function renderGroup(container, instances = []) {
    if (!container) return;
    const entities = Array.isArray(instances) ? instances : [];

    if (entities.length === 0) {
      const empty = createDomElement(container, "div");
      if (!empty) {
        container.textContent = "None";
        return;
      }
      empty.className = "design-card-group-empty";
      empty.textContent = "None";
      replaceChildren(container, [empty]);
      return;
    }

    const rows = entities.map((entity) => {
      const row = createDomElement(container, "button");
      if (!row) return null;
      row.type = "button";
      row.className = "design-card-group-row design-card-group-card simulation-inspector-instance";
      if (entity.instanceId === selectedInstanceId) {
        row.classList?.add?.("selected");
      }
      row.dataset.instanceId = entity.instanceId;

      row.addEventListener?.("click", () => {
        selectEntityById(entity.instanceId, { notify: true, toggleIfSelected: true });
      });

      const preview = createDomElement(row, "span");
      if (preview) {
        preview.className = "design-card-group-preview";
        const liveActor = getLiveActor(entity);
        const affinities = resolveEntityAffinities(entity, liveActor);
        const motivations = Array.isArray(entity?.card?.motivations) ? entity.card.motivations : [];

        const chips = [
          createIconChip(preview, {
            icon: iconForType(entity.type),
            title: `Type: ${entity.type}`,
            className: "is-type",
          }),
        ];

        if (affinities[0]?.kind) {
          chips.push(createIconChip(preview, {
            icon: iconForAffinity(affinities[0].kind),
            title: `Affinity: ${affinities[0].kind}`,
            className: "is-affinity",
          }));
        }

        if (motivations[0]) {
          chips.push(createIconChip(preview, {
            icon: iconForMotivation(motivations[0]),
            title: `Motivation: ${motivations[0]}`,
            className: "is-motivation",
          }));
        }

        preview.append(...chips.filter(Boolean));
        row.append(preview);
      }

      const name = createDomElement(row, "span");
      if (name) {
        name.className = "design-card-group-name";
        name.textContent = entity.instanceId;
        row.append(name);
      }

      const meta = createDomElement(row, "span");
      if (meta) {
        meta.className = "design-card-group-meta";
        meta.textContent = buildRowMeta(entity, getLiveActor(entity));
        row.append(meta);
      }

      return row;
    }).filter(Boolean);

    replaceChildren(container, rows);
  }

  function appendEmptyDetail(text = "Select an instance to inspect.") {
    if (!detailEl) return;
    const empty = createDomElement(detailEl, "div");
    if (!empty) {
      detailEl.textContent = text;
      return;
    }
    empty.className = "simulation-inspector-empty";
    empty.textContent = text;
    replaceChildren(detailEl, [empty]);
  }

  function renderDetail(entity) {
    if (!detailEl) return;
    if (!entity) {
      appendEmptyDetail("Select an instance to inspect.");
      return;
    }

    const liveActor = getLiveActor(entity);
    const affinities = resolveEntityAffinities(entity, liveActor);
    const vitals = resolveEntityVitals(entity, liveActor);
    const totalValue = resolveEntityValue(entity, liveActor);
    const motivations = Array.isArray(entity?.card?.motivations) ? entity.card.motivations : [];

    const card = createDomElement(detailEl, "article");
    if (!card) {
      detailEl.textContent = entity.instanceId;
      return;
    }
    card.className = "design-card";

    const header = createDomElement(card, "div");
    if (header) {
      header.className = "design-card-header";
      const heading = createDomElement(header, "div");
      if (heading) {
        heading.className = "design-card-heading";
        const typeChip = createIconChip(heading, {
          icon: iconForType(entity.type),
          title: `Type: ${entity.type}`,
          className: "is-type",
        });
        if (typeChip) heading.append(typeChip);

        const title = createDomElement(heading, "span");
        if (title) {
          title.className = "design-card-title";
          title.textContent = entity.instanceId;
          heading.append(title);
        }

        header.append(heading);
      }

      const location = createDomElement(header, "span");
      if (location) {
        location.className = "design-card-meta-chip";
        location.textContent = buildRowMeta(entity, liveActor) || "📍-";
        header.append(location);
      }
      card.append(header);
    }

    const traits = createDomElement(card, "div");
    if (traits) {
      traits.className = "design-card-traits";
      affinities.slice(0, 4).forEach((entry) => {
        const affinityChip = createIconChip(traits, {
          icon: iconForAffinity(entry.kind),
          title: `Affinity: ${entry.kind}`,
          className: "is-affinity",
        });
        if (affinityChip) traits.append(affinityChip);
      });
      motivations.slice(0, 4).forEach((motivation) => {
        const motivationChip = createIconChip(traits, {
          icon: iconForMotivation(motivation),
          title: `Motivation: ${motivation}`,
          className: "is-motivation",
        });
        if (motivationChip) traits.append(motivationChip);
      });
      card.append(traits);
    }

    const affinityList = createDomElement(card, "div");
    if (affinityList) {
      affinityList.className = "simulation-inspector-affinity-list";
      if (affinities.length === 0) {
        const empty = createDomElement(affinityList, "div");
        if (empty) {
          empty.className = "design-card-affinity-empty";
          empty.textContent = "No affinities";
          affinityList.append(empty);
        }
      } else {
        affinities.forEach((entry) => {
          const row = createDomElement(affinityList, "div");
          if (!row) return;
          row.className = "simulation-inspector-affinity-row";

          const affinityIcon = createIconChip(row, {
            icon: iconForAffinity(entry.kind),
            title: `Affinity: ${entry.kind}`,
            className: "is-affinity",
          });
          if (affinityIcon) row.append(affinityIcon);

          const expressionIcon = createIconChip(row, {
            icon: iconForExpression(entry.expression),
            title: `Expression: ${entry.expression}`,
            className: "is-expression",
          });
          if (expressionIcon) row.append(expressionIcon);

          const meta = createDomElement(row, "span");
          if (meta) {
            meta.className = "simulation-inspector-affinity-meta";
            meta.textContent = entry.targetType ? `${entry.kind} · ${entry.targetType}` : entry.kind;
            row.append(meta);
          }

          const stack = createDomElement(row, "span");
          if (stack) {
            stack.className = "simulation-inspector-affinity-stack";
            stack.textContent = `+${Math.max(1, readPositiveInt(entry.stacks, 1))}`;
            row.append(stack);
          }

          affinityList.append(row);
        });
      }
      card.append(affinityList);
    }

    const vitalsGrid = createDomElement(card, "div");
    if (vitalsGrid) {
      vitalsGrid.className = "simulation-inspector-vitals-grid";
      if (!vitals) {
        const empty = createDomElement(vitalsGrid, "div");
        if (empty) {
          empty.className = "simulation-inspector-empty";
          empty.textContent = "No vitals";
          vitalsGrid.append(empty);
        }
      } else {
        VITAL_KEYS.forEach((vitalKey) => {
          const row = createDomElement(vitalsGrid, "div");
          if (!row) return;
          row.className = "simulation-inspector-vital-row";

          const iconChip = createIconChip(row, {
            icon: iconForVital(vitalKey),
            title: vitalKey,
            className: "is-vital",
          });
          if (iconChip) row.append(iconChip);

          const value = createDomElement(row, "span");
          if (value) {
            const record = vitals[vitalKey] || normalizeVitalRecord();
            value.className = "simulation-inspector-vital-value";
            value.textContent = `${record.current}/${record.max}/+${record.regen}`;
            row.append(value);
          }

          vitalsGrid.append(row);
        });
      }
      card.append(vitalsGrid);
    }

    const receipt = createDomElement(card, "div");
    if (receipt) {
      receipt.className = "design-card-receipt";

      const total = createDomElement(receipt, "div");
      if (total) {
        total.className = "design-card-receipt-row is-total";
        const label = createDomElement(total, "span");
        const value = createDomElement(total, "span");
        if (label) {
          label.className = "design-card-receipt-label";
          label.textContent = "🪙";
          total.append(label);
        }
        if (value) {
          value.className = "design-card-receipt-cost";
          value.textContent = String(totalValue);
          total.append(value);
        }
        receipt.append(total);
      }

      card.append(receipt);
    }

    replaceChildren(detailEl, [card]);
  }

  function render() {
    const resolved = activeModel();
    const hasEntities = resolved.all.length > 0;

    if (selectedInstanceId && !resolved.byInstanceId.has(selectedInstanceId)) {
      selectedInstanceId = "";
    }
    if (!selectedInstanceId && hasEntities && !hasInteractedWithSelection) {
      selectedInstanceId = resolved.all[0].instanceId;
    }

    renderGroup(roomListEl, resolved.groups.room);
    renderGroup(attackerListEl, resolved.groups.attacker);
    renderGroup(defenderListEl, resolved.groups.defender);

    const selected = selectedInstanceId ? resolved.byInstanceId.get(selectedInstanceId) || null : null;
    if (statusEl) {
      if (!hasEntities) {
        statusEl.textContent = "No generated instances loaded.";
      } else if (selected) {
        statusEl.textContent = selected.instanceId;
      } else {
        statusEl.textContent = "Select an instance to inspect.";
      }
    }
    renderDetail(selected);

    setVisible(true);
  }

  function setScenario({ simConfig, initialState, spec } = {}) {
    model = buildInspectorModel({ simConfig, initialState, spec });
    hasInteractedWithSelection = false;
    const first = model.all[0]?.instanceId || "";
    if (!model.byInstanceId.has(selectedInstanceId)) {
      selectedInstanceId = first;
    }
    render();
  }

  function setActors(nextActors = [], { tick: nextTick } = {}) {
    liveActors = Array.isArray(nextActors) ? nextActors.slice() : [];
    liveActorById = new Map(
      liveActors
        .map((actor) => [normalizeName(actor?.id), actor])
        .filter(([id]) => Boolean(id)),
    );
    if (typeof nextTick !== "undefined") {
      tick = Number.isFinite(nextTick) ? nextTick : null;
    }
    render();
  }

  function setRunning(nextRunning) {
    running = Boolean(nextRunning);
    render();
  }

  function selectEntityById(id, { notify = true, toggleIfSelected = false } = {}) {
    const normalized = normalizeName(id);
    if (!normalized) return;
    const resolved = activeModel();
    if (!resolved.byInstanceId.has(normalized)) return;
    if (toggleIfSelected && selectedInstanceId === normalized) {
      selectedInstanceId = "";
      hasInteractedWithSelection = true;
      render();
      if (notify && typeof onSelectEntity === "function") {
        onSelectEntity(null);
      }
      return;
    }
    selectedInstanceId = normalized;
    hasInteractedWithSelection = true;
    render();

    if (!notify || typeof onSelectEntity !== "function") return;
    const payload = buildSelectionPayload(resolved.byInstanceId.get(normalized));
    if (payload) {
      onSelectEntity(payload);
    }
  }

  function selectActorById(id) {
    const normalized = normalizeName(id);
    if (!normalized) return;
    const resolved = activeModel();
    const mappedInstanceId = resolved.runtimeActorToInstance.get(normalized) || normalized;
    selectEntityById(mappedInstanceId, { notify: false });
  }

  function clearSelection() {
    selectedInstanceId = "";
    hasInteractedWithSelection = true;
    render();
  }

  function close() {
    setVisible(true);
  }

  function open() {
    setVisible(true);
    render();
  }

  function toggle() {
    open();
    return visible;
  }

  render();

  return {
    setScenario,
    setActors,
    setRunning,
    selectEntityById,
    selectActorById,
    clearSelection,
    open,
    toggle,
    close,
    getSelectedId: () => (selectedInstanceId || null),
    getSelectedEntity: () => buildSelectionPayload(getEntityById(selectedInstanceId)),
    isVisible: () => visible,
  };
}
