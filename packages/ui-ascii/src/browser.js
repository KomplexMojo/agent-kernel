/**
 * The Deepward playtest app (a PWA): the terminal game on a phone, with no server. It runs the
 * same game controller as `cli.mjs` (`game.js`, which drives the runtime play session) on a level
 * `scripts/pwa/build-pwa.mjs` built ahead of time with `ak create`. This file owns the page only:
 * the scenario picker, touch keys, saving a game on the device and the playtest report. It decides
 * no rule, imports runtime and this package only, and has no analysis console (#500).
 *
 * The character screen (#557) draws runtime's character sheet (the Allocator prices every row)
 * and, on Play, hands the scenario's `ak create` arguments with your delver in them to the host's
 * `buildLevel`, which `scripts/pwa/app-entry.js` wires to the same authoring code `ak create` runs.
 */
import { createGame } from "./game.js";
import { ansiToHtml } from "./html.js";
import { HELP_LINES, intentForKey } from "./keymap.js";
import { encodeReplay, renderReport } from "./report.js";
import { createCharacterSheet } from "../../runtime/src/runner/character-sheet.js";
import { GAME_AFFINITY_COLOR_HEX } from "../../runtime/src/contracts/game-elements.js";

// The build this page was bundled from (the build script defines it); "dev" when run unbundled.
const BUILD = typeof __BUILD__ === "undefined" ? "dev" : __BUILD__;
const UPDATE_CHECK_MS = 5 * 60 * 1000;
const SAVE_KEY = "deepward.save.v1";
const $ = (id) => document.getElementById(id);

// Touch keys: [terminal key, label]. Rule text stays in keymap.js; the layout is the page's.
const PAD = [["y", "↖"], ["k", "↑"], ["u", "↗"], ["h", "←"], [".", "wait"], ["l", "→"], ["b", "↙"], ["j", "↓"], ["n", "↘"]];
const PAD_AIM = PAD.map(([key, label]) => (key === "." ? ["\t", "next"] : [key, label]));
const MORE = [["v", "Look"], ["e", "Watch"], ["o", "Order"], ["z", "Barrier"], ["\t", "Next ally"], ["?", "Help"]];
const KEEP_OUT_OF_BOARD = 8; // px gutter either side of the board
const KEYS = { ArrowUp: "\u001b[A", ArrowDown: "\u001b[B", ArrowRight: "\u001b[C", ArrowLeft: "\u001b[D", Enter: "\r", Escape: "\u001b", Tab: "\t" };

let host = {};
let catalog = null;
let current = null; // { scenario, entry, game, character?, cost? }
let sheetState = null; // { scenario, entry, level, sheet, picking (the slot row whose kind list is open) } while the character screen is open
let queue = Promise.resolve();

const safe = (action) => { try { return action(); } catch { return null; } };
const readSave = () => safe(() => JSON.parse(localStorage.getItem(SAVE_KEY)));
const writeSave = (value) => safe(() => (value ? localStorage.setItem(SAVE_KEY, JSON.stringify(value)) : localStorage.removeItem(SAVE_KEY)));

function show(view) {
  for (const id of ["picker", "brief", "character", "game"]) $(id).hidden = id !== view;
}

function levelLabel(entry) {
  return `${entry.picks.A}, against ${entry.picks.B}`;
}

function renderPicker() {
  const save = readSave();
  const saved = save && catalog.scenarios.find((scenario) => scenario.id === save.scenario);
  $("resume").hidden = !saved;
  if (saved) $("resume").textContent = `Resume: ${saved.title}, seed ${save.seed}, turn ${save.capture?.payload?.commands?.length ?? 0}`;
  $("scenarios").innerHTML = "";
  for (const scenario of catalog.scenarios) {
    const card = document.createElement("button");
    card.className = "card";
    card.innerHTML = `<b></b><span></span>`;
    card.firstChild.textContent = scenario.title;
    card.lastChild.textContent = scenario.shows;
    card.addEventListener("click", () => openBrief(scenario));
    $("scenarios").appendChild(card);
  }
  $("version").textContent = `You are on build ${BUILD}`;
  show("picker");
}

