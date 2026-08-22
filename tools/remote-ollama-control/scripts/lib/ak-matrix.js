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
  thresholds
}) {
  const records = [];
  const maximumPasses = matrix.repeatPolicy.maximumPasses;
  for (const configuration of matrix.configurations) {
    await beforeConfiguration(configuration);
    const configurationRecords = [];
    for (let repeat = 1; repeat <= maximumPasses; repeat += 1) {
      for (const scenario of scenarios) {
        const runId = [
          'cg', configuration.configurationId,
          `s${String(scenario.index).padStart(3, '0')}`, `r${repeat}`
        ].join('--');
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
