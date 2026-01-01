const DEFAULT_CONFIG = Object.freeze({
  seed: 1337,
  mapPreset: "mvp-grid",
  actorName: "MVP Walker",
  actorId: "actor_mvp",
  fixtureMode: "fixture",
  vitals: {
    health: { current: 10, max: 10, regen: 0 },
    mana: { current: 0, max: 0, regen: 0 },
    stamina: { current: 10, max: 10, regen: 0 },
    durability: { current: 10, max: 10, regen: 0 },
  },
});

function parseNumber(value, fallback) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function cloneConfig(config) {
  return JSON.parse(JSON.stringify(config));
}

function buildConfigFromInputs(elements) {
  const vitals = ["health", "mana", "stamina", "durability"].reduce((acc, key) => {
    const inputs = elements.vitals?.[key] || {};
    acc[key] = {
      current: parseNumber(inputs.current?.value, DEFAULT_CONFIG.vitals[key].current),
      max: parseNumber(inputs.max?.value, DEFAULT_CONFIG.vitals[key].max),
      regen: parseNumber(inputs.regen?.value, DEFAULT_CONFIG.vitals[key].regen),
    };
    return acc;
  }, {});

  return {
    seed: parseNumber(elements.seedInput?.value, DEFAULT_CONFIG.seed),
    mapPreset: elements.mapSelect?.value || DEFAULT_CONFIG.mapPreset,
    actorName: (elements.actorNameInput?.value || DEFAULT_CONFIG.actorName).trim(),
    actorId: (elements.actorIdInput?.value || DEFAULT_CONFIG.actorId).trim() || DEFAULT_CONFIG.actorId,
    fixtureMode: elements.fixtureSelect?.value || DEFAULT_CONFIG.fixtureMode,
    vitals,
  };
}

function applyConfigToInputs(config, elements) {
  if (elements.seedInput && !elements.seedInput.value) elements.seedInput.value = String(config.seed);
  if (elements.mapSelect && !elements.mapSelect.value) elements.mapSelect.value = config.mapPreset;
  if (elements.actorNameInput && !elements.actorNameInput.value) elements.actorNameInput.value = config.actorName;
  if (elements.actorIdInput && !elements.actorIdInput.value) elements.actorIdInput.value = config.actorId;
  if (elements.fixtureSelect && !elements.fixtureSelect.value) elements.fixtureSelect.value = config.fixtureMode;

  const vitalsKeys = ["health", "mana", "stamina", "durability"];
  for (const key of vitalsKeys) {
    const inputs = elements.vitals?.[key];
    if (!inputs) continue;
    if (inputs.current && !inputs.current.value) inputs.current.value = String(config.vitals[key].current);
    if (inputs.max && !inputs.max.value) inputs.max.value = String(config.vitals[key].max);
    if (inputs.regen && !inputs.regen.value) inputs.regen.value = String(config.vitals[key].regen);
  }
}

function validateConfig(config) {
  const seedValid = Number.isInteger(config.seed) && config.seed >= 0;
  const nameValid = config.actorName.length > 0;
  return { seedValid, nameValid, ok: seedValid && nameValid };
}

function renderBadges(validation, elements) {
  if (elements.seedBadge) {
    elements.seedBadge.textContent = validation.seedValid ? "Seed ok" : "Invalid seed";
  }
  if (elements.nameBadge) {
    elements.nameBadge.textContent = validation.nameValid ? "Name ok" : "Name required";
  }
  if (elements.modeBadge) {
    elements.modeBadge.textContent = elements.fixtureSelect?.value || DEFAULT_CONFIG.fixtureMode;
  }
}

function renderPreview(config, elements) {
  if (elements.preview) {
    const summary = {
      seed: config.seed,
      map: config.mapPreset,
      actor: { name: config.actorName, id: config.actorId },
      vitals: config.vitals,
      fixtures: config.fixtureMode,
    };
    elements.preview.textContent = JSON.stringify(summary, null, 2);
  }
}

export function wireRunBuilder({ elements, onStart }) {
  const state = cloneConfig(DEFAULT_CONFIG);

  function refresh() {
    const config = buildConfigFromInputs(elements);
    Object.assign(state, config);
    const validation = validateConfig(config);
    renderBadges(validation, elements);
    renderPreview(config, elements);
    if (elements.startButton) {
      elements.startButton.disabled = !validation.ok;
    }
    if (elements.resetButton) {
      elements.resetButton.disabled = false;
    }
  }

  function reset() {
    const next = cloneConfig(DEFAULT_CONFIG);
    Object.assign(state, next);
    applyConfigToInputs(next, elements);
    refresh();
  }

  function handleStart() {
    const config = buildConfigFromInputs(elements);
    const validation = validateConfig(config);
    if (!validation.ok) {
      return;
    }
    if (typeof onStart === "function") {
      onStart(config);
    }
  }

  applyConfigToInputs(state, elements);
  refresh();

  const listenTargets = [
    elements.seedInput,
    elements.mapSelect,
    elements.actorNameInput,
    elements.actorIdInput,
    elements.fixtureSelect,
    ...(Object.values(elements.vitals || {}).flatMap((group) => [group.current, group.max, group.regen]) || []),
  ].filter(Boolean);

  listenTargets.forEach((el) => {
    if (typeof el.addEventListener === "function") {
      el.addEventListener("input", refresh);
      el.addEventListener("change", refresh);
    }
  });

  if (elements.startButton && typeof elements.startButton.addEventListener === "function") {
    elements.startButton.addEventListener("click", handleStart);
  }
  if (elements.resetButton && typeof elements.resetButton.addEventListener === "function") {
    elements.resetButton.addEventListener("click", reset);
  }

  return {
    getConfig: () => cloneConfig(state),
    reset,
    validate: () => validateConfig(state),
  };
}