let briefScenario = null;
let briefSeed = 0;

function openBrief(scenario, seed = Math.floor(Math.random() * scenario.seeds.length)) {
  briefScenario = scenario;
  briefSeed = seed;
  $("brief-title").textContent = scenario.title;
  $("seeds").innerHTML = "";
  for (const entry of scenario.seeds) {
    const chip = document.createElement("button");
    chip.className = `chip${entry.seed === briefSeed ? " on" : ""}`;
    chip.textContent = `${entry.seed} · ${entry.picks.A}`;
    chip.addEventListener("click", () => openBrief(scenario, entry.seed));
    $("seeds").appendChild(chip);
  }
  const entry = scenario.seeds[briefSeed];
  $("brief-who").textContent = entry.traits ? `You carry ${entry.traits}; the wardens carry ${entry.picks.B} and ${entry.picks.D}.` : `You are ${levelLabel(entry)}; other pair ${entry.picks.C}/${entry.picks.D}.`;
  $("brief-focus").innerHTML = "";
  for (const line of entry.focus) {
    const item = document.createElement("li");
    item.textContent = line;
    $("brief-focus").appendChild(item);
  }
  $("configure").hidden = typeof host.buildLevel !== "function";
  show("brief");
}

async function loadLevel(entry) {
  const response = await fetch(entry.file);
  if (!response.ok) throw new Error(`could not load ${entry.file}`);
  return response.json();
}

// `custom` is a level the character screen built: { level, character, cost }.
async function startGame(scenario, entry, capture = null, custom = null) {
  const level = { name: `${scenario.title}, seed ${entry.seed}`, ...(custom?.level ?? (await loadLevel(entry))) };
  const game = await createGame({ levels: [level], fog: true, showHelp: false });
  if (capture) await game.replay(capture);
  current = { scenario, entry, game, selected: null, sheet: null, character: custom?.character ?? null, cost: custom?.cost ?? null };
  show("game");
  fitBoard();
  render();
  persist();
}

// The board is a fixed square. Its text is fitted to it once per level (and on resize), from the
// level's own width and height, so what happens below it never changes its size or place.
const GLYPH_WIDTH = 0.602;
const LINE_HEIGHT = 1.2;
function fitBoard() {
  const { board } = current.game.screen({ color: false, parts: true });
  if (!board) return;
  const side = $("board").clientWidth;
  const cols = Math.max(1, ...board.map((row) => row.length));
  $("boardtext").style.fontSize = `${Math.max(6, Math.floor(Math.min(side / (cols * GLYPH_WIDTH), side / (board.length * LINE_HEIGHT)))) }px`;
}

const touchButton = (key, label, className = "") => `<button class="k ${className}" data-key="${encodeURIComponent(key)}">${label}</button>`;
const actionButton = (id, label, className = "") => `<button class="k ${className}" data-act="${id}">${label}</button>`;
const esc = (text) => String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;");

function renderSlots(game) {
  const { slots, picks } = game.slots();
  if (current.selected && !slots.some((slot) => slot.key === current.selected)) current.selected = null;
  $("slots").innerHTML = slots.map((slot) => {
    if (slot.empty) return `<button class="slot empty" data-slot="${slot.index}" ${picks.length ? "" : "disabled"}>+ empty</button>`;
    const state = slot.castable ? `reach ${slot.reach}` : slot.off ? "drained" : "ON";
    return `<button class="slot${slot.key === current.selected ? " on" : ""}${slot.off ? " off" : ""}" data-slot="${slot.index}" style="--c:${slot.color ?? "#888"}">
      <b>${esc(slot.kind)}</b><small>${esc(slot.expression)} r${slot.stacks.running} ×${slot.intensity.running}</small><em>${state}</em></button>`;
  }).join("");
  const held = slots.find((slot) => slot.key === current.selected);
  const stepper = (field, name, level) => `<div><span>${name} <b>${level.running}${level.running < level.held ? `/${level.held}` : ""}</b></span>
    <button data-tune="${field}:-1" ${level.running <= 1 ? "disabled" : ""}>−</button><button data-tune="${field}:1" ${level.running >= level.held ? "disabled" : ""}>+</button></div>`;
  $("tune").className = held ? "tune" : "tune hint";
  $("tune").innerHTML = held
    ? `${stepper("stacks", "range", held.stacks)}${stepper("intensity", "power", held.intensity)}<button data-tune="off">unequip</button>`
    : "tap a slot to aim it, or an empty one to equip";
  return picks;
}

