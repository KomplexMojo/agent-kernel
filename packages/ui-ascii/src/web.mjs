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
import { intentForKey, splitKeys } from "./keymap.js";
import { DEFAULT_REALTIME_MS, REALTIME_TOGGLE_KEY, realtimeBeat, realtimeLine } from "./realtime.js";

export const DEFAULT_WEB_PORT = 8765;

const escapeHtml = (text) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * The game's 24-bit ANSI screen as HTML spans. Reads only what `screen.js` writes:
 * `38;2;r;g;b` (foreground), `48;2;r;g;b` (background) and `0` (reset).
 */
export function ansiToHtml(text) {
  let fg = null;
  let bg = null;
  let out = "";
  const parts = String(text).split(/\u001b\[([0-9;]*)m/);
  for (let i = 0; i < parts.length; i += 1) {
    if (i % 2 === 1) {
      const codes = parts[i].split(";").map(Number);
      for (let c = 0; c < codes.length; c += 1) {
        if (codes[c] === 0 || parts[i] === "") { fg = null; bg = null; }
        else if ((codes[c] === 38 || codes[c] === 48) && codes[c + 1] === 2) {
          const rgb = `rgb(${codes[c + 2]},${codes[c + 3]},${codes[c + 4]})`;
          if (codes[c] === 38) fg = rgb; else bg = rgb;
          c += 4;
        }
      }
      continue;
    }
    if (!parts[i]) continue;
    const style = [fg && `color:${fg}`, bg && `background:${bg}`].filter(Boolean).join(";");
    out += style ? `<span style="${style}">${escapeHtml(parts[i])}</span>` : escapeHtml(parts[i]);
  }
  return out;
}

/** The addresses another device on the local network can reach this machine at. */
export function lanAddresses(interfaces = networkInterfaces()) {
  return Object.values(interfaces).flat()
    .filter((entry) => entry && (entry.family === "IPv4" || entry.family === 4) && !entry.internal)
    .map((entry) => entry.address);
}

// Touch buttons: each sends one terminal key. Directions in compass layout, wait in the middle.
const PAD = [["y", "↖"], ["k", "↑"], ["u", "↗"], ["h", "←"], [".", "·"], ["l", "→"], ["b", "↙"], ["j", "↓"], ["n", "↘"]];
const ACTIONS = [["i", "i"], ["f", "f"], ["\t", "Tab"], ["\r", "Enter"], ["\u001b", "Esc"], ["1", "1"], ["2", "2"], ["3", "3"],
  ["g", "g"], ["o", "o"], ["+", "+"], ["-", "-"], ["t", "t"], ["r", "r"], ["?", "?"]];
const button = ([key, label]) => `<button data-key="${encodeURIComponent(key)}">${label}</button>`;

// Browser key names -> the keys the terminal keymap reads.
const PAGE = `<!doctype html>
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
</style></head>
<body><main><pre id="screen">Loading…</pre>
<div id="touch"><div id="pad">${PAD.map(button).join("")}</div><div id="actions">${ACTIONS.map(button).join("")}</div></div>
<div id="note">Same keys as the terminal; ? shows them. On a phone, use the buttons.</div></main>
<script>
const KEYS = { ArrowUp: "\\u001b[A", ArrowDown: "\\u001b[B", ArrowRight: "\\u001b[C", ArrowLeft: "\\u001b[D",
  Enter: "\\r", Escape: "\\u001b", Tab: "\\t" };
const screen = document.getElementById("screen");
const show = (html) => { screen.innerHTML = html; };
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
</script></body></html>`;

/**
 * Serve `game` on `port` (0 picks a free one). Keys run strictly in order on one
 * chain, as in the terminal; real time (`t`, or `realtimeMs`) beats on the same chain.
 * `q` does not quit (the tab is closed instead). Resolves with the server once listening.
 */
export function startWebGame(game, { port = DEFAULT_WEB_PORT, host = "127.0.0.1", realtimeMs = null } = {}) {
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
      response.end(PAGE);
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
