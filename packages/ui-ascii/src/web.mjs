/**
 * The terminal game in a browser tab: a local web server that runs the same game
 * controller as `cli.mjs` and shows the same screen. The page sends keypresses and
 * receives the screen as HTML; nothing here decides a rule. Only `node:` built-ins.
 *
 *   node packages/ui-ascii/src/cli.mjs --web [--port 8765] [--lan] [--level first-steps]
 *
 * It listens on this machine only, unless `--lan` opens it to the local network so a
 * phone on the same Wi-Fi can play; the page has touch buttons for that.
 */
import { createServer } from "node:http";
import { networkInterfaces } from "node:os";
import { ansiToHtml } from "./html.js";
import { intentForKey, splitKeys } from "./keymap.js";
import { DEFAULT_REALTIME_MS, REALTIME_TOGGLE_KEY, realtimeBeat, realtimeLine } from "./realtime.js";

export { ansiToHtml };
export const DEFAULT_WEB_PORT = 8765;

/** The addresses another device on the local network can reach this machine at. */
export function lanAddresses(interfaces = networkInterfaces()) {
  return Object.values(interfaces).flat()
    .filter((entry) => entry && (entry.family === "IPv4" || entry.family === 4) && !entry.internal)
    .map((entry) => entry.address);
}

// Touch buttons: each sends one terminal key. Directions in compass layout, wait in the middle.
const PAD = [["y", "↖"], ["k", "↑"], ["u", "↗"], ["h", "←"], [".", "·"], ["l", "→"], ["b", "↙"], ["j", "↓"], ["n", "↘"]];
const ACTIONS = [["i", "i"], ["f", "f"], ["\t", "Tab"], ["\r", "Enter"], ["\u001b", "Esc"], ["1", "1"], ["2", "2"], ["3", "3"],
  ["g", "g"], ["o", "o"], ["x", "x"], ["+", "+"], ["-", "-"], ["t", "t"], ["r", "r"], ["?", "?"]];
const button = ([key, label]) => `<button data-key="${encodeURIComponent(key)}">${label}</button>`;

// #500: the analysis console, only in a `--debug` page. Evaluation, not play: it shows what
// the player is not told. The panel reads `/debug` (the play session's debugView).
const DEBUG_STYLE = `
  body.debug main { display: flex; gap: 16px; align-items: flex-start; flex-wrap: wrap; }
  #debug { font-size: 12px; max-width: 520px; max-height: 92vh; overflow: auto; border-left: 1px solid #3a3a44; padding-left: 12px; }
  #debug h3 { margin: 8px 0 4px; font-size: 12px; color: #9a9ab0; }
  #debug table { border-collapse: collapse; } #debug td, #debug th { padding: 1px 6px 1px 0; text-align: left; vertical-align: top; }
  #debug .log div { white-space: pre-wrap; }`;