function renderControls(game, st, picks) {
  const sheet = current.sheet;
  const choices = game.panelChoices();
  const control = $("controls");
  if (st.status.exited || st.status.defeated) {
    control.innerHTML = `<div class="grid end">${touchButton("r", st.status.exited ? "Replay" : "Try again", "go")}${actionButton("report", "Report")}${actionButton("scenarios", "Other scenario")}</div>`;
  } else if (sheet === "picker") {
    control.innerHTML = `<div class="grid list">${picks.map((pick) => actionButton(`equip:${pick.key}`, esc(pick.label))).join("")}${actionButton("close", "Cancel ✕", "no")}</div>`;
  } else if (sheet === "more") {
    control.innerHTML = `<div class="grid more">${MORE.map(([key, label]) => touchButton(key, label)).join("")}${actionButton("close", "Close ✕", "no")}</div>`;
  } else if (choices) {
    control.innerHTML = `<div class="grid list">${choices.items.map((label, i) => touchButton(String(i + 1), `${i + 1}. ${esc(label)}`)).join("")}${touchButton("\u001b", "Cancel ✕", "no")}</div>`;
  } else if (st.panel === "aim" || st.panel === "target") {
    const looking = st.panelFlags.inspect || st.panelFlags.watch;
    const confirm = st.panelFlags.raise ? "Raise ✓" : looking ? "Do it ✓" : "Cast ✓";
    const pad = looking ? PAD_AIM.map(([key, label]) => (key === "\t" ? [key, label] : [null, ""])) : PAD_AIM;
    control.innerHTML = `<div class="pad">${pad.map(([key, label]) => (key ? touchButton(key, label) : "<span></span>")).join("")}</div>
      <div class="act">${touchButton("\r", confirm, "go")}${touchButton("\t", "Next target")}${touchButton("\u001b", "Cancel ✕", "no")}</div>`;
  } else {
    control.innerHTML = `<div class="pad">${PAD.map(([key, label]) => touchButton(key, label)).join("")}</div>
      <div class="act">${touchButton("g", "Take")}${touchButton("x", st.sprintArmed ? "Sprint ✓" : "Sprint", st.sprintArmed ? "go" : "")}${actionButton("more", "More ⋯")}</div>`;
  }
}

// What the message band shows: what just happened, then the open panel in touch words, then what is in sight.
function renderMessage(parts) {
  if (parts.defeat) return [parts.status || "You were defeated."];
  const panel = parts.panel
    .filter((line) => !/^\s+Move keys aim/.test(line))
    .map((line) => line.replace(/\s+Tab next.*$/, "").replace(/\s*\((?:a number|Tab picks)[^)]*\)/, ""));
  return [parts.status, ...panel, ...parts.info, ...(parts.log?.length ? ["Battle log", ...parts.log] : [])];
}

function render() {
  const { game } = current;
  const st = game.state();
  const parts = game.screen({ color: "truecolor", parts: true });
  $("title").textContent = `${current.scenario.title} · seed ${current.entry.seed} · turn ${st.turns}`;
  if (parts.defeat) {
    $("boardtext").innerHTML = ansiToHtml(parts.defeat);
    $("vitals").innerHTML = "";
  } else {
    $("boardtext").innerHTML = parts.board.map(ansiToHtml).join("\n");
    $("vitals").innerHTML = parts.vitals.map((vital) => `<div>${esc(vital.label)} ${esc(vital.text)}<i style="width:${Math.round(Math.max(0, Math.min(1, vital.fraction)) * 100)}%;background:${vital.colorHex}"></i></div>`).join("")
      + (parts.soaked ? `<div>${esc(parts.soaked)}</div>` : "");
  }
  const lines = renderMessage(parts);
  $("msg").innerHTML = lines.map((line, i) => `<div${i === 0 ? ' class="first"' : ""}>${esc(line)}</div>`).join("");
  $("msg").scrollTop = 0;
  renderControls(game, st, renderSlots(game));
}

