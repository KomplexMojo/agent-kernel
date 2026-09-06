'use strict';

/**
 * On-demand benchmark status: what is the run doing RIGHT NOW.
 *
 * The heartbeat already publishes every five minutes, and that is the right cadence for an alarm
 * and the wrong one for a person who is watching. `run-content-gen` rewrites `progress.json` after
 * every attempt (atomic rename), so reading that file directly is fresher than the beacon by up to
 * a whole beat interval -- observed live at 186 attempts on disk against 180 in the last beat.
 *
 * Three constraints, each of which this repo has already been bitten by once:
 *
 *   - **Never glob for progress.json.** Every historical run leaves its own copy behind, so the
 *     newest by mtime is not the run in flight -- it is whichever run last wrote, including one
 *     that finished days ago. Reporting a finished run's numbers as current is precisely the
 *     silent-wrong-answer shape the heartbeat exists to eliminate. The run key comes from the
 *     agent's own state file and nowhere else.
 *   - **The probe requires nothing from the installed package.** `~/remote-ollama-control` on the
 *     box is an installed FILE COPY, not a checkout, so a module added to this repo does not exist
 *     there until someone reinstalls. A probe that required one would work on the box it was
 *     written against and fail on a freshly provisioned one, long after anybody would connect the
 *     failure to this file. It is therefore self-contained and shipped over stdin.
 *   - **Progress is a range, not a percentage.** Early stop means recorded attempts cannot predict
 *     the remainder, so every count is a floor/ceiling pair. A single "31% complete" would be a
 *     number this system cannot actually know.
 *
 * This module only reports. It never starts, stops, or publishes anything.
 */

const STATUS_SCHEMA_VERSION = 'agent-kernel-benchmark-status/v1';

/**
 * The program that runs ON the box. Self-contained by design (see above): `node:fs`, `node:os` and
 * `node:path` only. Emits exactly one JSON document on stdout.
 */
