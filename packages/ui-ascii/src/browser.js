/**
 * The Deepward playtest app (a PWA): the terminal game on a phone, with no server. It runs the
 * same game controller as `cli.mjs` (`game.js`, which drives the runtime play session) on a level
 * `scripts/pwa/build-pwa.mjs` built ahead of time with `ak create`. This file owns the page only:
 * the scenario picker, touch keys, saving a game on the device and the playtest report. It decides
 * no rule, imports runtime and this package only, and has no analysis console (#500).
 */
import { createGame } from "./game.js";
import { ansiToHtml } from "./html.js";
import { intentForKey } from "./keymap.js";
import { encodeReplay, renderReport } from "./report.js";

const SAVE_KEY = "deepward.save.v1";
const $ = (id) => document.getElementById(id);

// Touch keys: label, the terminal key it sends, and (for the pad) nothing more. Rule text stays in keymap.js.
const PAD = [["y", "↖"], ["k", "↑"], ["u", "↗"], ["h", "←"], [".", "wait"], ["l", "→"], ["b", "↙"], ["j", "↓"], ["n", "↘"]];
const ACTIONS = [["i", "equip"], ["f", "cast"], ["g", "take"], ["x", "sprint"], ["\t", "next"], ["\r", "ok"], ["\u001b", "back"], ["?", "help"],
  ["1", "1"], ["2", "2"], ["3", "3"], ["v", "look"], ["+", "range+"], ["-", "range−"], ["]", "power+"], ["[", "power−"], ["o", "order"], ["z", "wall"], ["e", "watch"], ["r", "restart"]];
const KEYS = { ArrowUp: "\u001b[A", ArrowDown: "\u001b[B", ArrowRight: "\u001b[C", ArrowLeft: "\u001b[D", Enter: "\r", Escape: "\u001b", Tab: "\t" };

let catalog = null;
let current = null; // { scenario, entry, game }
let queue = Promise.resolve();

const safe = (action) => { try { return action(); } catch { return null; } };
const readSave = () => safe(() => JSON.parse(localStorage.getItem(SAVE_KEY)));
const writeSave = (value) => safe(() => (value ? localStorage.setItem(SAVE_KEY, JSON.stringify(value)) : localStorage.removeItem(SAVE_KEY)));

function show(view) {
  for (const id of ["picker", "brief", "game"]) $(id).hidden = id !== view;
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
  $("version").textContent = `build ${catalog.commit}`;
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
  show("brief");
}

async function loadLevel(entry) {
  const response = await fetch(entry.file);
  if (!response.ok) throw new Error(`could not load ${entry.file}`);
  return response.json();
}

async function startGame(scenario, entry, capture = null) {
  const level = { name: `${scenario.title}, seed ${entry.seed}`, ...(await loadLevel(entry)) };
  const game = await createGame({ levels: [level], fog: true, showHelp: false });
  if (capture) await game.replay(capture);
  current = { scenario, entry, game };
  show("game");
  draw();
  persist();
}

// Fit the screen to the space it has: the board and the HUD are fixed-width text that should
// show whole. Lines longer than a board row (panels, help) wrap instead of shrinking it.
const BOARD_COLUMNS_MAX = 40;
const GLYPH_WIDTH = 0.602;
const LINE_HEIGHT = 1.2;
function fit(text) {
  const lines = text.split("\n");
  const chars = Math.min(BOARD_COLUMNS_MAX, Math.max(20, ...lines.map((line) => line.length)));
  const rows = lines.reduce((total, line) => total + Math.max(1, Math.ceil(line.length / chars)), 0);
  const board = $("board");
  const byWidth = (board.clientWidth - 16) / (chars * GLYPH_WIDTH);
  const byHeight = board.clientHeight / (rows * LINE_HEIGHT);
  $("screen").style.fontSize = `${Math.max(9, Math.min(18, Math.floor(Math.min(byWidth, byHeight))))}px`;
}

function draw() {
  const { game } = current;
  fit(game.screen({ color: false }));
  $("screen").innerHTML = ansiToHtml(game.screen({ color: "truecolor" }));
}

function persist() {
  const { scenario, entry, game } = current;
  const capture = game.captureInput({ id: `pwa_${scenario.id}_${entry.seed}`, runId: `playtest-${scenario.id}-s${entry.seed}`, createdAt: catalog.createdAt });
  writeSave({ scenario: scenario.id, seed: entry.seed, capture });
}

function press(key) {
  if (!current) return;
  queue = queue.then(async () => {
    const intent = intentForKey(key);
    // In a tab, q and Esc close an open panel but never end the game.
    if (!intent || (intent.type === "quit" && current.game.state().panel === null)) return;
    if (intent.type === "restart") writeSave(null);
    await current.game.handle(intent);
    draw();
    persist();
  }).catch((error) => { $("screen").textContent = `Something went wrong: ${error.message}\nOpen the menu and use Report, then restart.`; });
}

async function buildReport(notes) {
  const { scenario, entry, game } = current;
  const state = game.state();
  const capture = game.captureInput({ id: "pwa_report", runId: "pwa_report", createdAt: catalog.createdAt });
  return renderReport({
    scenario, seed: entry.seed, picks: entry.picks, traits: entry.traits, cost: entry.cost,
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

function setup() {
  const buttons = (list, parent, className) => {
    for (const [key, label] of list) {
      const el = document.createElement("button");
      el.textContent = label;
      el.className = className;
      el.dataset.key = key;
      el.addEventListener("click", () => press(key));
      parent.appendChild(el);
    }
  };
  buttons(PAD, $("pad"), "pad");
  buttons(ACTIONS, $("actions"), "act");
  document.addEventListener("keydown", (event) => {
    if (!current || $("game").hidden || event.metaKey || event.ctrlKey || event.altKey || event.target.closest?.("dialog")) return;
    const key = KEYS[event.key] ?? (event.key.length === 1 ? event.key : null);
    if (key === null) return;
    event.preventDefault();
    press(key);
  });
  $("resume").addEventListener("click", async () => {
    const save = readSave();
    const scenario = catalog.scenarios.find((entry) => entry.id === save?.scenario);
    const entry = scenario?.seeds.find((candidate) => candidate.seed === save.seed);
    if (entry) await startGame(scenario, entry, save.capture).catch(() => { writeSave(null); renderPicker(); });
  });
  $("start").addEventListener("click", () => startGame(briefScenario, briefScenario.seeds[briefSeed], null).then(() => writeSave(null) || persist()));
  $("back-picker").addEventListener("click", renderPicker);
  $("menu").addEventListener("click", () => $("menu-dialog").showModal());
  $("menu-dialog").addEventListener("click", (event) => { if (event.target === $("menu-dialog")) $("menu-dialog").close(); });
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
  window.addEventListener("resize", () => { if (current && !$("game").hidden) draw(); });
}

async function main() {
  setup();
  catalog = await (await fetch("catalog.json")).json();
  renderPicker();
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
}

main().catch((error) => { document.body.textContent = `Deepward could not start: ${error.message}`; });
