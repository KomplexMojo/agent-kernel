const assert = require('node:assert/strict');
const { resolve } = require('node:path');
const ts = require('typescript');

// TypeScript checks the fixture: valid examples must compile and every rejected
// shape must actually produce an error. Unused @ts-expect-error fails the test.
test('unified actor boundary accepts shared records and rejects split state and invalid actions', () => {
  const fixture = resolve(__dirname, '../fixtures/contracts/unified-actor-contract.ts');
  const program = ts.createProgram([fixture], {
    strict: true, noEmit: true, types: [],
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    allowImportingTsExtensions: true,
  });
  const diagnostics = ts.getPreEmitDiagnostics(program).map((d) => {
    const location = d.file && d.start !== undefined
      ? `${d.file.fileName}:${d.file.getLineAndCharacterOfPosition(d.start).line + 1}: ` : '';
    return location + ts.flattenDiagnosticMessageText(d.messageText, '\n');
  });
  assert.deepEqual(diagnostics, []);
});



test('file-backed unified actor artifacts enforce inventory and defeat invariants', async () => {
  const { readFileSync } = require('node:fs');
  const { createActorRegistry } = await import('../../packages/core-ts/src/state/actor-registry.ts');
  const { INITIAL_STATE_SCHEMA } = await import('../../packages/runtime/src/contracts/artifacts.ts');
  const read = name => JSON.parse(readFileSync(resolve(__dirname, '../fixtures/artifacts', name), 'utf8'));
  const load = artifact => createActorRegistry({ dimensions: { width: 3, height: 3 },
    terrain: Array(9).fill('floor'), actors: artifact.actors });
  const valid = read('initial-state-artifact-v1-unified.json');
  assert.equal(valid.schema, INITIAL_STATE_SCHEMA);
  assert.equal(valid.schemaVersion, 1);
  assert.deepEqual(load(valid).snapshot().actors, valid.actors);
  for (const [label, error] of [['active-key', /invalid active affinity key/],
    ['duplicate-pair', /duplicate affinity pair/], ['defeat-vital', /defeat vital/]]) {
    const fixture = read(`invalid/initial-state-artifact-v1-unified-${label}.json`);
    assert.equal(fixture.schema, INITIAL_STATE_SCHEMA);
    assert.throws(() => load(fixture), error, label);
  }
});

// ## TODO: Test Permutations
// - CLI/MCP startup must reject these same fixtures through its normalized loader.