const DEBUG_PANEL = `<aside id="debug"><b>ANALYSIS (debug)</b><div id="tile">Click a board tile for everything on it.</div><div id="level"></div><div id="actors"></div><div class="log" id="log"></div></aside>`;
const DEBUG_SCRIPT = `
let dbg = null;
const esc = (v) => String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;");
const vit = (a) => Object.entries(a.vitals || {}).map(([k, v]) => k + " " + v.current + "/" + v.max + " +" + v.regen).join(", ");
const aff = (a) => (a.affinities || []).map((f) => f.kind + ":" + f.expression + " r" + f.stacks + (f.intensity ? " i" + f.intensity : "")).join(", ");
async function refreshDebug() {
  dbg = await (await fetch("/debug")).json();
  document.getElementById("level").innerHTML = "<h3>Level</h3>tick " + dbg.tick + ", seed " + dbg.seed + ", receipt "
    + esc(dbg.budgetReceiptRef ? dbg.budgetReceiptRef.id : "none") + (dbg.actionCosts ? ", action costs " + esc(JSON.stringify(dbg.actionCosts)) : "");
  const rc = dbg.costing && dbg.costing.receipt, pl = dbg.costing && dbg.costing.prices;
  document.getElementById("level").innerHTML += rc ? "<h3>Budget receipt</h3>" + esc(rc.status + ", total " + rc.totalCost + ", remaining " + rc.remaining)
    + (rc.lineItems || []).map((i) => "<div>" + esc(JSON.stringify(i)) + "</div>").join("") : "";
  document.getElementById("level").innerHTML += pl ? "<h3>Price list (" + (pl.items || []).length + ")</h3>"
    + (pl.items || []).map((i) => "<div>" + esc(i.id + " " + i.kind + " " + i.costTokens) + "</div>").join("") : "";
  document.getElementById("actors").innerHTML = "<h3>Actors</h3><table>" + dbg.actors.map((a) => "<tr><td>" + esc((a.label || "") + " " + a.id)
    + "</td><td>" + esc(a.role + " " + a.lifecycle + (a.exited ? " exited" : "") + " @" + a.position.x + "," + a.position.y)
    + "</td><td>" + esc((a.motivations || []).join("+")) + "</td><td>" + esc(vit(a)) + "</td><td>" + esc(aff(a))
    + (a.activeAffinityKey ? esc(" [active " + a.activeAffinityKey + "]") : "") + "</td></tr>").join("") + "</table>";
  document.getElementById("log").innerHTML = "<h3>Events</h3>" + dbg.events.slice(-60).reverse().map((e) => "<div>" + esc(JSON.stringify(e)) + "</div>").join("");
}
screen.addEventListener("click", (event) => {
  if (!dbg) return;
  const probe = document.createElement("span"); probe.textContent = "M".repeat(20); probe.style.visibility = "hidden"; screen.appendChild(probe);
  const box = probe.getBoundingClientRect(); screen.removeChild(probe);
  const rect = screen.getBoundingClientRect(); const charW = box.width / 20; const lineH = parseFloat(getComputedStyle(screen).lineHeight) || box.height;
  const x = Math.floor((event.clientX - rect.left + screen.scrollLeft) / charW) - 2, y = Math.floor((event.clientY - rect.top) / lineH) - 2;
  const here = dbg.actors.filter((a) => a.position.x === x && a.position.y === y);
  const field = ((dbg.field && dbg.field[y] && dbg.field[y][x]) || []);
  document.getElementById("tile").innerHTML = "<h3>Tile " + x + "," + y + "</h3>" + (here.map((a) => esc(JSON.stringify(a))).join("<br>") || "no actor")
    + "<br>field: " + (field.map((f) => esc(f.kind + " x" + f.stacks + " from " + (f.sources || []).join(","))).join("; ") || "none");
});`;

