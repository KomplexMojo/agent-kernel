import { packMoveAction, renderFrameBuffer, readObservation } from "../../bindings-ts/src/mvp-movement.js";

export function setupPlayback({ core, actions, actorIdLabel = "actor_mvp", actorIdValue = 1, intervalMs = 500, elements }) {
  let currentIndex = 0;
  let playing = false;
  let timer = null;

  function render() {
    const frame = renderFrameBuffer(core, { actorIdLabel });
    const obs = readObservation(core, { actorIdLabel });
    if (elements.frame) elements.frame.textContent = frame.buffer.join("\n");
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