function persist() {
  const { scenario, entry, game } = current;
  const capture = game.captureInput({ id: `pwa_${scenario.id}_${entry.seed}`, runId: `playtest-${scenario.id}-s${entry.seed}`, createdAt: catalog.createdAt });
  writeSave({ scenario: scenario.id, seed: entry.seed, capture, ...(current.character ? { character: current.character } : {}) });
}

// Everything that changes the game runs on one chain, in order, then the screen is redrawn.
function run(action) {
  if (!current) return;
  queue = queue.then(async () => {
    await action(current.game);
    render();
    persist();
  }).catch((error) => { $("msg").textContent = `Something went wrong: ${error.message}. Open the menu and use Report, then restart.`; });
}

function press(key) {
  run(async (game) => {
    if (current.sheet && key !== "?") current.sheet = null;
    if (key === "?") { $("help-dialog").showModal(); return; }
    const intent = intentForKey(key);
    // In a tab, q and Esc close an open panel but never end the game.
    if (!intent || (intent.type === "quit" && game.state().panel === null)) return;
    if (intent.type === "restart") writeSave(null);
    await game.handle(intent);
  });
}

function slotTap(index) {
  run(async (game) => {
    const { slots } = game.slots();
    const slot = slots[index];
    if (!slot) return;
    if (slot.empty) { current.sheet = "picker"; return; }
    current.selected = slot.key;
    current.sheet = null;
    if (game.state().panel) await game.handle(intentForKey("\u001b"));
    // One tap on a held push or pull aims it; emit and draw run on their own, so the tap selects them for tuning.
    if (slot.castable) await game.handle(intentForKey(String(index + 1)));
  });
}

function tuneTap(what) {
  run(async (game) => {
    const key = current.selected;
    if (!key) return;
    if (what === "off") { current.selected = null; await game.toggleSlotAffinity(key); return; }
    const [field, step] = what.split(":");
    await game.tuneSlot(key, field, Number(step));
  });
}

function actionTap(id) {
  if (id === "report") return openReport();
  if (id === "scenarios") return renderPicker();
  if (id === "more") { current.sheet = "more"; return render(); }
  if (id === "close") { current.sheet = null; return render(); }
  if (id.startsWith("equip:")) {
    return run(async (game) => { current.sheet = null; await game.toggleSlotAffinity(id.slice(6)); });
  }
}

async function buildReport(notes) {
  const { scenario, entry, game } = current;
  const state = game.state();
  const capture = game.captureInput({ id: "pwa_report", runId: "pwa_report", createdAt: catalog.createdAt });
  return renderReport({
    scenario, seed: entry.seed, picks: entry.picks, traits: entry.traits, cost: current.cost ?? entry.cost,
    ...(current.character ? { character: current.character } : {}),
    commit: catalog.commit, createdAt: catalog.createdAt, playedAt: new Date().toISOString(),
    final: { turns: state.turns, status: state.status }, screen: game.screen({ color: false }),
    notes, replayCode: await encodeReplay(capture.payload.commands),
    device: navigator.userAgent.replace(/^Mozilla\/5\.0 /, "").slice(0, 80),
  });
}

function openReport() {
  $("report-text").value = "";
  $("report-status").textContent = "";
  $("report-dialog").showModal();
}

async function reportText() {
  const notes = $("report-notes").value.split("\n").map((line) => line.trim()).filter(Boolean);
  return buildReport(notes);
}

