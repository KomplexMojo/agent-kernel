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

// ## TODO: Test Permutations
// - Core/Configurator milestones must reject duplicate pairs and absent active keys at runtime.
// - Core milestones must reject invalid numeric vitals/stacks and claimed or living-source takes.
