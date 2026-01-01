import { packMoveAction, renderFrameBuffer, readObservation } from "../../bindings-ts/src/mvp-movement.js";

export function setupPlayback({ core, actions, actorIdLabel = "actor_mvp", actorIdValue = 1, intervalMs = 500, elements }) {
  let currentIndex = 0;
  let playing = false;
  let timer = null;
  const vitalKeys = ["health", "mana", "stamina", "durability"];

  function kindLabel(kind) {
    if (kind === 0) return "stationary";
    if (kind === 1) return "barrier";
    if (kind === 2) return "motivated";
    return `kind:${kind}`;
  }

  function formatVitals(vitals = {}) {
    return vitalKeys
      .map((key) => {
        const record = vitals[key] || { current: 0, max: 0, regen: 0 };
        return `${key[0].toUpperCase()}:${record.current}/${record.max}+${record.regen}`;
      })
      .join(" ");
  }

  function sortActors(list) {
    return list.slice().sort((a, b) => {
      const left = a?.id || "";
      const right = b?.id || "";
      if (left === right) return 0;
      return left < right ? -1 : 1;
    });
  }

  function render() {
    const frame = renderFrameBuffer(core, { actorIdLabel });
    const obs = readObservation(core, { actorIdLabel });
    if (elements.frame) elements.frame.textContent = frame.buffer.join("\n");
    if (elements.baseTiles) elements.baseTiles.textContent = frame.baseTiles.join("\n");
    if (elements.actorId) elements.actorId.textContent = actorIdLabel;
    if (elements.actorPos) elements.actorPos.textContent = `(${obs.actor.x}, ${obs.actor.y})`;
    if (elements.actorHp) elements.actorHp.textContent = `${obs.actor.hp}/${obs.actor.maxHp}`;
    if (elements.tick) elements.tick.textContent = String(frame.tick);
    if (elements.status) elements.status.textContent = currentIndex >= actions.length ? "Reached exit" : "Ready";
    if (elements.playButton) {
      elements.playButton.textContent = playing ? "Pause" : "Play";
      elements.playButton.disabled = currentIndex >= actions.length && !playing;
    }
    if (elements.stepBack) elements.stepBack.disabled = currentIndex <= 0;
    if (elements.stepForward) elements.stepForward.disabled = currentIndex >= actions.length;
    if (elements.reset) elements.reset.disabled = false;
    if (elements.actorList) {
      const list = sortActors(obs.actors || []);
      elements.actorList.textContent = list.length
        ? list.map((entry) => `${entry.id} [${kindLabel(entry.kind)}] @(${entry.position.x},${entry.position.y}) ${formatVitals(entry.vitals)}`).join("\n")
        : "-";
    }
    if (elements.tileActorList) {
      const tiles = sortActors(obs.tileActors || []);
      elements.tileActorList.textContent = tiles.length
        ? tiles.map((entry) => `${entry.id} [${kindLabel(entry.kind)}] @(${entry.position.x},${entry.position.y}) ${formatVitals(entry.vitals)}`).join("\n")
        : "-";
      if (elements.tileActorCount) elements.tileActorCount.textContent = String(tiles.length);
    }
  }

  function resetCore() {
    core.init(1337);
    core.loadMvpScenario();
    core.clearEffects?.();
  }

  function applyAction(action) {
    const packed = packMoveAction({
      actorId: actorIdValue,
      from: action.params.from,
      to: action.params.to,
      direction: action.params.direction,
      tick: action.tick,
    });
    core.applyAction(8, packed);
    core.clearEffects?.();
  }

  function gotoIndex(target) {
    const clamped = Math.max(0, Math.min(actions.length, target));
    resetCore();
    for (let i = 0; i < clamped; i += 1) {
      applyAction(actions[i]);
    }
    currentIndex = clamped;
    render();
  }

  function stepForward() {
    if (currentIndex >= actions.length) {
      stop();
      return;
    }
    applyAction(actions[currentIndex]);
    currentIndex += 1;
    render();
  }

  function stepBack() {
    gotoIndex(currentIndex - 1);
  }

  function stop() {
    playing = false;
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    render();
  }

  function play() {
    if (playing || currentIndex >= actions.length) {
      return;
    }
    playing = true;
    render();
    timer = setInterval(() => {
      stepForward();
      if (currentIndex >= actions.length) {
        stop();
      }
    }, intervalMs);
  }

  function toggle() {
    if (playing) {
      stop();
    } else {
      play();
    }
  }

  function reset() {
    stop();
    gotoIndex(0);
  }

  resetCore();
  render();

  return {
    stepForward,
    stepBack,
    play,
    pause: stop,
    toggle,
    reset,
    gotoIndex,
    getIndex: () => currentIndex,
    isPlaying: () => playing,
  };
}