// Browser key names -> the keys the terminal keymap reads.
const pageFor = (debug) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Deepward</title>
<style>
  :root { color-scheme: dark; }
  body { margin: 0; background: #0d0d0f; color: #d8d8d8; font: 16px/1.25 ui-monospace, Menlo, Consolas, monospace; }
  main { padding: 16px; }
  pre { margin: 0; white-space: pre; overflow-x: auto; }
  #note { color: #8a8a8a; margin-top: 12px; font-size: 13px; }
  #touch { display: flex; flex-wrap: wrap; gap: 16px; margin-top: 16px; align-items: flex-start; }
  #pad { display: grid; grid-template-columns: repeat(3, 56px); gap: 6px; }
  #actions { display: grid; grid-template-columns: repeat(5, 52px); gap: 6px; }
  button { height: 48px; font: inherit; color: #d8d8d8; background: #222228; border: 1px solid #3a3a44; border-radius: 8px;
    touch-action: manipulation; -webkit-user-select: none; user-select: none; }
  button:active { background: #33333c; }
  @media (max-width: 600px) { body { font-size: 12px; } main { padding: 8px 16px; } }
  @media (hover: hover) and (pointer: fine) { #touch { display: none; } }
${debug ? DEBUG_STYLE : ""}
</style></head>
<body${debug ? ' class="debug"' : ""}><main><div><pre id="screen">Loading…</pre>
<div id="touch"><div id="pad">${PAD.map(button).join("")}</div><div id="actions">${ACTIONS.map(button).join("")}</div></div>
<div id="note">Same keys as the terminal; ? shows them. On a phone, use the buttons.</div></div>${debug ? DEBUG_PANEL : ""}</main>
<script>
const KEYS = { ArrowUp: "\\u001b[A", ArrowDown: "\\u001b[B", ArrowRight: "\\u001b[C", ArrowLeft: "\\u001b[D",
  Enter: "\\r", Escape: "\\u001b", Tab: "\\t" };
const screen = document.getElementById("screen");
const show = (html) => { screen.innerHTML = html; if (window.refreshDebug) window.refreshDebug(); };
let queue = Promise.resolve();
const send = (key) => { queue = queue.then(() => fetch("/key", { method: "POST", body: key }).then((r) => r.text()).then(show)).catch(() => {}); };
document.addEventListener("keydown", (event) => {
  if (event.metaKey || event.ctrlKey || event.altKey) return;
  const key = KEYS[event.key] ?? (event.key.length === 1 ? event.key : null);
  if (key === null) return;
  event.preventDefault();
  send(key);
});
for (const el of document.querySelectorAll("button[data-key]")) {
  el.addEventListener("click", () => send(decodeURIComponent(el.dataset.key)));
}
const events = new EventSource("/events");
events.onmessage = (event) => show(JSON.parse(event.data));
${debug ? DEBUG_SCRIPT.replace("async function refreshDebug", "window.refreshDebug = async function refreshDebug") : ""}
</script></body></html>`;

/**
 * Serve `game` on `port` (0 picks a free one). Keys run strictly in order on one
 * chain, as in the terminal; real time (`t`, or `realtimeMs`) beats on the same chain.
 * `q` does not quit (the tab is closed instead). Resolves with the server once listening.
 */
export function startWebGame(game, { port = DEFAULT_WEB_PORT, host = "127.0.0.1", realtimeMs = null, debug = false } = {}) {
  const page = pageFor(debug);
  const realtime = { on: realtimeMs !== null, intervalMs: realtimeMs ?? DEFAULT_REALTIME_MS, timer: null };
  const listeners = new Set();
  const render = () => ansiToHtml(`${game.screen({ color: "truecolor" })}\n\n${realtimeLine(realtime)}`);
  const broadcast = () => {
    const data = `data: ${JSON.stringify(render())}\n\n`;
    for (const response of listeners) response.write(data);
  };
  let pending = Promise.resolve();
  const schedule = () => {
    if (realtime.timer) clearInterval(realtime.timer);
    realtime.timer = realtime.on ? setInterval(() => {
      pending = pending.then(async () => { if (await realtimeBeat(game)) broadcast(); });
    }, realtime.intervalMs) : null;
  };
  schedule();

  async function press(text) {
    for (const key of splitKeys(text)) {
      if (key === REALTIME_TOGGLE_KEY) {
        realtime.on = !realtime.on;
        schedule();
        continue;
      }
      const intent = intentForKey(key);
      // In a tab, q and Esc close an open panel but never end the game.
      if (intent?.type === "quit" && game.state().panel === null) continue;
      await game.handle(intent);
    }
  }

  const server = createServer((request, response) => {
    if (request.method === "GET" && request.url === "/") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(page);
      return;
    }
    // #500: the analysis data exists only when the server was started with `--debug`.
    if (debug && request.method === "GET" && request.url === "/debug") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(game.debugView()));
      return;
    }
    if (request.method === "GET" && request.url === "/screen") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(render());
      return;
    }
    if (request.method === "GET" && request.url === "/events") {
      response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
      response.write(`data: ${JSON.stringify(render())}\n\n`);
      listeners.add(response);
      request.on("close", () => listeners.delete(response));
      return;
    }
    if (request.method === "POST" && request.url === "/key") {
      let body = "";
      request.setEncoding("utf8");
      request.on("data", (chunk) => { body += chunk; });
      request.on("end", () => {
        pending = pending.then(async () => {
          await press(body.slice(0, 64));
          const html = render();
          response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
          response.end(html);
          broadcast();
        });
      });
      return;
    }
    response.writeHead(404);
    response.end();
  });
  server.on("close", () => {
    if (realtime.timer) clearInterval(realtime.timer);
    for (const response of listeners) response.end();
  });
  return new Promise((resolveServer, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => resolveServer(server));
  });
}