const PROBE_SOURCE = `'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const stateDir = process.env.AK_BENCHMARK_STATE_DIR
  || path.join(os.homedir(), '.local/state/agent-kernel-benchmark');

const MAX_ATTEMPT_RECORDS = 4000;
const MAX_STDERR_CHARS = 4000;
const MAX_TOOL_ARGS_CHARS = 4000;

const out = {
  schemaVersion: '${STATUS_SCHEMA_VERSION}',
  probedAt: new Date().toISOString(),
  status: 'idle',
  live: false,
  sourceCommit: null,
  runKey: null,
  runStartedAt: null,
  progress: null,
  attempts: [],
  attemptsTruncated: false,
  error: null,
};

// process.stdout.write() to a PIPE is asynchronous in node, and process.exit() does not flush what
// is still queued -- so this truncated at the 64KB pipe buffer and emitted a torn JSON document.
// It only showed up once the payload carried real failure records, i.e. exactly when the output
// mattered. fs.writeSync loops because a pipe write can legally be partial.
function emit() {
  const payload = Buffer.from(JSON.stringify(out) + '\\n');
  let written = 0;
  while (written < payload.length) {
    try {
      written += fs.writeSync(1, payload, written, payload.length - written);
    } catch (error) {
      if (error.code === 'EAGAIN') continue;
      throw error;
    }
  }
  process.exit(0);
}

let state = null;
try {
  const statePath = path.join(stateDir, 'state.json');
  state = fs.existsSync(statePath) ? JSON.parse(fs.readFileSync(statePath, 'utf8')) : null;
} catch (error) {
  // An unreadable state file is itself the finding. Reporting "idle" here would look identical to
  // a box with nothing to do, which is the one confusion worth never introducing.
  out.status = 'unreadable';
  out.error = 'agent state unreadable: ' + error.message;
  emit();
}

// Same resolution as latestResultDir(): '-content-gen' suffix, lexical sort. Directory names are
// ISO timestamps, so lexical order is chronological.
function latestContentGenDir(runKey) {
  const authoring = path.join(stateDir, 'runs', runKey, 'authoring');
  try {
    const names = fs.readdirSync(authoring).filter((n) => n.endsWith('-content-gen')).sort();
    return names.length > 0 ? path.join(authoring, names[names.length - 1]) : null;
  } catch {
    return null;
  }
}

const inFlight = state && state.inFlight ? state.inFlight : null;
let runDir = null;

if (inFlight && inFlight.runKey) {
  out.status = 'running';
  out.live = true;
  out.runKey = inFlight.runKey;
  out.sourceCommit = inFlight.sourceCommit || null;
  runDir = latestContentGenDir(inFlight.runKey);
} else {
  // Nothing in flight. Showing the LAST run is far more useful than an empty page -- but it is
  // labelled 'finished' and live:false, and never rendered as though it were current. Presenting a
  // completed run as the live one is the single wrong answer this whole rig exists to prevent.
  out.sourceCommit = state ? (state.lastEvaluatedCommit || null) : null;
  let newest = null;
  try {
    for (const key of fs.readdirSync(path.join(stateDir, 'runs'))) {
      const candidate = latestContentGenDir(key);
      if (candidate && (newest === null || path.basename(candidate) > path.basename(newest.dir))) {
        newest = { dir: candidate, key };
      }
    }
  } catch {
    newest = null;
  }
  if (newest) {
    out.status = 'finished';
    out.runKey = newest.key;
    runDir = newest.dir;
  }
}

if (!runDir) emit();

out.runStartedAt = path.basename(runDir).replace(/-content-gen$/, '');

try {
  out.progress = JSON.parse(fs.readFileSync(path.join(runDir, 'progress.json'), 'utf8'));
} catch {
  // Mid-rename or damaged. "No progress yet" is honest; a torn document would look like data.
  out.progress = null;
}

// Per-attempt records carry the only real failure evidence: the executor's stderr, the outcome the
// scenario expected against the one it got, and the tool arguments the model actually produced.
const clip = (value, limit) => {
  if (typeof value !== 'string') return value;
  return value.length > limit ? value.slice(0, limit) + '\\n[truncated]' : value;
};

try {
  const lines = fs.readFileSync(path.join(runDir, 'runs.jsonl'), 'utf8').split('\\n');
  for (const line of lines) {
    if (!line.trim()) continue;
    if (out.attempts.length >= MAX_ATTEMPT_RECORDS) { out.attemptsTruncated = true; break; }
    let record;
    try { record = JSON.parse(line); } catch { continue; }
    if (record.recordKind !== 'content_gen_attempt') continue;
    out.attempts.push({
      runId: record.runId,
      timestamp: record.timestamp,
      configurationId: record.configurationId,
      model: record.model,
      profile: record.profile,
      scenarioIndex: record.scenarioIndex,
      scenarioTitle: record.scenarioTitle,
      scenarioTier: record.scenarioTier,
      repeat: record.repeat,
      expectedOutcome: record.expectedOutcome,
      executionOutcome: record.executionOutcome,
      failureClass: record.failureClass,
      scenarioVerdict: record.scenarioVerdict,
      toolCallProduced: record.toolCallProduced,
      score: record.score,
      scoreMax: record.scoreMax,
      scoreBreakdown: record.scoreBreakdown,
      execSucceeded: record.execSucceeded,
      execExitCode: record.execExitCode,
      execStderr: clip(record.execStderr, MAX_STDERR_CHARS),
      llmError: clip(record.llmError, MAX_STDERR_CHARS),
      llmMs: record.llmMs,
      execMs: record.execMs,
      toolArgs: clip(JSON.stringify(record.toolArgs), MAX_TOOL_ARGS_CHARS),
    });
  }
} catch {
  // No runs.jsonl yet (a run that has not finished its first attempt). The overview still stands.
}

emit();
`;

const HOUR_MS = 3600000;

const hours = (ms) => `${(ms / HOUR_MS).toFixed(1)}h`;
const rate = (value) => (typeof value === 'number' ? value.toFixed(3) : String(value));

function stalenessSeconds(document) {
  const generatedAt = document.progress?.generatedAt;
  if (!generatedAt) return null;
  const probed = Date.parse(document.probedAt);
  const written = Date.parse(generatedAt);
  if (!Number.isFinite(probed) || !Number.isFinite(written)) return null;
  return Math.max(0, Math.round((probed - written) / 1000));
}

/**
 * A configuration with zero attempts has no verdict yet. Rendering "yes" for it would read as
 * evidence it is on track, when in fact nothing has been measured.
 */
function qualificationLabel(configuration) {
  if (!configuration.attempts) return '-';
  return configuration.canStillQualify ? 'yes' : 'NO';
}

