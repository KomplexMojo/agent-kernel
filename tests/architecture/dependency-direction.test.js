const assert = require("node:assert/strict");
const { existsSync, readFileSync, readdirSync, realpathSync, statSync } = require("node:fs");
const { dirname, extname, isAbsolute, join, relative, resolve, sep } = require("node:path");

const ROOT = resolve(__dirname, "../..");
const PACKAGES_ROOT = resolve(ROOT, "packages");
const CORE_ROOT = resolve(PACKAGES_ROOT, "core-ts/src");
const RUNTIME_ROOT = resolve(PACKAGES_ROOT, "runtime/src");

const SOURCE_EXTENSIONS = new Set([".cjs", ".js", ".jsx", ".mjs", ".mts", ".ts", ".tsx"]);
const SKIPPED_DIRECTORIES = new Set(["dist", "node_modules"]);
const FORBIDDEN_RUNTIME_DEPENDENCIES = new Set([
  "adapters-web",
  "adapters-cli",
  "adapters-test",
  "ui-web",
]);
const FORBIDDEN_CORE_IO = [
  { label: "fs", pattern: /\bfs\b/ },
  { label: "fetch(", pattern: /\bfetch\s*\(/ },
  { label: "process.", pattern: /\bprocess\s*\./ },
  { label: "Date.now", pattern: /\bDate\s*\.\s*now\b/ },
  { label: "Math.random", pattern: /\bMath\s*\.\s*random\b/ },
  { label: "localStorage", pattern: /\blocalStorage\b/ },
  { label: "indexedDB", pattern: /\bindexedDB\b/ },
  { label: "require(", pattern: /\brequire\s*\(/ },
];

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

function maskSource(source, { strings }) {
  let masked = "";
  let state = "code";
  let quote = "";

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    const next = source[index + 1];

    if (state === "line-comment") {
      if (character === "\n") {
        masked += "\n";
        state = "code";
      } else {
        masked += " ";
      }
      continue;
    }

    if (state === "block-comment") {
      if (character === "*" && next === "/") {
        masked += "  ";
        index += 1;
        state = "code";
      } else {
        masked += character === "\n" ? "\n" : " ";
      }
      continue;
    }

    if (state === "string") {
      if (character === "\\" && next !== undefined) {
        masked += strings ? "  " : `${character}${next}`;
        index += 1;
      } else {
        masked += strings && character !== "\n" ? " " : character;
        if (character === quote) state = "code";
      }
      continue;
    }

    if (character === "/" && next === "/") {
      masked += "  ";
      index += 1;
      state = "line-comment";
    } else if (character === "/" && next === "*") {
      masked += "  ";
      index += 1;
      state = "block-comment";
    } else if (character === "'" || character === '"' || character === "`") {
      quote = character;
      state = "string";
      masked += strings ? " " : character;
    } else {
      masked += character;
    }
  }

  return masked;
}

function specifierFromStatement(statement) {
  const fromSpecifier = statement.match(/\bfrom\s*["']([^"']+)["']/);
  if (fromSpecifier) return fromSpecifier[1];

  const sideEffectSpecifier = statement.match(/^\s*import\s*["']([^"']+)["']/);
  return sideEffectSpecifier ? sideEffectSpecifier[1] : null;
}

function importSpecifiers(source) {
  const specifiers = [];
  const lines = maskSource(source, { strings: false }).split(/\r?\n/);
  const statementStart = /^\s*(?:import\b(?!\s*\()|export\s+(?:type\s+)?(?:\*|\{))/;

  for (let index = 0; index < lines.length; index += 1) {
    if (!statementStart.test(lines[index])) continue;

    let statement = lines[index];
    let end = index;
    let specifier = specifierFromStatement(statement);

    // Named imports and re-exports can put `from "..."` on a later line. Join
    // continuation lines before matching: the old line-only persona guard hid
    // 16 violations until this exact blind spot was removed.
    while (!specifier && !/;\s*$/.test(statement) && end + 1 < lines.length) {
      end += 1;
      statement += ` ${lines[end]}`;
      specifier = specifierFromStatement(statement);
    }

    if (specifier) specifiers.push(specifier);
    index = end;
  }

  return specifiers;
}

function resolveImportTarget(importingFile, specifier) {
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

function lineNumberAt(source, index) {
  return source.slice(0, index).split(/\r?\n/).length;
}

function formatViolations(heading, violations) {
  return `${heading}\n${violations.map((violation) => `  ${violation}`).join("\n")}`;
}

test("core-ts imports and re-exports resolve only inside core-ts/src", () => {
  const violations = [];
  const coreRealRoot = realpathSync(CORE_ROOT);

  for (const file of collectSourceFiles(CORE_ROOT).sort()) {
    const source = readFileSync(file, "utf8");
    for (const specifier of importSpecifiers(source)) {
      if (!specifier.startsWith(".")) {
        violations.push(`${toRepoPath(file)} -> ${specifier} (bare or absolute specifier)`);
        continue;
      }

      const target = resolveImportTarget(file, specifier);
      if (!target) {
        violations.push(`${toRepoPath(file)} -> ${specifier} (does not resolve)`);
      } else if (!isInside(realpathSync(target), coreRealRoot)) {
        violations.push(`${toRepoPath(file)} -> ${specifier} (escapes packages/core-ts/src)`);
      }
    }
  }

  assert.equal(
    violations.length,
    0,
    formatViolations("core-ts dependency direction violation(s):", violations),
  );
});

test("core-ts source contains no IO, environment, clock, or randomness access", () => {
  const violations = [];

  for (const file of collectSourceFiles(CORE_ROOT).sort()) {
    const source = readFileSync(file, "utf8");
    // Mask comments and literal contents, then use token boundaries plus
    // call/member shapes. This ignores prose and longer identifiers such as
    // `offsets`, while still catching executable references.
    const executableSource = maskSource(source, { strings: true });

    for (const { label, pattern } of FORBIDDEN_CORE_IO) {
      const match = pattern.exec(executableSource);
      if (match) {
        violations.push(`${toRepoPath(file)}:${lineNumberAt(executableSource, match.index)} (${label})`);
      }
    }
  }

  assert.equal(
    violations.length,
    0,
    formatViolations("core-ts purity violation(s):", violations),
  );
});

test("runtime does not import adapter or UI packages", () => {
  const violations = [];

  for (const file of collectSourceFiles(RUNTIME_ROOT).sort()) {
    const source = readFileSync(file, "utf8");
    for (const specifier of importSpecifiers(source)) {
      const dependency = specifier
        .split("/")
        .find((segment) => FORBIDDEN_RUNTIME_DEPENDENCIES.has(segment));
      if (dependency) {
        violations.push(`${toRepoPath(file)} -> ${specifier} (${dependency})`);
      }
    }
  }

  assert.equal(
    violations.length,
    0,
    formatViolations("runtime dependency direction violation(s):", violations),
  );
});
