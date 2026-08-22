'use strict';

const { canStillQualify } = require('./ak-compare');

function createFixtureAttemptWriter(factory, sink = []) {
  return async (context) => {
    const result = await factory(context);
    sink.push({ ...context, result });
    return result;
  };
}

async function executeContentGenMatrix({
  matrix,
  scenarios,
  runAttempt,
  onRecord = () => {},
  beforeConfiguration = async () => {},
  thresholds,
  // Attempts already on disk from an interrupted run of the SAME catalog and matrix. They are not
  // re-run, they are not re-announced through onRecord (they are already in runs.jsonl), and they
  // are returned with the new ones so aggregation still sees a whole run. Early stop reads them
  // too: a configuration that was already doomed before the interruption must not buy a fresh pass.
  priorRecords = []
}) {
  const records = [];
  const completed = new Set(priorRecords.map((record) => record.runId).filter(Boolean));
  const priorByConfiguration = new Map();
  for (const record of priorRecords) {
    const bucket = priorByConfiguration.get(record.configurationId) || [];
    bucket.push(record);
    priorByConfiguration.set(record.configurationId, bucket);
    records.push(record);
  }
  const maximumPasses = matrix.repeatPolicy.maximumPasses;
  for (const configuration of matrix.configurations) {
    const resumed = priorByConfiguration.get(configuration.configurationId) || [];
    // Setup is demanded by the first attempt that actually runs, never by reaching the
    // configuration. On resume a finished configuration would otherwise reset the remote profile
    // and load its model before discovering it has nothing to do — minutes of GPU time per
    // configuration, and "how many attempts have I recorded?" cannot predict it, because early
    // stop means a complete configuration can hold far fewer records than scenarios x passes.
    let prepared = false;
    const prepare = async () => {
      if (prepared) return;
      prepared = true;
      await beforeConfiguration(configuration);
    };
    const configurationRecords = [...resumed];
    for (let repeat = 1; repeat <= maximumPasses; repeat += 1) {
      for (const scenario of scenarios) {
        const runId = [
          'cg', configuration.configurationId,
          `s${String(scenario.index).padStart(3, '0')}`, `r${repeat}`
        ].join('--');
        if (completed.has(runId)) continue;
        await prepare();
        const attempt = await runAttempt({ configuration, scenario, repeat, runId });
        const actual = attempt.executionOutcome || (attempt.execSucceeded ? 'success' : 'execution_failed');
        const record = {
          ...attempt,
          recordKind: 'content_gen_attempt',
          runId,
          configurationId: configuration.configurationId,
          profile: configuration.profile.id,
          model: configuration.model.id,
          scenarioIndex: scenario.index,
          scenarioTitle: scenario.title,
          scenarioTier: scenario.tier,
          expectedOutcome: scenario.expectedOutcome,
          repeat,
          scenarioVerdict: {
            passed: actual === scenario.expectedOutcome,
            expected: scenario.expectedOutcome,
            actual
          }
        };
        configurationRecords.push(record);
        records.push(record);
        await onRecord(record, records);
        if (record.failureClass === 'infrastructure') {
          throw new Error(`Content-gen infrastructure failure: ${record.llmError || record.execStderr || 'unknown infrastructure error'}`);
        }
      }
      const remainingAttempts = (maximumPasses - repeat) * scenarios.length;
      if (remainingAttempts > 0 && !canStillQualify(configurationRecords, { remainingAttempts, thresholds })) {
        break;
      }
    }
  }
  return records;
}

module.exports = { createFixtureAttemptWriter, executeContentGenMatrix };
