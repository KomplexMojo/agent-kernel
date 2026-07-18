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
const PUBLIC_BASENAMES = new Set(["controller.js", "controller.mts", "persona.js", "contracts.ts"]);
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
  for (const line of source.split(/\r?\n/)) {
    if (/^\s*(?:\/\/|\/\*|\*)/.test(line)) continue;

    const staticImport = line.match(/^\s*(?:import|export)\b.*?\bfrom\s*["']([^"']+)["']/);
    if (staticImport) specifiers.push(staticImport[1]);

    const requireCall = /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g;
    for (const match of line.matchAll(requireCall)) specifiers.push(match[1]);
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

test("persona modules are imported only through their public boundary", () => {
  const allowlist = JSON.parse(readFileSync(ALLOWLIST_PATH, "utf8"));
  const violations = scanViolations();
  const allowlistedKeys = new Set(allowlist.map(violationKey));
  const violationKeys = new Set(violations.map(violationKey));

  const newViolations = violations.filter((violation) => !allowlistedKeys.has(violationKey(violation)));
  const staleAllowlist = allowlist.filter((violation) => !violationKeys.has(violationKey(violation)));
  const failures = [];

  if (newViolations.length > 0) {
    failures.push(`New persona boundary violation(s) detected:\n${formatViolations(newViolations)}`);
  }
  if (staleAllowlist.length > 0) {
    failures.push(
      `Stale allowlist entries detected; remove entries that are no longer real violations:\n${formatViolations(staleAllowlist)}`,
    );
  }

  assert.equal(failures.length, 0, failures.join("\n\n"));
});