// The character screen (#557). The sheet holds the choices; this only draws them as tappable fields.
async function openCharacter(scenario, entry) {
  const level = await loadLevel(entry);
  if (!level.character) {
    $("brief-who").textContent = "This build has no character data for this level; update the app.";
    return;
  }
  sheetState = { scenario, entry, level, sheet: createCharacterSheet({ spec: level.character.hero, budgetTokens: level.character.allowance ?? undefined }), note: "", picking: null };
  renderSheet();
  show("character");
  window.scrollTo(0, 0);
}

function fieldButton(rowIndex, fieldIndex, label, { on, kind, color } = {}) {
  return `<button class="f${on ? " on" : ""}${kind ? " kind" : ""}" data-row="${rowIndex}" data-field="${fieldIndex}"${color ? ` style="--c:${color}"` : ""}>${esc(label)}</button>`;
}

function renderSheet() {
  const view = sheetState.sheet.view();
  const used = Math.min(1, view.total / Math.max(1, view.allowance));
  $("allowance").innerHTML = `Budget ${view.total} of ${view.allowance} tokens · ${view.remaining >= 0 ? `${view.remaining} left` : `${-view.remaining} over`}`
    + `<i><b style="width:${Math.round(used * 100)}%;--c:${view.remaining >= 0 ? "var(--accent)" : "#e07a6a"}"></b></i>`;
  const label = { kind: (v) => v, expression: (v) => v, range: (v) => `range ${v}`, intensity: (v) => `×${v}`, start: (v) => (v === "equipped" ? "on" : "off"), max: (v) => `max ${v}`, regen: (v) => `+${v}` };
  const rows = view.rows.map((row, rowIndex) => {
    const on = (fieldIndex) => row.active && view.cursor.field === fieldIndex;
    const fields = row.fields.map((field, fieldIndex) => fieldButton(rowIndex, fieldIndex, label[field.name](field.value), {
      on: on(fieldIndex), kind: field.name === "kind", color: field.name === "kind" ? GAME_AFFINITY_COLOR_HEX[field.value] : null,
    })).join("");
    const line = `<div class="srow${row.kind === "vital" ? " vital" : ""}${row.empty ? " empty" : ""}"><span>${esc(row.label)}</span>${fields}<em>${row.price}</em></div>`;
    if (sheetState.picking !== rowIndex) return line;
    // The kind box was tapped: every kind (and none) is offered under it; a tap sets it.
    const current = row.fields[0].value;
    return line + `<div class="kinds">${view.choices.kind.map((kind) => `<button class="f kind${kind === current ? " on" : ""}" data-pick="${esc(kind)}"`
      + `${GAME_AFFINITY_COLOR_HEX[kind] ? ` style="--c:${GAME_AFFINITY_COLOR_HEX[kind]}"` : ""}>${esc(kind)}</button>`).join("")}</div>`;
  });
  const slotCount = view.rows.filter((row) => row.kind === "slot").length;
  $("sheet").innerHTML = `<h2>Affinity slots (first ${view.freeSlots} free)</h2>${rows.slice(0, slotCount).join("")}`
    + (view.slotsExtraPrice ? `<div class="srow"><span></span><span class="dim">extra slots</span><em>${view.slotsExtraPrice}</em></div>` : "")
    + `<h2>Vitals</h2>${rows.slice(slotCount).join("")}`
    + `<p class="dim">${esc(view.motivation.name)} (you play it): ${view.motivation.price}. "on" slots start equipped. Every price is the Allocator's.</p>`;
  $("sheet-note").innerHTML = sheetState.note
    ? esc(sheetState.note)
    : view.problems.map((problem) => `<div class="bad">${esc(problem)}</div>`).join("") || "Tap an affinity to pick it; tap any other field, then − or + to change it.";
}

/** The level cost line of a report, from the receipt the Allocator issued for a level built here. */
function reportedCost(receipt) {
  if (!receipt) return null;
  return { totalSpend: receipt.totalCost, budgetTokens: receipt.totalCost + receipt.remaining, status: receipt.status };
}

