import assert from "node:assert/strict";
import {
  categorizeFailure,
  extractStructuredReport,
} from "../../scripts/testing/structured-test-report.mjs";

test("categorizeFailure assigns first matching category", () => {
  assert.equal(
    categorizeFailure("tests/architecture/foo.test.js\nforbidden upward import"),
    "Dependency Inversion",
  );
  assert.equal(
    categorizeFailure("ports/effects.js executed inline"),
    "Effect Routing",
  );
  assert.equal(
    categorizeFailure("tests/personas/actor/actor-foo.test.js\nadvance() returned wrong state"),
    "Persona FSM Violation",
  );
  assert.equal(
    categorizeFailure("tests/contracts/x.test.js\nschemaVersion mismatch"),
    "Schema Mismatch",
  );
  assert.equal(
    categorizeFailure("context not serializable: class instance"),
    "Serialization",
  );
  assert.equal(
    categorizeFailure("Date.now used in core-ts"),
    "Determinism",
  );
  assert.equal(
    categorizeFailure("tests/fixtures/artifacts/invalid/x.json parse error"),
    "Fixture Corruption",
  );
  assert.equal(categorizeFailure("some unrelated assertion"), "Uncategorized");
});

test("extractStructuredReport maps Vitest JSON into the fast-pass shape", () => {
  const cwd = "/repo";
  const vitestJson = {
    numTotalTests: 3,
    numPassedTests: 1,
    numFailedTests: 2,
    testResults: [
      {
        name: "/repo/tests/personas/allocator/allocator-x.test.js",
        assertionResults: [
          {
            status: "passed",
            fullName: "ok case",
            title: "ok case",
            failureMessages: [],
          },
          {
            status: "failed",
            fullName: "allocator advance() rejects empty payload",
            title: "rejects empty payload",
            failureMessages: [
              "Error: expected idle\n    at Object.<anonymous> (tests/personas/allocator/allocator-x.test.js:10:3)",
            ],
          },
        ],
      },
      {
        name: "/repo/tests/fixtures/roundtrip.test.js",
        assertionResults: [
          {
            status: "failed",
            fullName: "fixture load fails",
            title: "fixture load fails",
            failureMessages: ["Error: fixture parse error\nline2\nline3\nline4\nline5\nline6\nline7"],
          },
        ],
      },
    ],
  };

  const report = extractStructuredReport(vitestJson, cwd);

  assert.equal(report.total, 3);
  assert.equal(report.passed, 1);
  assert.equal(report.failed, 2);
  assert.equal(report.failures.length, 2);

  assert.deepEqual(report.failures[0], {
    test: "allocator advance() rejects empty payload",
    file: "tests/personas/allocator/allocator-x.test.js",
    category: "Persona FSM Violation",
    message:
      "Error: expected idle\n    at Object.<anonymous> (tests/personas/allocator/allocator-x.test.js:10:3)",
  });

  assert.equal(report.failures[1].file, "tests/fixtures/roundtrip.test.js");
  assert.equal(report.failures[1].category, "Fixture Corruption");
  // Message is truncated to 6 lines.
  assert.equal(report.failures[1].message.split("\n").length, 6);
  assert.ok(!report.failures[1].message.includes("line7"));
});

test("extractStructuredReport handles empty / missing testResults", () => {
  assert.deepEqual(extractStructuredReport({}), {
    total: 0,
    passed: 0,
    failed: 0,
    failures: [],
  });
});
