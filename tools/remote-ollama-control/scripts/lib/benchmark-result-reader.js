'use strict';

const { execFileSync } = require('child_process');
const path = require('path');

const { loadScenarioCatalog } = require('./ak-scenarios');
const { buildContentGenMatrix } = require('./benchmark');
const { loadConfig } = require('./config');
const { loadExecutionCatalog } = require('./execution-catalog');

const RESULT_SCHEMA_VERSION = 'agent-kernel-benchmark-result/v2';
const LEGACY_RESULT_SCHEMA_VERSION = 'agent-kernel-benchmark-result/v1';
const RESULT_PATHS = Object.freeze({
  latest_attempt: 'latest.json',
  latest_success: 'latest-success.json',
});
const CANONICAL_COUNT_PATTERN = /Canonical content-gen scenario count:\s*(\d+)\s*\(source:\s*`loadScenarioCatalog\(\)`\)/g;

function assertSha256(value, label) {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) {
    throw new Error(`${label} must be a lowercase SHA-256`);
  }
}

function currentBenchmarkIdentity(rootDir = path.resolve(__dirname, '..', '..')) {
  const scenarioSet = loadScenarioCatalog(path.join(rootDir, 'benchmarks', 'content-gen'));
  const matrix = buildContentGenMatrix(loadConfig(rootDir), { scenarioCount: scenarioSet.count });
  const execution = loadExecutionCatalog(path.join(rootDir, 'benchmarks', 'execution'));
  return {
    scenarioSet: { count: scenarioSet.count, sha256: scenarioSet.sha256 },
    matrix: { sha256: matrix.sha256 },
    execution: {
      executionSuiteHash: execution.sha256,
      evaluatorVersion: execution.evaluatorVersion,
      seedSetHash: execution.seedSetHash,
      tickProfileHash: execution.tickProfileHash,
    },
  };
}

function validatePublishedBenchmarkResult(record, expectedIdentity) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    throw new Error('published benchmark result must be an object');
  }
  if (![RESULT_SCHEMA_VERSION, LEGACY_RESULT_SCHEMA_VERSION].includes(record.schemaVersion)) {
    throw new Error(`unsupported published benchmark schema: ${record.schemaVersion || 'missing'}`);
  }
  if (!record.run || typeof record.run.id !== 'string' || record.run.id === ''
    || !['completed', 'infrastructure_error'].includes(record.run.status)) {
    throw new Error('published benchmark result has an invalid run status');
  }
  if (typeof record.qualifies !== 'boolean') {
    throw new Error('published benchmark result has an invalid qualification verdict');
  }
  if (!Number.isInteger(record.scenarioSet?.count) || record.scenarioSet.count <= 0) {
    throw new Error('published benchmark result has an invalid scenario count');
  }
  assertSha256(record.scenarioSet.sha256, 'published scenario-set hash');
  assertSha256(record.matrix?.sha256, 'published matrix hash');
  if (record.schemaVersion === LEGACY_RESULT_SCHEMA_VERSION) return record;
  assertSha256(record.execution?.identity?.executionSuiteHash, 'published execution-suite hash');

  if (expectedIdentity) {
    if (record.scenarioSet.count !== expectedIdentity.scenarioSet.count) {
      throw new Error(`published scenario count mismatch: expected ${expectedIdentity.scenarioSet.count}, received ${record.scenarioSet.count}`);
    }
    if (record.scenarioSet.sha256 !== expectedIdentity.scenarioSet.sha256) {
      throw new Error('published scenario-set hash mismatch');
    }
    if (record.matrix.sha256 !== expectedIdentity.matrix.sha256) {
      throw new Error('published matrix hash mismatch');
    }
    if (record.execution.identity.executionSuiteHash !== expectedIdentity.execution?.executionSuiteHash) {
      throw new Error('published execution-suite hash mismatch');
    }
  }
  return record;
}

function compatibilityFor(record) {
  if (record.schemaVersion === LEGACY_RESULT_SCHEMA_VERSION) {
    return {
      status: 'historical_incomparable',
      reasons: ['legacy v1 predates required execution identity and cannot be compared with current qualification evidence'],
    };
  }
  return { status: 'comparable', reasons: [] };
}

function resultPath(selection) {
  const selected = selection || 'latest_attempt';
  const filePath = RESULT_PATHS[selected];
  if (!filePath) throw new Error(`unknown benchmark result selection: ${selected}`);
  return filePath;
}

function readPublishedBenchmarkResult({
  repoRoot,
  ref = 'origin/benchmark-results',
  selection = 'latest_attempt',
  expectedIdentity,
}) {
  if (!repoRoot) throw new Error('repoRoot is required');
  const filePath = resultPath(selection);
  try {
    execFileSync('git', ['-C', repoRoot, 'rev-parse', '--verify', ref], {
      stdio: ['ignore', 'ignore', 'ignore'],
    });
  } catch {
    throw new Error(`published benchmark ref is unavailable: ${ref}`);
  }
  let text;
  try {
    text = execFileSync('git', ['-C', repoRoot, 'show', `${ref}:${filePath}`], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    if (selection === 'latest_success') {
      const pathExists = execFileSync('git', ['-C', repoRoot, 'ls-tree', '--name-only', ref, '--', filePath], {
        encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
      }).trim() === filePath;
      if (!pathExists) {
        return { selection, ref, filePath, record: null,
          compatibility: { status: 'no_qualifying_evidence', reasons: ['latest-success.json does not exist'] } };
      }
    }
    throw new Error(`published benchmark ${selection} is unavailable at ${ref}:${filePath}`);
  }
  let record;
  try {
    record = JSON.parse(text);
  } catch (error) {
    throw new Error(`published benchmark ${selection} is not valid JSON: ${error.message}`);
  }
  validatePublishedBenchmarkResult(record, expectedIdentity);
  if (selection === 'latest_success' && (record.run.status !== 'completed' || record.qualifies !== true)) {
    throw new Error('latest-success.json must contain a completed qualifying result');
  }
  return { selection, ref, filePath, record, compatibility: compatibilityFor(record) };
}

function validateCanonicalScenarioCountDocumentation(text, expectedCount, label = 'document') {
  const matches = [...text.matchAll(CANONICAL_COUNT_PATTERN)];
  if (matches.length !== 1) {
    throw new Error(`${label} must contain exactly one canonical content-gen scenario-count declaration`);
  }
  const documentedCount = Number(matches[0][1]);
  if (documentedCount !== expectedCount) {
    throw new Error(`${label} has stale canonical scenario count ${documentedCount}; catalog has ${expectedCount}`);
  }
  return documentedCount;
}

module.exports = {
  RESULT_SCHEMA_VERSION,
  LEGACY_RESULT_SCHEMA_VERSION,
  currentBenchmarkIdentity,
  readPublishedBenchmarkResult,
  resultPath,
  validateCanonicalScenarioCountDocumentation,
  validatePublishedBenchmarkResult,
};