async function buildCustom(scenario, entry, character, level = null) {
  const source = level ?? (await loadLevel(entry));
  const argv = source.character.argv.map((arg) => (arg === source.character.hero ? character : arg));
  const built = await host.buildLevel({ argv, solverAnswers: source.character.solverAnswers });
  if (built.budgetReceipt?.status && built.budgetReceipt.status !== "approved") throw new Error(`the Allocator did not approve this level (${built.budgetReceipt.status})`);
  return {
    level: { simConfig: built.simConfig, initialState: built.initialState },
    character,
    cost: reportedCost(built.budgetReceipt),
    // A placement the recorded answers could not settle would differ from `playtest.sh --open`.
    placementDiffers: (built.solverDecisions ?? []).some((decision) => decision.reason === "no_recorded_answer"),
  };
}

async function sheetTap(intent) {
  sheetState.note = "";
  const outcome = sheetState.sheet.apply(intent);
  if (outcome.done !== "confirm") { renderSheet(); return; }
  sheetState.building = true;
  sheetState.note = "Building your level…";
  renderSheet();
  try {
    const { scenario, entry, level } = sheetState;
    const custom = await buildCustom(scenario, entry, outcome.spec, level);
    writeSave(null);
    await startGame(scenario, entry, null, custom);
    if (custom.placementDiffers) $("msg").textContent = "Note: this level's layout may differ from the terminal's for the same seed.";
  } catch (error) {
    sheetState.note = `Could not build this level: ${error.message}`;
    renderSheet();
  } finally {
    sheetState.building = false;
  }
}

function setup() {
  // Taps are delegated, so the controls can be redrawn freely.
  $("game").addEventListener("click", (event) => {
    const el = event.target.closest("button");
    if (!el || !current) return;
    if (el.dataset.key !== undefined) press(decodeURIComponent(el.dataset.key));
    else if (el.dataset.slot !== undefined) slotTap(Number(el.dataset.slot));
    else if (el.dataset.tune !== undefined) tuneTap(el.dataset.tune);
    else if (el.dataset.act !== undefined) actionTap(el.dataset.act);
  });
  document.addEventListener("keydown", (event) => {
    if (!current || $("game").hidden || event.metaKey || event.ctrlKey || event.altKey || event.target.closest?.("dialog")) return;
    const key = KEYS[event.key] ?? (event.key.length === 1 ? event.key : null);
    if (key === null) return;
    // A physical keyboard: the touch controls go away (they also hide for a mouse and keyboard by media query).
    document.body.classList.add("kbd");
    fitBoard();
    event.preventDefault();
    press(key);
  });
  $("help-text").textContent = [...HELP_LINES].join("\n");
  $("help-close").addEventListener("click", () => $("help-dialog").close());
  $("resume").addEventListener("click", async () => {
    const save = readSave();
    const scenario = catalog.scenarios.find((entry) => entry.id === save?.scenario);
    const entry = scenario?.seeds.find((candidate) => candidate.seed === save.seed);
    if (!entry) return;
    const custom = save.character ? await buildCustom(scenario, entry, save.character).catch(() => null) : null;
    if (save.character && !custom) { writeSave(null); renderPicker(); return; }
    await startGame(scenario, entry, save.capture, custom).catch(() => { writeSave(null); renderPicker(); });
  });
  $("start").addEventListener("click", () => startGame(briefScenario, briefScenario.seeds[briefSeed], null).then(() => writeSave(null) || persist()));
  $("back-picker").addEventListener("click", renderPicker);
  $("configure").addEventListener("click", () => openCharacter(briefScenario, briefScenario.seeds[briefSeed]));
  $("back-brief").addEventListener("click", () => openBrief(sheetState.scenario, sheetState.entry.seed));
  $("character").addEventListener("click", (event) => {
    const el = event.target.closest("button");
    if (!el || !sheetState || sheetState.building) return;
    if (el.dataset.pick !== undefined) {
      sheetState.sheet.choose(sheetState.picking, "kind", el.dataset.pick);
      sheetState.picking = null;
      renderSheet();
    } else if (el.dataset.row !== undefined) {
      const row = Number(el.dataset.row);
      const field = Number(el.dataset.field);
      const isKind = sheetState.sheet.view().rows[row]?.kind === "slot" && field === 0;
      sheetState.picking = isKind && sheetState.picking !== row ? row : null;
      sheetState.sheet.select(row, field);
      renderSheet();
    } else if (el.dataset.sheet !== undefined) { sheetState.picking = null; sheetTap(el.dataset.sheet); }
  });
  $("menu-dialog").addEventListener("click", (event) => { if (event.target === $("menu-dialog")) $("menu-dialog").close(); });
  $("menu-help").addEventListener("click", () => { $("menu-dialog").close(); $("help-dialog").showModal(); });
  $("menu-restart").addEventListener("click", () => {
    // Restarting throws the game away, so the first tap only asks.
    if ($("menu-restart").dataset.sure !== "yes") { $("menu-restart").dataset.sure = "yes"; $("menu-restart").textContent = "Tap again to restart"; return; }
    $("menu-dialog").close();
    run(async (game) => { current.sheet = null; current.selected = null; await game.handle(intentForKey("r")); });
  });
  $("menu").addEventListener("click", () => { $("menu-restart").dataset.sure = ""; $("menu-restart").textContent = "Restart this level"; $("menu-dialog").showModal(); });
  $("menu-brief").addEventListener("click", () => { $("menu-dialog").close(); openBrief(current.scenario, current.entry.seed); });
  $("menu-scenarios").addEventListener("click", () => { $("menu-dialog").close(); renderPicker(); });
  $("menu-report").addEventListener("click", () => { $("menu-dialog").close(); openReport(); });
  $("report-close").addEventListener("click", () => $("report-dialog").close());
  $("report-copy").addEventListener("click", async () => {
    $("report-text").value = await reportText();
    $("report-text").select();
    const done = await navigator.clipboard?.writeText($("report-text").value).then(() => true, () => false);
    $("report-status").textContent = done ? "Copied. Paste it to Darren." : "Select the text above and copy it.";
  });
  $("report-share").addEventListener("click", async () => {
    const text = await reportText();
    $("report-text").value = text;
    if (navigator.share) await navigator.share({ title: "Deepward playtest report", text }).catch(() => {});
    else $("report-status").textContent = "Sharing is not available here: use Copy.";
  });
  $("report-download").addEventListener("click", async () => {
    const text = await reportText();
    $("report-text").value = text;
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([text], { type: "text/markdown" }));
    link.download = `playtest-${current.scenario.id}-s${current.entry.seed}.md`;
    link.click();
    URL.revokeObjectURL(link.href);
  });
  window.addEventListener("resize", () => { if (current && !$("game").hidden) fitBoard(); });
}

