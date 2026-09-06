const assert = require('node:assert/strict');

const {
  PROBE_SOURCE,
  formatStatusText,
  formatStatusHtml,
} = require('../../tools/remote-ollama-control/scripts/lib/benchmark-status');

const RUNNING = {
  status: 'running',
  probedAt: '2026-09-06T21:00:00.000Z',
  sourceCommit: 'f81428ae02917b9cd57c5ee13c7f4773d5d9afdd',
  runKey: '2b65f4d0',
  error: null,
  progress: {
    generatedAt: '2026-09-06T20:59:30.000Z',
    startedAt: '2026-09-06T17:57:15.304Z',
    elapsedMs: 10_965_000,
    attempts: {
      recorded: 186, floor: 600, ceiling: 1800, remainingFloor: 414, remainingCeiling: 1614,
    },
    overall: {
      attempts: 186,
      toolCallRate: 0.983,
      scenarioVerdictRate: 0.661,
      averageScore: 62.6,
      thresholds: { toolCallRate: 0.99, scenarioVerdictRate: 0.96, averageScore: 75 },
    },
    performance: {
      attemptsPerHour: 64.6, medianLlmMs: 32_000, medianExecMs: 276,
      etaFloorMs: 23_000_000, etaCeilingMs: 90_000_000,
    },
    configurations: [
      {
        configurationId: 'cg-v1--qwen3.5_9b--primary--ctx8192--out4096',
        model: 'qwen3.5:9b', profile: 'primary',
        attempts: 100, passesComplete: 1,
        toolCallRate: 0.99, scenarioVerdictRate: 0.59, averageScore: 62,
        canStillQualify: false,
      },
      {
        configurationId: 'cg-v1--qwen3.8_27b--dual--ctx65536--out32768',
        model: 'qwen3.8:27b', profile: 'dual',
        attempts: 0, passesComplete: 0,
        toolCallRate: 0, scenarioVerdictRate: 0, averageScore: 0,
        canStillQualify: true,
      },
    ],
    alerts: ['cg-v1--qwen3.5_9b--primary--ctx8192--out4096 can no longer qualify: 100 attempt(s).'],
  },
};

const IDLE = {
  status: 'idle', probedAt: '2026-09-06T21:00:00.000Z',
  sourceCommit: null, runKey: null, progress: null, error: null,
};

// The whole point of reading the box directly is that it beats the five-minute beat. A reader that
// did not say how old the file is would leave you unable to tell a live run from a wedged one.
test('the text report states how stale progress.json actually is', () => {
  const text = formatStatusText(RUNNING);
  assert.match(text, /written 30s ago/);
});

// Progress is a floor/ceiling range, never a percentage: early stop means recorded attempts cannot
// predict the remainder. A single "31% complete" would be a fabricated number.
test('progress is reported as a range, never a single percentage', () => {
  const text = formatStatusText(RUNNING);
  assert.match(text, /186/);
  assert.match(text, /600/);
  assert.match(text, /1800/);
  assert.doesNotMatch(text, /\d+%\s*complete/i);
});

// A configuration that can no longer reach the bar is the one thing worth interrupting for.
test('a configuration that can no longer qualify is marked, and untouched ones are not', () => {
  const text = formatStatusText(RUNNING);
  const dead = text.split('\n').find((line) => line.includes('qwen3.5_9b'));
  const untouched = text.split('\n').find((line) => line.includes('qwen3.8_27b'));
  assert.match(dead, /\bNO\b/);
  // Zero attempts is not a verdict: calling it "yes" would read as evidence it is on track.
  assert.doesNotMatch(untouched, /\byes\b/);
});

test('alerts are surfaced verbatim', () => {
  assert.match(formatStatusText(RUNNING), /can no longer qualify/);
});

test('an idle box reports idle rather than an empty table', () => {
  const text = formatStatusText(IDLE);
  assert.match(text, /idle/i);
  assert.doesNotMatch(text, /attempts\s*:/);
});

test('an unreadable agent state is reported, not swallowed into a healthy-looking zero', () => {
  const text = formatStatusText({
    status: 'unreadable', probedAt: '2026-09-06T21:00:00.000Z',
    sourceCommit: null, runKey: null, progress: null, error: 'state.json is corrupt',
  });
  assert.match(text, /state\.json is corrupt/);
});

test('the html page renders the same run and escapes injected markup', () => {
  const hostile = JSON.parse(JSON.stringify(RUNNING));
  hostile.progress.alerts = ['<img src=x onerror=alert(1)>'];
  const html = formatStatusHtml(hostile);
  assert.match(html, /<html/i);
  assert.match(html, /qwen3\.5:9b/);
  assert.doesNotMatch(html, /<img src=x/);
  assert.match(html, /&lt;img src=x/);
});

test('the html page states staleness and the attempt range too', () => {
  const html = formatStatusHtml(RUNNING);
  assert.match(html, /30s ago/);
  assert.match(html, /600/);
  assert.match(html, /1800/);
});