function formatStatusText(document) {
  const lines = [];

  if (document.status === 'unreadable') {
    return `status   : UNREADABLE\n${document.error || 'agent state could not be read'}\n`;
  }
  if (document.status !== 'running') {
    return `status   : idle — no run in flight${
      document.sourceCommit ? ` (last evaluated ${document.sourceCommit.slice(0, 8)})` : ''
    }\n`;
  }
  if (!document.progress) {
    return 'status   : running, no progress.json yet (the run has only just started)\n';
  }

  const { progress } = document;
  const stale = stalenessSeconds(document);
  const attempts = progress.attempts || {};
  const performance = progress.performance || {};

  lines.push(`status   : running   commit ${(document.sourceCommit || '?').slice(0, 8)}`);
  lines.push(`progress : written ${stale === null ? '?' : `${stale}s`} ago | elapsed ${hours(progress.elapsedMs || 0)}`);
  lines.push(`attempts : ${attempts.recorded} (floor ${attempts.floor} / ceiling ${attempts.ceiling})`
    + `  remaining ${attempts.remainingFloor}-${attempts.remainingCeiling}`);
  lines.push(`rate     : ${performance.attemptsPerHour}/h  medianLLM `
    + `${Math.round((performance.medianLlmMs || 0) / 1000)}s  `
    + `ETA ${hours(performance.etaFloorMs || 0)}-${hours(performance.etaCeilingMs || 0)}`);
  lines.push('');
  lines.push('config'.padEnd(46) + 'att'.padStart(5) + 'tool'.padStart(8)
    + 'verdict'.padStart(9) + 'score'.padStart(7) + '  qual');

  for (const configuration of progress.configurations || []) {
    lines.push(
      String(configuration.configurationId).replace('cg-v1--', '').padEnd(46)
      + String(configuration.attempts).padStart(5)
      + rate(configuration.toolCallRate).padStart(8)
      + rate(configuration.scenarioVerdictRate).padStart(9)
      + String(configuration.averageScore).padStart(7)
      + '  ' + qualificationLabel(configuration),
    );
  }

  if (progress.alerts?.length) {
    lines.push('');
    for (const alert of progress.alerts) lines.push(`ALERT: ${alert}`);
  }

  return `${lines.join('\n')}\n`;
}

const firstLine = (text) => String(text || '').split('\n').map((l) => l.trim()).find(Boolean) || '';

/**
 * Collapse a failure message to a grouping key.
 *
 * The counts are the point: "insufficient unoccupied walkable tiles (0 available, 1 requested)" and
 * the same message with different numbers are ONE defect, and left un-normalised they would appear
 * as two singletons in a list of eighty. Digits become N so the shapes group; nothing else is
 * rewritten, because a reason you cannot trace back to a real message is not actionable.
 */
function normalizeReason(attempt) {
  const generalize = (line) => line.replace(/\d+/g, 'N').replace(/\s+/g, ' ').trim().slice(0, 180);
  if (attempt.llmError) return `LLM error — ${generalize(firstLine(attempt.llmError))}`;
  const stderr = firstLine(attempt.execStderr);
  if (stderr) return generalize(stderr);
  if (attempt.toolCallProduced === false) return 'no tool call produced';
  const verdict = attempt.scenarioVerdict || {};
  if (verdict.expected && verdict.actual && verdict.expected !== verdict.actual) {
    return `outcome mismatch — expected ${verdict.expected}, got ${verdict.actual}`;
  }
  return attempt.executionOutcome || 'unknown';
}

const hasFailed = (attempt) => (attempt.scenarioVerdict || {}).passed === false;

/**
 * Failures grouped two ways, because they answer different questions: the outcome says which stage
 * broke, the reason says what actually went wrong there.
 */
