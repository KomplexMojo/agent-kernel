const assert = require("node:assert/strict");
const { existsSync, readFileSync, readdirSync, statSync } = require("node:fs");
const { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } = require("node:path");

const ROOT = resolve(__dirname, "../..");
const PACKAGES_ROOT = resolve(ROOT, "packages");
const PERSONAS_ROOT = resolve(PACKAGES_ROOT, "runtime/src/personas");
const ALLOWLIST_PATH = resolve(__dirname, "persona-boundary-allowlist.json");

const PERSONAS = new Set([
  "orchestrator",
  "director",
  "configurator",
  "actor",
  "allocator",
  "annotator",
  "moderator",
]);
const SOURCE_EXTENSIONS = new Set([".js", ".mjs", ".mts", ".ts"]);
// `controller.mts` is gone: the 1-line .mts shims were deleted 2026-08-01 and every
// importer now uses the `persona.js` barrel (or `controller.js` from inside the persona).
const PUBLIC_BASENAMES = new Set(["controller.js", "persona.js", "contracts.ts"]);
const SKIPPED_DIRECTORIES = new Set(["node_modules", "dist"]);

function toRepoPath(path) {
  return relative(ROOT, path).split(sep).join("/");
}

function isInside(path, directory) {
  const pathFromDirectory = relative(directory, path);
  return pathFromDirectory === "" || (!pathFromDirectory.startsWith(`..${sep}`) && !isAbsolute(pathFromDirectory));
}

function collectSourceFiles(directory, files = []) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRECTORIES.has(entry.name)) collectSourceFiles(path, files);
    } else if (entry.isFile() && SOURCE_EXTENSIONS.has(extname(entry.name))) {
      files.push(path);
    }
  }
  return files;
}

