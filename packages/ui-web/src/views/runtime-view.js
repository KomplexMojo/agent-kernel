const DEFAULT_VIEWPORT_SIZE = 50;
const VIEWPORT_FILL_CHAR = " ";

function normalizeActorId(value) {
  return typeof value === "string" ? value.trim() : "";
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function toPositiveInt(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  const normalized = Math.floor(parsed);
  return normalized > 0 ? normalized : fallback;
}

function sortActors(actors = []) {
  if (!Array.isArray(actors)) return [];
  return actors.slice().sort((a, b) => String(a?.id || "").localeCompare(String(b?.id || "")));
}

function resolveMapSize(baseTiles = []) {
  const height = Array.isArray(baseTiles) ? baseTiles.length : 0;
  const width = Array.isArray(baseTiles)
    ? baseTiles.reduce((max, row) => Math.max(max, String(row || "").length), 0)
    : 0;
  return {
    width: Math.max(0, width),
    height: Math.max(0, height),
  };
}

function resolveAttackerId(actors, fallbackId = "") {
  const sorted = sortActors(actors);
  const explicitAttacker = sorted.find((actor) => normalizeActorId(actor?.id).toLowerCase().includes("attacker"));
  if (explicitAttacker) return normalizeActorId(explicitAttacker.id);

  const fallback = normalizeActorId(fallbackId);
  if (fallback && sorted.some((actor) => normalizeActorId(actor?.id) === fallback)) {
    return fallback;
  }

  return normalizeActorId(sorted[0]?.id);
}

function buildViewportWindow({ width, height, center, viewportSize }) {
  const safeWidth = Math.max(0, width);
  const safeHeight = Math.max(0, height);
  const size = Math.max(1, toPositiveInt(viewportSize, DEFAULT_VIEWPORT_SIZE));
  const half = Math.floor(size / 2);
  const centerX = Number.isFinite(center?.x) ? center.x : 0;
  const centerY = Number.isFinite(center?.y) ? center.y : 0;
  const startX = clamp(centerX - half, 0, Math.max(0, safeWidth - size));
  const startY = clamp(centerY - half, 0, Math.max(0, safeHeight - size));
  return {
    startX,
    startY,
    size,
    endXExclusive: startX + size,
    endYExclusive: startY + size,
  };
}

function actorInWindow(actor, window) {
  const x = actor?.position?.x;
  const y = actor?.position?.y;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
  return (
    x >= window.startX
    && x < window.endXExclusive
    && y >= window.startY
    && y < window.endYExclusive
  );
}

function buildViewportRows(baseTiles = [], window) {
  const rows = [];
  for (let rowOffset = 0; rowOffset < window.size; rowOffset += 1) {
    const mapY = window.startY + rowOffset;
    const baseRow = String(baseTiles[mapY] || "");
    let rowText = "";
    for (let colOffset = 0; colOffset < window.size; colOffset += 1) {
      const mapX = window.startX + colOffset;
      rowText += mapX >= 0 && mapX < baseRow.length ? baseRow[mapX] : VIEWPORT_FILL_CHAR;
    }
    rows.push(rowText);
  }
  return rows;
}

function overlayActors(rows, { actors = [], window, viewerId, attackerId } = {}) {
  const grid = rows.map((row) => row.split(""));
  sortActors(actors).forEach((actor) => {
    if (!actorInWindow(actor, window)) return;
    const actorId = normalizeActorId(actor?.id);
    if (!actorId) return;
    const localX = actor.position.x - window.startX;
    const localY = actor.position.y - window.startY;
    if (!grid[localY] || localX < 0 || localX >= grid[localY].length) return;
    let glyph = "d";
    if (actorId === normalizeActorId(viewerId)) {
      glyph = "@";
    } else if (actorId === normalizeActorId(attackerId)) {
      glyph = "A";
    }
    grid[localY][localX] = glyph;
  });
  return grid.map((row) => row.join(""));
}

function escapeHtmlChar(char) {
  if (char === "&") return "&amp;";
  if (char === "<") return "&lt;";
  if (char === ">") return "&gt;";
  if (char === "\"") return "&quot;";
  if (char === "'") return "&#39;";
  return char;
}

function escapeHtml(value) {
  return String(value).split("").map(escapeHtmlChar).join("");
}

function kindLabel(kind) {
  if (kind === 0) return "stationary";
  if (kind === 1) return "barrier";
  if (kind === 2) return "motivated";
  return `kind:${kind ?? "?"}`;
}

function formatVitals(actor) {
  const health = actor?.vitals?.health;
  if (!health || typeof health !== "object") return "hp -";
  const current = Number.isFinite(health.current) ? health.current : "-";
  const max = Number.isFinite(health.max) ? health.max : "-";
  return `hp ${current}/${max}`;
}

function formatCard(actor, { selected = false } = {}) {
  if (!actor) {
    return '<div class="runtime-card-empty">No actor.</div>';
  }
  const actorId = normalizeActorId(actor.id) || "(unknown)";
  const position = actor?.position && Number.isFinite(actor.position.x) && Number.isFinite(actor.position.y)
    ? `(${actor.position.x}, ${actor.position.y})`
    : "(-, -)";
  const selectedClass = selected ? " selected" : "";
  return [
    `<button type="button" class="runtime-actor-card${selectedClass}" data-runtime-actor-id="${escapeHtml(actorId)}">`,
    `<span class="runtime-actor-title">${escapeHtml(actorId)}</span>`,
    `<span class="runtime-actor-meta">${escapeHtml(kindLabel(actor?.kind))}</span>`,
    `<span class="runtime-actor-meta">pos ${escapeHtml(position)}</span>`,
    `<span class="runtime-actor-meta">${escapeHtml(formatVitals(actor))}</span>`,
    "</button>",
  ].join("");
}

function renderCardList(container, actors, selectedActorId) {
  if (!container || !("innerHTML" in container)) return;
  if (!Array.isArray(actors) || actors.length === 0) {
    container.innerHTML = '<div class="runtime-card-empty">No actors.</div>';
    return;
  }
  container.innerHTML = actors
    .map((actor) => formatCard(actor, { selected: normalizeActorId(actor?.id) === normalizeActorId(selectedActorId) }))
    .join("");
}

export function wireRuntimeView({
  root = document,
  viewportSize: initialViewportSize = DEFAULT_VIEWPORT_SIZE,
  onSelectActor,
  onAction,
} = {}) {
  const viewportEl = root.querySelector("#runtime-viewport");
  const statusEl = root.querySelector("#runtime-status");
  const attackerCardEl = root.querySelector("#runtime-attacker-card");
  const visibleDefendersEl = root.querySelector("#runtime-visible-defenders");
  const offscreenDefendersEl = root.querySelector("#runtime-offscreen-defenders");
  const moveUpButton = root.querySelector("#runtime-move-up");
  const moveDownButton = root.querySelector("#runtime-move-down");
  const moveLeftButton = root.querySelector("#runtime-move-left");
  const moveRightButton = root.querySelector("#runtime-move-right");
  const castButton = root.querySelector("#runtime-cast");

  let selectedActorId = "";
  let viewportSize = Math.max(1, toPositiveInt(initialViewportSize, DEFAULT_VIEWPORT_SIZE));
  let latestObservation = null;

  function emitAction(action) {
    if (typeof onAction === "function") {
      onAction({ action, actorId: selectedActorId || null });
      return;
    }
    if (statusEl) {
      const actorText = selectedActorId || "(none)";
      statusEl.textContent = `action ${action} requested for ${actorText}`;
    }
  }

  function renderEmpty() {
    if (viewportEl) {
      viewportEl.textContent = "Runtime viewport unavailable.";
    }
    if (statusEl) {
      statusEl.textContent = "Load a simulation run to populate runtime telemetry.";
    }
    if (attackerCardEl && "innerHTML" in attackerCardEl) {
      attackerCardEl.innerHTML = '<div class="runtime-card-empty">No attacker.</div>';
    }
    if (visibleDefendersEl && "innerHTML" in visibleDefendersEl) {
      visibleDefendersEl.innerHTML = '<div class="runtime-card-empty">No visible defenders.</div>';
    }
    if (offscreenDefendersEl && "innerHTML" in offscreenDefendersEl) {
      offscreenDefendersEl.innerHTML = '<div class="runtime-card-empty">No offscreen defenders.</div>';
    }
  }

  function findActorById(actors = [], actorId = "") {
    const targetId = normalizeActorId(actorId);
    if (!targetId) return null;
    return actors.find((actor) => normalizeActorId(actor?.id) === targetId) || null;
  }

  function renderFromState() {
    const actors = sortActors(latestObservation?.actors || []);
    const baseTiles = Array.isArray(latestObservation?.baseTiles) ? latestObservation.baseTiles : [];
    if (actors.length === 0 || baseTiles.length === 0) {
      renderEmpty();
      return;
    }

    const map = resolveMapSize(baseTiles);
    const attackerId = resolveAttackerId(actors, latestObservation?.actorIdLabel);
    const attacker = findActorById(actors, attackerId) || actors[0];
    const viewer = findActorById(actors, selectedActorId) || attacker;
    selectedActorId = normalizeActorId(viewer?.id) || selectedActorId;

    const attackerViewport = buildViewportWindow({
      width: map.width,
      height: map.height,
      center: attacker?.position || null,
      viewportSize,
    });
    const viewerViewport = buildViewportWindow({
      width: map.width,
      height: map.height,
      center: viewer?.position || null,
      viewportSize,
    });

    const viewportRows = buildViewportRows(baseTiles, viewerViewport);
    const overlaidRows = overlayActors(viewportRows, {
      actors,
      window: viewerViewport,
      viewerId: selectedActorId,
      attackerId,
    });

    if (viewportEl) {
      viewportEl.textContent = overlaidRows.join("\n");
    }
    if (statusEl) {
      const tickText = Number.isFinite(latestObservation?.tick) ? latestObservation.tick : "?";
      statusEl.textContent = `tick ${tickText} | viewer ${selectedActorId} | viewport ${viewerViewport.size}x${viewerViewport.size} | map ${map.width}x${map.height}`;
    }

    renderCardList(attackerCardEl, attacker ? [attacker] : [], selectedActorId);

    const defenders = actors.filter((actor) => normalizeActorId(actor?.id) !== normalizeActorId(attackerId));
    const visibleDefenders = defenders.filter((actor) => actorInWindow(actor, attackerViewport));
    const offscreenDefenders = defenders.filter((actor) => !actorInWindow(actor, attackerViewport));
    renderCardList(visibleDefendersEl, visibleDefenders, selectedActorId);
    renderCardList(offscreenDefendersEl, offscreenDefenders, selectedActorId);
  }

  function selectActor(actorId) {
    const normalized = normalizeActorId(actorId);
    if (!normalized) return;
    selectedActorId = normalized;
    renderFromState();
    if (typeof onSelectActor === "function") {
      onSelectActor(normalized);
    }
  }

  function bindCardSelection(container) {
    if (!container?.addEventListener) return;
    container.addEventListener("click", (event) => {
      const target = event?.target;
      const card = target?.closest ? target.closest("[data-runtime-actor-id]") : null;
      const actorId = card?.dataset?.runtimeActorId;
      if (actorId) {
        selectActor(actorId);
      }
    });
  }

  function bindAction(button, action) {
    if (!button?.addEventListener) return;
    button.addEventListener("click", () => emitAction(action));
  }

  bindCardSelection(attackerCardEl);
  bindCardSelection(visibleDefendersEl);
  bindCardSelection(offscreenDefendersEl);

  bindAction(moveUpButton, "up");
  bindAction(moveDownButton, "down");
  bindAction(moveLeftButton, "left");
  bindAction(moveRightButton, "right");
  bindAction(castButton, "cast");

  renderEmpty();

  return {
    updateFromSimulation({ observation, frame, actorIdLabel } = {}) {
      latestObservation = {
        actors: Array.isArray(observation?.actors) ? observation.actors : [],
        baseTiles: Array.isArray(frame?.baseTiles) ? frame.baseTiles : [],
        tick: Number.isFinite(frame?.tick) ? frame.tick : null,
        actorIdLabel: normalizeActorId(actorIdLabel),
      };
      const actorIds = new Set(latestObservation.actors.map((actor) => normalizeActorId(actor?.id)));
      if (!actorIds.has(normalizeActorId(selectedActorId))) {
        selectedActorId = "";
      }
      renderFromState();
    },
    selectActor,
    setViewportSize(size) {
      viewportSize = Math.max(1, toPositiveInt(size, DEFAULT_VIEWPORT_SIZE));
      renderFromState();
    },
    getSelectedActorId: () => selectedActorId,
  };
}
