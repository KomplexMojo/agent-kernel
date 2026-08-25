'use strict';

// Checkpointing for run-content-gen.
//
// A content-gen run is hours long and, until this module existed, entirely disposable: the result
// directory carried no record of WHAT was being run until the final result.json was written, so a
// run that was interrupted left attempts on disk with nothing to say which catalog or matrix had
// produced them. Resuming meant re-running everything, or hand-assembling evidence from separate
// directories and hoping the inputs matched.
//
// The manifest is written before the first attempt, so an interrupted run is still self-describing.
// Resume then requires the identity to match exactly — merging attempts from two different catalogs
// into one result.json would produce a number nobody could interpret, which is worse than re-running.

const fs = require('fs');
const path = require('path');
const { runnerIdentity } = require('./runner-identity');

const MANIFEST_SCHEMA = 'agent-kernel-content-gen-run-manifest/v1';
const MANIFEST_NAME = 'run-manifest.json';

function manifestPath(resultDir) {
  return path.join(resultDir, MANIFEST_NAME);
}

function writeRunManifest(resultDir, { route, scenarioSet, matrix, scenarioIds, startedAt, diagnostic, authoringPolicy, runner }) {
  fs.mkdirSync(resultDir, { recursive: true });
  const manifest = {
    schemaVersion: MANIFEST_SCHEMA,
    startedAt: startedAt || new Date().toISOString(),
    route: route || null,
    // Explicitly false rather than absent: a reader six weeks from now must be able to tell
    // 'this was a qualification run' from 'this field did not exist yet'.
    diagnostic: diagnostic === true,
    scenarioSet,
    matrix,
    // What the model was TOLD, which no pinned identity hash covered. scenarioSetHash covers the
    // questions, matrixHash the configurations, executionSuiteHash the evaluation -- and the
    // instructions sat outside all three, so adding the price brief on 2026-08-24 changed what was
    // measured while every pinned hash held still.
    authoringPolicy: authoringPolicy || null,
    // WHICH MACHINE answered. The three fields above pin what the model was asked; this pins what
    // did the asking, and it is identity-bearing for the same reason: an Apple unified-memory GPU
    // and a dual-AMD box are not one measurement. It was unrecorded while only one machine existed,
    // which is exactly when the omission is invisible.
    runner: runner || runnerIdentity(),
    scenarioIds: [...scenarioIds].sort((left, right) => left - right)
  };
  fs.writeFileSync(manifestPath(resultDir), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

function readRunManifest(resultDir) {
  const file = manifestPath(resultDir);
  if (!fs.existsSync(file)) {
    throw new Error(
      `${resultDir} has no ${MANIFEST_NAME}, so there is no record of what it was running. `
      + 'It predates checkpointing, or was not produced by run-content-gen. Start a fresh run.'
    );
  }
  const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (manifest.schemaVersion !== MANIFEST_SCHEMA) {
    throw new Error(`${file} declares ${manifest.schemaVersion}, not ${MANIFEST_SCHEMA}`);
  }
  return manifest;
}

// Refuse anything that would merge incomparable evidence into one result. The failure messages name
// the mismatched field on purpose: "cannot resume" without the reason sends the reader to the code.
function assertResumable(manifest, current) {
  if (manifest.scenarioSet.sha256 !== current.scenarioSet.sha256) {
    throw new Error(
      'cannot resume: the scenario catalog changed since this run started '
      + `(${manifest.scenarioSet.sha256.slice(0, 12)}… → ${current.scenarioSet.sha256.slice(0, 12)}…). `
      + 'Attempts from two catalogs cannot share one result.'
    );
  }
  if (manifest.matrix.sha256 !== current.matrix.sha256) {
    throw new Error(
      'cannot resume: the configuration matrix changed since this run started '
      + `(${manifest.matrix.sha256.slice(0, 12)}… → ${current.matrix.sha256.slice(0, 12)}…).`
    );
  }
  // A run whose attempts were told different things is not one run. This refuses for the same
  // reason as the two above, and names the field for the same reason.
  const priorPolicy = manifest.authoringPolicy;
  const currentPolicy = current.authoringPolicy;
  if (currentPolicy) {
    if (!priorPolicy) {
      throw new Error(
        'cannot resume: this run predates the authoring-policy record, so there is no way to tell '
        + 'whether its attempts were given the same instructions and prices as new ones would be. '
        + 'Start a fresh run.'
      );
    }
    if (priorPolicy.sha256 !== currentPolicy.sha256) {
      const what = priorPolicy.priceBriefSha256 !== currentPolicy.priceBriefSha256
        ? 'the price brief changed' : 'the authoring instructions changed';
      throw new Error(
        `cannot resume: ${what} since this run started `
        + `(${priorPolicy.sha256.slice(0, 12)}… → ${currentPolicy.sha256.slice(0, 12)}…). `
        + 'Attempts told different things cannot share one result.'
      );
    }
  }

  // Resume on a different machine than started the run. Reachable from the day a second runner
  // exists, and silent until then: attempts from two machines would land in one runs.jsonl and be
  // aggregated into a single score for a configuration neither machine actually ran.
  const priorRunner = manifest.runner;
  // Derived here rather than required from the caller. Every other field on `current` describes
  // what was ASKED and only the caller knows it; the machine is ambient, and a guard that fires
  // only when someone remembers to pass an argument is the failure of omission it exists to catch.
  const currentRunner = current.runner || runnerIdentity();
  if (!priorRunner) {
    throw new Error(
      'cannot resume: this run predates the runner record, so there is no way to tell which '
      + 'machine produced its attempts. Start a fresh run.'
    );
  }
  if (priorRunner.id !== currentRunner.id) {
    const describe = (runner) => `${runner.label || runner.id.slice(0, 12)} (${runner.platform}/${runner.arch})`;
    throw new Error(
      `cannot resume: this run was started on ${describe(priorRunner)} and this is `
      + `${describe(currentRunner)}. Attempts from two machines cannot share one result.`
    );
  }

  const known = new Set(manifest.scenarioIds);
  const added = current.scenarioIds.filter((index) => !known.has(index));
  if (added.length > 0) {
    throw new Error(
      `cannot resume: scenario ${added.join(', ')} was not part of the original run. `
      + 'Resume finishes outstanding work; it does not widen the scenario set.'
    );
  }
  const unknownConfigurations = current.matrix.configurationIds
    .filter((id) => !manifest.matrix.configurationIds.includes(id));
  if (unknownConfigurations.length > 0) {
    throw new Error(`cannot resume: configuration ${unknownConfigurations.join(', ')} was not part of the original run.`);
  }
  return true;
}

// A killed process can leave a half-written final line. Treat only parseable lines as evidence:
// a torn record means that attempt did not finish, so resume should run it again.
function readPriorRecords(runsJsonlPath) {
  if (!fs.existsSync(runsJsonlPath)) return [];
  const records = [];
  for (const line of fs.readFileSync(runsJsonlPath, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      records.push(JSON.parse(line));
    } catch {
      // Only the last line can legitimately be torn; anything earlier means a corrupt file,
      // and re-running those attempts is still the safe response.
    }
  }
  return records;
}

function readCompletedRunIds(runsJsonlPath) {
  return new Set(readPriorRecords(runsJsonlPath).map((record) => record.runId).filter(Boolean));
}

function latestResultDir(resultsDir, suffix = '-content-gen') {
  if (!fs.existsSync(resultsDir)) return null;
  const candidates = fs.readdirSync(resultsDir)
    .filter((name) => name.endsWith(suffix))
    .sort();
  return candidates.length > 0 ? path.join(resultsDir, candidates[candidates.length - 1]) : null;
}

module.exports = {
  MANIFEST_NAME,
  MANIFEST_SCHEMA,
  assertResumable,
  latestResultDir,
  readCompletedRunIds,
  readPriorRecords,
  readRunManifest,
  writeRunManifest
};