function allPackageSourceFiles() {
  const files = [];
  for (const entry of readdirSync(PACKAGES_ROOT, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const sourceRoot = join(PACKAGES_ROOT, entry.name, "src");
    if (existsSync(sourceRoot) && statSync(sourceRoot).isDirectory()) {
      collectSourceFiles(sourceRoot, files);
    }
  }
  return files.sort();
}

function importSpecifiers(source) {
  const specifiers = [];
  const lines = source.split(/\r?\n/);
  const fromSpecifier = /\bfrom\s*["']([^"']+)["']/;
  // Statement forms whose trailing `from "..."` we care about: every `import`,
  // plus re-exports (`export {`, `export *`, `export type {`). This gate
  // deliberately excludes `export function|const|class|default|…` so brace
  // counting below never wanders into a declaration body.
  const importStatement = /^\s*(?:import\b|export\s+(?:type\s+)?[*{])/;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (/^\s*(?:\/\/|\/\*|\*)/.test(line)) continue;

    const requireCall = /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g;
    for (const match of line.matchAll(requireCall)) specifiers.push(match[1]);

    if (!importStatement.test(line)) continue;

    // A named import/export list can wrap across lines, leaving the trailing
    // `from "..."` on the closing-brace line — where the old line-anchored
    // regex could not see it. Collapse continuation lines (an open `{` not yet
    // balanced) into one logical statement before matching the specifier.
    let statement = line;
    let end = i;
    while (
      !fromSpecifier.test(statement) &&
      (statement.match(/\{/g) || []).length > (statement.match(/\}/g) || []).length &&
      end + 1 < lines.length
    ) {
      end += 1;
      statement += ` ${lines[end]}`;
    }

    const staticImport = statement.match(fromSpecifier);
    if (staticImport) specifiers.push(staticImport[1]);
    i = end;
  }
  return specifiers;
}

function resolveImportTarget(importingFile, specifier) {
  if (!specifier.startsWith(".")) return null;

  const unresolved = resolve(dirname(importingFile), specifier);
  const candidates = [unresolved];
  if (extname(unresolved) === "") {
    for (const extension of SOURCE_EXTENSIONS) candidates.push(`${unresolved}${extension}`);
    for (const extension of SOURCE_EXTENSIONS) candidates.push(join(unresolved, `index${extension}`));
  } else if (!existsSync(unresolved) && extname(unresolved) === ".js") {
    candidates.push(`${unresolved.slice(0, -3)}.ts`, `${unresolved.slice(0, -3)}.mts`);
  }

  return candidates.find((candidate) => existsSync(candidate) && statSync(candidate).isFile()) ?? null;
}

function targetPersona(importedFile) {
  if (!isInside(importedFile, PERSONAS_ROOT)) return null;
  const [persona] = relative(PERSONAS_ROOT, importedFile).split(sep);
  return PERSONAS.has(persona) ? persona : null;
}

function scanViolations() {
  const violations = new Map();
  for (const importingFile of allPackageSourceFiles()) {
    const source = readFileSync(importingFile, "utf8");
    for (const specifier of importSpecifiers(source)) {
      const importedFile = resolveImportTarget(importingFile, specifier);
      if (!importedFile) continue;

      const persona = targetPersona(importedFile);
      if (!persona) continue;
      if (isInside(importingFile, join(PERSONAS_ROOT, persona))) continue;
      if (PUBLIC_BASENAMES.has(basename(importedFile))) continue;

      const violation = { from: toRepoPath(importingFile), to: toRepoPath(importedFile) };
      violations.set(`${violation.from}\0${violation.to}`, violation);
    }
  }

  return [...violations.values()].sort((a, b) => {
    if (a.from !== b.from) return a.from < b.from ? -1 : 1;
    if (a.to !== b.to) return a.to < b.to ? -1 : 1;
    return 0;
  });
}

function violationKey({ from, to }) {
  return `${from}\0${to}`;
}

function formatViolations(violations) {
  return violations.map(({ from, to }) => `  ${from} -> ${to}`).join("\n");
}

/**
 * 🟢 THE FLIP — P5.1's stated gate, reached 2026-08-12 when P1.4 emptied the last row.
 *
 * The allowlist recorded the crossings that bypassed a persona's controller: 74 when the
 * target was set, 62, 55, 53, 35, 3, 1, 0. It only ever shrank, and the file still exists —
 * empty — for one reason: **a guard that reads an empty list and a guard that has no list
 * are different guards, and only the first can be re-opened by a one-line JSON edit.** The
 * assertion below refuses a NON-EMPTY allowlist outright, so re-opening the door now takes
 * deleting a test that says why the door is shut.
 *
 * An internal import bypasses the controller, so the persona's FSM never runs — an **A2**
 * violation by definition (charter, "Controller-only boundary"). That is why this is a hard
 * error rather than a budget.
 */
test("the persona boundary allowlist is empty — the guard is a hard error, not a budget", () => {
  const allowlist = JSON.parse(readFileSync(ALLOWLIST_PATH, "utf8"));
  assert.deepEqual(
    allowlist,
    [],
    "The allowlist reached zero on 2026-08-12 and the guard was flipped to a hard error "
      + "(Plan P5.1 / P1.4). Adding an entry here does not make a crossing legal — it makes "
      + "the FSM stop running for that call, which is what A2 forbids. Thread the call "
      + "through the persona's controller, or delete the dependency:\n"
      + formatViolations(allowlist),
  );
});

test("persona modules are imported only through their public boundary", () => {
  const allowlist = JSON.parse(readFileSync(ALLOWLIST_PATH, "utf8"));
  const violations = scanViolations();
  const allowlistedKeys = new Set(allowlist.map(violationKey));
  const violationKeys = new Set(violations.map(violationKey));

  const newViolations = violations.filter((violation) => !allowlistedKeys.has(violationKey(violation)));
  // Kept after the flip, deliberately. With an empty list it can never fire — but the
  // allowlist file is what would come back first if someone reintroduces the budget, and a
  // stale entry is how eight dispositions once went orphaned without a single failing test.
  const staleAllowlist = allowlist.filter((violation) => !violationKeys.has(violationKey(violation)));
  const failures = [];

  if (newViolations.length > 0) {
    failures.push(
      `Persona boundary violation(s) detected — the allowlist is CLOSED (P5.1, 2026-08-12), `
      + `so there is no entry to add:\n${formatViolations(newViolations)}`,
    );
  }
  if (staleAllowlist.length > 0) {
    failures.push(
      `Stale allowlist entries detected; remove entries that are no longer real violations:\n${formatViolations(staleAllowlist)}`,
    );
  }

  assert.equal(failures.length, 0, failures.join("\n\n"));
});