function summarizeFailures(attempts = []) {
  const failing = attempts.filter(hasFailed);
  const tally = (list, key) => {
    const counts = new Map();
    for (const item of list) {
      const value = key(item);
      counts.set(value, (counts.get(value) || 0) + 1);
    }
    return [...counts.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  };

  return {
    attempts: attempts.length,
    failing: failing.length,
    byOutcome: tally(failing, (a) => a.executionOutcome || 'unknown'),
    byReason: tally(failing, normalizeReason),
    byModel: tally(failing, (a) => a.model || 'unknown'),
  };
}

const escapeHtml = (value) => String(value)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

/**
 * Rates live in 0..1 and need three decimals to show the margin to a 0.99 bar; a 0..100 score does
 * not. Formatting both the same way renders the score bar as "62.800 / 75.000", which reads like a
 * precision the scorer does not have.
 */
const measure = (value) => (typeof value !== 'number'
  ? String(value)
  : (Math.abs(value) <= 1 ? value.toFixed(3) : String(Number(value.toFixed(1)))));

function meterRow(label, value, threshold) {
  const met = typeof value === 'number' && typeof threshold === 'number' && value >= threshold;
  const width = Math.max(0, Math.min(100, (Number(value) / (Number(threshold) || 1)) * 100));
  return `<tr>
      <th scope="row">${escapeHtml(label)}</th>
      <td class="num">${escapeHtml(measure(value))}</td>
      <td class="num muted">${escapeHtml(measure(threshold))}</td>
      <td class="bar"><span class="${met ? 'met' : 'miss'}" style="width:${width.toFixed(1)}%"></span></td>
      <td class="verdict ${met ? 'met' : 'miss'}">${met ? 'meets' : 'below'}</td>
    </tr>`;
}

function configurationRow(configuration) {
  const label = qualificationLabel(configuration);
  const state = label === 'NO' ? 'dead' : (label === '-' ? 'pending' : 'live');
  const stateText = { dead: 'cannot qualify', pending: 'not started', live: 'on track' }[state];
  return `<tr class="${state}">
      <td class="cfg"><strong>${escapeHtml(configuration.model || '?')}</strong>
        <span class="muted">${escapeHtml(configuration.profile || '')}</span></td>
      <td class="num">${escapeHtml(configuration.attempts)}</td>
      <td class="num">${escapeHtml(configuration.passesComplete ?? 0)}</td>
      <td class="num">${escapeHtml(rate(configuration.toolCallRate))}</td>
      <td class="num">${escapeHtml(rate(configuration.scenarioVerdictRate))}</td>
      <td class="num">${escapeHtml(configuration.averageScore)}</td>
      <td class="state"><span class="pill ${state}">${escapeHtml(stateText)}</span></td>
    </tr>`;
}

const PAGE_CSS = `
:root{color-scheme:light dark;--bg:#f6f7f9;--panel:#fff;--ink:#14171a;--muted:#697280;
--line:#e3e6ea;--met:#1a7f5a;--miss:#b3341f;--pend:#8a93a0;--accent:#2f5fd0}
@media(prefers-color-scheme:dark){:root{--bg:#0e1116;--panel:#161b22;--ink:#e6edf3;
--muted:#8b949e;--line:#262c36;--met:#3fb984;--miss:#f0785f;--pend:#6e7681;--accent:#6b9bff}}
*{box-sizing:border-box}
body{margin:0;padding:32px;background:var(--bg);color:var(--ink);
font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif}
.wrap{max-width:980px;margin:0 auto}
h1{font-size:20px;margin:0 0 4px}
.sub{color:var(--muted);margin:0 0 24px;font-variant-numeric:tabular-nums}
.badge{display:inline-block;padding:2px 10px;border-radius:999px;font-size:12px;
font-weight:600;letter-spacing:.02em;text-transform:uppercase;vertical-align:2px;margin-right:8px}
.badge.running{background:color-mix(in srgb,var(--met) 18%,transparent);color:var(--met)}
.badge.idle{background:color-mix(in srgb,var(--pend) 22%,transparent);color:var(--muted)}
.badge.unreadable{background:color-mix(in srgb,var(--miss) 18%,transparent);color:var(--miss)}
.panel{background:var(--panel);border:1px solid var(--line);border-radius:10px;
padding:20px 22px;margin-bottom:20px}
.panel h2{font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);
margin:0 0 14px;font-weight:600}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:18px}
.stat .k{color:var(--muted);font-size:12px}
.stat .v{font-size:22px;font-weight:600;font-variant-numeric:tabular-nums;margin-top:2px}
.stat .n{color:var(--muted);font-size:12px;font-variant-numeric:tabular-nums}
.range{margin-top:18px}
.track{position:relative;height:10px;border-radius:999px;background:var(--line);overflow:hidden}
.track .done{position:absolute;inset:0 auto 0 0;background:var(--accent);border-radius:999px}
.track .floor{position:absolute;top:-3px;bottom:-3px;width:2px;background:var(--muted)}
.rlabels{display:flex;justify-content:space-between;color:var(--muted);font-size:12px;margin-top:6px;
font-variant-numeric:tabular-nums}
.tw{overflow-x:auto;-webkit-overflow-scrolling:touch}
table{width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums;min-width:520px}
th,td{text-align:left;padding:9px 10px;border-bottom:1px solid var(--line)}
thead th{font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);font-weight:600}
tbody tr:last-child td{border-bottom:0}
.num{text-align:right;font-variant-numeric:tabular-nums}
.muted{color:var(--muted)}
.cfg .muted{font-weight:400;margin-left:6px;font-size:12px}
tr.dead .cfg strong{color:var(--miss)}
tr.pending td{color:var(--muted)}
.pill{display:inline-block;padding:2px 9px;border-radius:999px;font-size:11px;font-weight:600}
.pill.live{background:color-mix(in srgb,var(--met) 16%,transparent);color:var(--met)}
.pill.dead{background:color-mix(in srgb,var(--miss) 16%,transparent);color:var(--miss)}
.pill.pending{background:color-mix(in srgb,var(--pend) 18%,transparent);color:var(--muted)}
.bar{width:38%}
.bar span{display:block;height:8px;border-radius:999px}
.bar .met{background:var(--met)}.bar .miss{background:var(--miss)}
.verdict{font-weight:600;font-size:12px}
.verdict.met{color:var(--met)}.verdict.miss{color:var(--miss)}
.alert{border-left:3px solid var(--miss);background:color-mix(in srgb,var(--miss) 8%,transparent);
padding:10px 14px;border-radius:0 6px 6px 0;margin-bottom:8px}
.note{color:var(--muted);font-size:12px;margin-top:24px;text-align:center}
.empty{color:var(--muted);padding:8px 0}
.badge.finished{background:color-mix(in srgb,var(--accent) 18%,transparent);color:var(--accent)}
.chips{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:16px}
.chip{cursor:pointer;border:1px solid var(--line);background:transparent;color:var(--ink);
padding:5px 12px;border-radius:999px;font:inherit;font-size:12px}
.chip:hover{border-color:var(--accent)}
.chip span{color:var(--muted);margin-left:4px}
table.reasons tr.clickable{cursor:pointer}
table.reasons tr.clickable:hover td{background:color-mix(in srgb,var(--accent) 8%,transparent)}
table.reasons tr.on td{background:color-mix(in srgb,var(--accent) 15%,transparent)}
table.reasons{min-width:0}
td.reason{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;
overflow-wrap:anywhere;word-break:break-word}
.filters{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin-bottom:12px}
.filters input[type=search],.filters select{font:inherit;font-size:13px;padding:7px 10px;
border:1px solid var(--line);border-radius:7px;background:var(--bg);color:var(--ink)}
.filters input[type=search]{flex:1;min-width:200px}
.filters button{font:inherit;font-size:13px;padding:7px 14px;border:1px solid var(--line);
border-radius:7px;background:transparent;color:var(--ink);cursor:pointer}
.filters .check{font-size:13px;color:var(--muted);display:flex;align-items:center;gap:6px}
.count{color:var(--muted);font-size:12px;margin:0 0 12px;font-variant-numeric:tabular-nums}
.list{display:flex;flex-direction:column;gap:8px}
details.item{border:1px solid var(--line);border-radius:8px;overflow:hidden;background:var(--bg)}
details.item summary{cursor:pointer;padding:11px 14px;display:flex;flex-wrap:wrap;gap:10px;
align-items:center;list-style:none}
details.item summary::-webkit-details-marker{display:none}
details.item .meta{color:var(--muted);font-size:12px}
details.item .why{flex-basis:100%;color:var(--muted);font-size:12px;overflow-wrap:anywhere;
font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
details.item[open] summary{border-bottom:1px solid var(--line)}
details.item .body{padding:14px}
details.item h4{font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);
margin:16px 0 6px}
details.item .body>h4:first-child{margin-top:0}
details.item pre{background:color-mix(in srgb,var(--muted) 12%,transparent);padding:12px 14px;
border-radius:6px;overflow-x:auto;font-size:12px;line-height:1.5;margin:0;white-space:pre-wrap;
overflow-wrap:anywhere}
.kv{display:grid;grid-template-columns:auto 1fr auto 1fr;gap:6px 12px;align-items:center;font-size:12px}
.kv span{color:var(--muted)}
.kv code{background:color-mix(in srgb,var(--muted) 14%,transparent);padding:2px 7px;border-radius:4px}
.sbwrap{margin-top:14px}
.sb{display:inline-block;font-size:11px;padding:3px 9px;border-radius:999px;margin:0 6px 6px 0;
font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
.sb.got{background:color-mix(in srgb,var(--met) 16%,transparent);color:var(--met)}
.sb.zero{background:color-mix(in srgb,var(--miss) 14%,transparent);color:var(--miss)}
.small{font-size:11px;margin:14px 0 0}
`;

/**
 * Embedding data in a <script> block ends the block at the first literal `</script`, wherever it
 * appears -- including inside a string the model generated. Escaping `<` closes that hole without
 * touching the value the page reads back.
 */
const embedJson = (value) => JSON.stringify(value)
  .replace(/</g, '\\u003c')
  .replace(/\u2028/g, '\\u2028')
  .replace(/\u2029/g, '\\u2029');

function failuresSection(document) {
  const attempts = Array.isArray(document.attempts) ? document.attempts : [];
  if (attempts.length === 0) {
    return '<div class="panel"><h2>Failures</h2><p class="empty">No attempt records yet.</p></div>';
  }

  const summary = summarizeFailures(attempts);
  if (summary.failing === 0) {
    return `<div class="panel"><h2>Failures</h2><p class="empty">No failing attempts in the
      ${escapeHtml(summary.attempts)} recorded so far.</p></div>`;
  }

  // The reason table is the actionable view: eighty failures are rarely eighty problems.
  const reasonRows = summary.byReason.map((row) => `<tr class="clickable" data-reason="${
    escapeHtml(row.name)}">
      <td class="num">${row.count}</td>
      <td class="num muted">${((row.count / summary.failing) * 100).toFixed(0)}%</td>
      <td class="reason">${escapeHtml(row.name)}</td>
    </tr>`).join('\n');

  const outcomeChips = summary.byOutcome.map((row) => `<button class="chip" data-outcome="${
    escapeHtml(row.name)}">${escapeHtml(row.name)} <span>${row.count}</span></button>`).join('');

  // Attempts are rendered client-side so filtering stays instant over a few thousand rows.
  const payload = attempts.map((attempt) => ({
    ...attempt,
    reason: normalizeReason(attempt),
    failed: hasFailed(attempt),
  }));

  return `
<div class="panel">
  <h2>Why attempts failed — ${escapeHtml(summary.failing)} of ${escapeHtml(summary.attempts)} recorded</h2>
  <div class="chips">${outcomeChips}</div>
  <div class="tw"><table class="reasons"><thead><tr>
    <th class="num">Count</th><th class="num">Share</th><th>Reason (numbers generalised)</th>
  </tr></thead><tbody>${reasonRows}</tbody></table></div>
  <p class="note" style="text-align:left;margin-top:12px">Click a reason or an outcome to filter the
  list below.</p>
</div>

<div class="panel">
  <h2>Failing attempts</h2>
  <div class="filters">
    <input id="q" type="search" placeholder="Search scenario, model, reason, stderr…" autocomplete="off">
    <select id="fOutcome"><option value="">All outcomes</option>${
      summary.byOutcome.map((r) => `<option>${escapeHtml(r.name)}</option>`).join('')}</select>
    <select id="fModel"><option value="">All models</option>${
      summary.byModel.map((r) => `<option>${escapeHtml(r.name)}</option>`).join('')}</select>
    <label class="check"><input type="checkbox" id="fOnlyFailed" checked> Failures only</label>
    <button id="reset" type="button">Reset</button>
  </div>
  <p class="count" id="count"></p>
  <div id="list" class="list"></div>
</div>

<script id="attempts" type="application/json">${embedJson(payload)}</script>
<script>
(function () {
  var DATA = JSON.parse(document.getElementById('attempts').textContent);
  var list = document.getElementById('list');
  var count = document.getElementById('count');
  var q = document.getElementById('q');
  var fOutcome = document.getElementById('fOutcome');
  var fModel = document.getElementById('fModel');
  var fOnlyFailed = document.getElementById('fOnlyFailed');
  var reasonFilter = '';

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function matches(a) {
    if (fOnlyFailed.checked && !a.failed) return false;
    if (reasonFilter && a.reason !== reasonFilter) return false;
    if (fOutcome.value && a.executionOutcome !== fOutcome.value) return false;
    if (fModel.value && a.model !== fModel.value) return false;
    var term = q.value.trim().toLowerCase();
    if (!term) return true;
    return [a.scenarioTitle, a.model, a.reason, a.execStderr, a.toolArgs, a.runId, a.scenarioTier]
      .join(' ').toLowerCase().indexOf(term) !== -1;
  }

  function detail(a) {
    var rows = '';
    if (a.scenarioVerdict) {
      rows += '<div class="kv"><span>Expected</span><code>' + esc(a.scenarioVerdict.expected)
        + '</code><span>Actual</span><code>' + esc(a.scenarioVerdict.actual) + '</code></div>';
    }
    if (a.scoreBreakdown) {
      var parts = Object.keys(a.scoreBreakdown).map(function (k) {
        var v = a.scoreBreakdown[k];
        return '<span class="sb ' + (v > 0 ? 'got' : 'zero') + '">' + esc(k) + ' ' + esc(v) + '</span>';
      }).join('');
      rows += '<div class="sbwrap"><h4>Score ' + esc(a.score) + '/' + esc(a.scoreMax) + '</h4>' + parts + '</div>';
    }
    if (a.execStderr) rows += '<h4>Executor stderr</h4><pre>' + esc(a.execStderr) + '</pre>';
    if (a.llmError) rows += '<h4>LLM error</h4><pre>' + esc(a.llmError) + '</pre>';
    if (a.toolArgs) {
      var pretty = a.toolArgs;
      try { pretty = JSON.stringify(JSON.parse(a.toolArgs), null, 2); } catch (e) {}
      rows += '<h4>Tool arguments the model produced</h4><pre>' + esc(pretty) + '</pre>';
    }
    rows += '<p class="muted small">' + esc(a.runId) + ' · ' + esc(a.timestamp)
      + ' · LLM ' + Math.round((a.llmMs || 0) / 1000) + 's · exec ' + esc(a.execMs) + 'ms</p>';
    return rows;
  }

  function render() {
    var shown = DATA.filter(matches);
    count.textContent = shown.length + ' of ' + DATA.length + ' attempts'
      + (reasonFilter ? ' · reason: ' + reasonFilter : '');
    if (!shown.length) { list.innerHTML = '<p class="empty">Nothing matches these filters.</p>'; return; }
    list.innerHTML = shown.map(function (a, i) {
      return '<details class="item' + (a.failed ? '' : ' ok') + '">'
        + '<summary><span class="pill ' + (a.failed ? 'dead' : 'live') + '">'
        + esc(a.executionOutcome) + '</span>'
        + '<strong>' + esc(a.scenarioTitle || ('scenario ' + a.scenarioIndex)) + '</strong>'
        + '<span class="meta">' + esc(a.model) + ' · ' + esc(a.scenarioTier)
        + ' · score ' + esc(a.score) + '</span>'
        + '<span class="why">' + esc(a.reason) + '</span></summary>'
        + '<div class="body">' + detail(a) + '</div></details>';
    }).join('');
  }

  document.querySelectorAll('.reasons tr.clickable').forEach(function (tr) {
    tr.addEventListener('click', function () {
      var value = tr.getAttribute('data-reason');
      reasonFilter = (reasonFilter === value) ? '' : value;
      document.querySelectorAll('.reasons tr').forEach(function (r) { r.classList.remove('on'); });
      if (reasonFilter) tr.classList.add('on');
      render();
    });
  });
  document.querySelectorAll('.chip').forEach(function (chip) {
    chip.addEventListener('click', function () {
      var value = chip.getAttribute('data-outcome');
      fOutcome.value = (fOutcome.value === value) ? '' : value;
      render();
    });
  });
  [q, fOutcome, fModel, fOnlyFailed].forEach(function (el) {
    el.addEventListener('input', render);
    el.addEventListener('change', render);
  });
  document.getElementById('reset').addEventListener('click', function () {
    q.value = ''; fOutcome.value = ''; fModel.value = ''; fOnlyFailed.checked = true;
    reasonFilter = '';
    document.querySelectorAll('.reasons tr').forEach(function (r) { r.classList.remove('on'); });
    render();
  });
  render();
}());
</script>`;
}

function formatStatusHtml(document) {
  const generated = escapeHtml(document.probedAt);
  const head = (bodyHtml, badge, badgeText) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Benchmark status</title><style>${PAGE_CSS}</style></head>
<body><div class="wrap">
<h1><span class="badge ${badge}">${escapeHtml(badgeText)}</span>Content-gen benchmark</h1>
<p class="sub">Read from the box at ${generated}</p>
${bodyHtml}
<p class="note">Snapshot read directly from <code>progress.json</code>, not the five-minute heartbeat.
Double-click the launcher again to refresh.</p>
</div></body></html>`;

  if (document.status === 'unreadable') {
    return head(`<div class="panel"><div class="alert">${
      escapeHtml(document.error || 'agent state could not be read')
    }</div></div>`, 'unreadable', 'unreadable');
  }
  if (document.status !== 'running') {
    return head(`<div class="panel"><p class="empty">No run in flight.${
      document.sourceCommit
        ? ` Last evaluated commit <code>${escapeHtml(document.sourceCommit.slice(0, 8))}</code>.`
        : ''
    }</p></div>`, 'idle', 'idle');
  }
  if (!document.progress) {
    return head('<div class="panel"><p class="empty">Running — no progress written yet. '
      + 'The first attempt has not finished.</p></div>', 'running', 'running');
  }

  const { progress } = document;
  const attempts = progress.attempts || {};
  const performance = progress.performance || {};
  const overall = progress.overall || {};
  const thresholds = overall.thresholds || {};
  const stale = stalenessSeconds(document);

  // Recorded attempts are placed against the CEILING, and the floor is drawn as a marker rather
  // than as the denominator: the run may legitimately stop anywhere between the two.
  const ceiling = Number(attempts.ceiling) || 1;
  const donePercent = Math.max(0, Math.min(100, (Number(attempts.recorded) / ceiling) * 100));
  const floorPercent = Math.max(0, Math.min(100, (Number(attempts.floor) / ceiling) * 100));

  const alerts = (progress.alerts || [])
    .map((alert) => `<div class="alert">${escapeHtml(alert)}</div>`).join('\n');

  return head(`
<div class="panel">
  <h2>Run</h2>
  <div class="stats">
    <div class="stat"><div class="k">Attempts recorded</div>
      <div class="v">${escapeHtml(attempts.recorded)}</div>
      <div class="n">floor ${escapeHtml(attempts.floor)} · ceiling ${escapeHtml(attempts.ceiling)}</div></div>
    <div class="stat"><div class="k">Elapsed</div>
      <div class="v">${escapeHtml(hours(progress.elapsedMs || 0))}</div>
      <div class="n">${escapeHtml(performance.attemptsPerHour)} attempts/h</div></div>
    <div class="stat"><div class="k">Estimated remaining</div>
      <div class="v">${escapeHtml(hours(performance.etaFloorMs || 0))}–${escapeHtml(hours(performance.etaCeilingMs || 0))}</div>
      <div class="n">median LLM ${Math.round((performance.medianLlmMs || 0) / 1000)}s</div></div>
    <div class="stat"><div class="k">Progress written</div>
      <div class="v">${stale === null ? '?' : `${escapeHtml(stale)}s ago`}</div>
      <div class="n">rewritten every attempt</div></div>
  </div>
  <div class="range">
    <div class="track"><span class="done" style="width:${donePercent.toFixed(1)}%"></span>
      <span class="floor" style="left:${floorPercent.toFixed(1)}%"></span></div>
    <div class="rlabels"><span>0</span>
      <span>floor ${escapeHtml(attempts.floor)} · ceiling ${escapeHtml(attempts.ceiling)}</span></div>
  </div>
</div>

<div class="panel">
  <h2>Overall against the qualification bars</h2>
  <div class="tw"><table><thead><tr><th>Measure</th><th class="num">Now</th><th class="num">Bar</th>
    <th></th><th></th></tr></thead><tbody>
    ${meterRow('Tool-call rate', overall.toolCallRate, thresholds.toolCallRate)}
    ${meterRow('Scenario verdict rate', overall.scenarioVerdictRate, thresholds.scenarioVerdictRate)}
    ${meterRow('Average score', overall.averageScore, thresholds.averageScore)}
  </tbody></table></div>
  <p class="note" style="text-align:left;margin-top:14px">These averages cover only the
  configurations that have run. They are not matrix health while any row below reads
  &ldquo;not started&rdquo;.</p>
</div>

<div class="panel">
  <h2>Per configuration</h2>
  <div class="tw"><table><thead><tr><th>Model</th><th class="num">Attempts</th><th class="num">Passes</th>
    <th class="num">Tool</th><th class="num">Verdict</th><th class="num">Score</th>
    <th>State</th></tr></thead><tbody>
    ${(progress.configurations || []).map(configurationRow).join('\n')}
  </tbody></table></div>
</div>

${alerts ? `<div class="panel"><h2>Alerts</h2>${alerts}</div>` : ''}
${failuresSection(document)}
`, document.live === false ? 'finished' : 'running', document.live === false ? 'finished run' : 'running');
}

module.exports = {
  PROBE_SOURCE,
  STATUS_SCHEMA_VERSION,
  formatStatusHtml,
  formatStatusText,
  normalizeReason,
  qualificationLabel,
  stalenessSeconds,
  summarizeFailures,
};