// `~/remote-ollama-control` on the box is an installed FILE COPY, not a checkout: a module added
// to this repo does not exist there until someone reinstalls. A probe that required one would work
// on the author's box and fail on a freshly provisioned one, months later, for a reason nobody
// would connect to this change.
test('the probe requires nothing from the installed package', () => {
  const requires = [...PROBE_SOURCE.matchAll(/require\((['"])(.+?)\1\)/g)].map((m) => m[2]);
  assert.deepEqual([...new Set(requires)].sort(), ['node:fs', 'node:os', 'node:path']);
});

// The run in flight is named by the agent's own state. Picking the newest directory by mtime would
// silently report a FINISHED run's numbers as current once a run ends.
test('the probe resolves the run directory from the agent state run key, not from mtime', () => {
  assert.match(PROBE_SOURCE, /inFlight/);
  assert.match(PROBE_SOURCE, /runKey/);
  assert.doesNotMatch(PROBE_SOURCE, /mtime/);
});

test('the probe emits a single json document on stdout', () => {
  assert.match(PROBE_SOURCE, /JSON\.stringify/);
});

// --- failure inspection -------------------------------------------------------------------

const {
  normalizeReason,
  summarizeFailures,
} = require('../../tools/remote-ollama-control/scripts/lib/benchmark-status');

const attempt = (overrides = {}) => ({
  runId: 'cg--x--s001--r1',
  model: 'qwen3.5:9b',
  scenarioTitle: 'Execution EX-HZ-01',
  scenarioTier: 'simple',
  executionOutcome: 'execution_failed',
  toolCallProduced: true,
  execStderr: null,
  llmError: null,
  scenarioVerdict: { passed: false, expected: 'success', actual: 'execution_failed' },
  ...overrides,
});

// Eighty failures are rarely eighty problems. The same defect carrying different numbers must
// collapse to one row, or the actionable signal is buried under singletons.
test('reasons group across differing numbers in the same message', () => {
  const a = normalizeReason(attempt({
    execStderr: 'could not place hazard: insufficient tiles (0 available, 1 requested)',
  }));
  const b = normalizeReason(attempt({
    execStderr: 'could not place hazard: insufficient tiles (3 available, 12 requested)',
  }));
  assert.equal(a, b);
  assert.match(a, /insufficient tiles \(N available, N requested\)/);
});

// Only the numbers are generalised: a reason nobody can trace back to a real message is not useful.
test('the reason still reads like the message it came from', () => {
  const reason = normalizeReason(attempt({ execStderr: 'Budget receipt denied: status=denied' }));
  assert.match(reason, /Budget receipt denied/);
});

test('multi-line stderr groups on its first line', () => {
  const reason = normalizeReason(attempt({ execStderr: 'level-gen input invalid\n  at Foo\n  at Bar' }));
  assert.equal(reason, 'level-gen input invalid');
});

test('an llm error is distinguished from an executor failure', () => {
  assert.match(normalizeReason(attempt({ llmError: 'context deadline exceeded' })), /^LLM error —/);
});

test('a missing tool call is named rather than reported as an empty reason', () => {
  assert.equal(
    normalizeReason(attempt({ toolCallProduced: false, execStderr: null })),
    'no tool call produced',
  );
});

test('an outcome mismatch with no stderr still yields a reason', () => {
  assert.match(
    normalizeReason(attempt({
      execStderr: null,
      executionOutcome: 'budget_denied',
      scenarioVerdict: { passed: false, expected: 'success', actual: 'budget_denied' },
    })),
    /expected success, got budget_denied/,
  );
});

// Passing attempts are carried for context but must never inflate the failure counts.
test('only failing attempts are summarized, and reasons are ranked by count', () => {
  const summary = summarizeFailures([
    attempt({ execStderr: 'alpha (1)' }),
    attempt({ execStderr: 'alpha (2)' }),
    attempt({ execStderr: 'beta' }),
    attempt({ scenarioVerdict: { passed: true }, executionOutcome: 'success' }),
  ]);
  assert.equal(summary.attempts, 4);
  assert.equal(summary.failing, 3);
  assert.equal(summary.byReason[0].name, 'alpha (N)');
  assert.equal(summary.byReason[0].count, 2);
});

test('the failures section renders reasons and per-attempt evidence', () => {
  const doc = { ...RUNNING, attempts: [attempt({ execStderr: 'could not place hazard (0, 1)' })] };
  const html = formatStatusHtml(doc);
  assert.match(html, /Why attempts failed/);
  assert.match(html, /could not place hazard/);
  assert.match(html, /Execution EX-HZ-01/);
});

// The embedded payload sits inside a <script> block, which ends at the first literal `</script`
// wherever it occurs -- including inside model-generated tool arguments.
test('embedded attempt data cannot break out of its script block', () => {
  const doc = {
    ...RUNNING,
    attempts: [attempt({ toolArgs: '{"note":"</script><img src=x onerror=alert(1)>"}' })],
  };
  const html = formatStatusHtml(doc);
  assert.doesNotMatch(html, /<\/script><img/);
  assert.match(html, /\\u003c\/script/);
});

test('a run that is no longer live is labelled finished, never as the current run', () => {
  const html = formatStatusHtml({ ...RUNNING, live: false });
  assert.match(html, /finished run/);
  assert.doesNotMatch(html, /badge running/);
});