// Ask the host which build is live (never from cache). A different one means a new version was deployed.
async function checkForUpdate() {
  try {
    const live = await (await fetch(`version.json?t=${Date.now()}`, { cache: "no-store" })).json();
    if (live?.commit && live.commit !== BUILD && BUILD !== "dev") {
      $("update-text").textContent = `New version ${live.commit} is available (you have ${BUILD}).`;
      $("update").hidden = false;
    }
  } catch { /* offline: keep playing */ }
}

// Drop the old cached files and reload; the saved game stays on the device and shows as Resume.
async function applyUpdate() {
  try {
    const registration = await navigator.serviceWorker?.getRegistration();
    await registration?.update();
    for (const name of await caches.keys()) await caches.delete(name);
  } catch { /* reload anyway */ }
  location.reload();
}

/** Start the page. `appHost.buildLevel({ argv, solverAnswers })` builds a level from `ak create` arguments. */
export async function startApp(appHost = {}) {
  host = appHost;
  setup();
  catalog = await (await fetch("catalog.json")).json();
  renderPicker();
  $("update-apply").addEventListener("click", applyUpdate);
  $("update-later").addEventListener("click", () => { $("update").hidden = true; });
  $("menu-version").textContent = `Build ${BUILD}`;
  checkForUpdate();
  setInterval(checkForUpdate, UPDATE_CHECK_MS);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") checkForUpdate(); });
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
}

export function startAppSafely(appHost) {
  return startApp(appHost).catch((error) => { document.body.textContent = `Deepward could not start: ${error.message}`; });
}
