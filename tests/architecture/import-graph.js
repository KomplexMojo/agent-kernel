/**
 * Static import scanning shared by the framework/game boundary guard (#739).
 *
 * The masking and multi-line statement joining are the same rules as
 * `dependency-direction.test.js` (whose blind spot on continuation lines once hid
 * 16 violations). This module adds dynamic `import("...")` with a literal
 * specifier, because a boundary that only static imports cross is not a boundary.
 */
const { existsSync, readdirSync, statSync } = require("node:fs");
const { dirname, extname, isAbsolute, join, relative, resolve, sep } = require("node:path");

const ROOT = resolve(__dirname, "../..");
const SOURCE_EXTENSIONS = new Set([".cjs", ".js", ".jsx", ".mjs", ".mts", ".ts", ".tsx"]);
const SKIPPED_DIRECTORIES = new Set(["dist", "node_modules"]);

function toRepoPath(path) {
  return relative(ROOT, path).split(sep).join("/");
}

function isInside(path, directory) {
  const fromDirectory = relative(directory, path);
  return fromDirectory === "" || (!fromDirectory.startsWith(`..${sep}`) && !isAbsolute(fromDirectory));
}

function collectSourceFiles(directory, files = []) {
  if (!existsSync(directory)) return files;
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

/** Blank comments (and, with `strings`, literal contents) while keeping offsets and newlines. */
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
  const sideEffect = statement.match(/^\s*import\s*["']([^"']+)["']/);
  return sideEffect ? sideEffect[1] : null;
}

/** Every static import / re-export specifier, plus dynamic `import("literal")`. */
function importSpecifiers(source) {
  const specifiers = [];
  const code = maskSource(source, { strings: false });
  const lines = code.split(/\r?\n/);
  const statementStart = /^\s*(?:import\b(?!\s*\()|export\s+(?:type\s+)?(?:\*|\{))/;
  for (let index = 0; index < lines.length; index += 1) {
    if (!statementStart.test(lines[index])) continue;
    let statement = lines[index];
    let end = index;
    let specifier = specifierFromStatement(statement);
    while (!specifier && !/;\s*$/.test(statement) && end + 1 < lines.length) {
      end += 1;
      statement += ` ${lines[end]}`;
      specifier = specifierFromStatement(statement);
    }
    if (specifier) specifiers.push(specifier);
    index = end;
  }
  for (const match of code.matchAll(/\bimport\s*\(\s*["'`]([^"'`$]+)["'`]\s*\)/g)) specifiers.push(match[1]);
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

module.exports = {
  ROOT,
  collectSourceFiles,
  importSpecifiers,
  isInside,
  maskSource,
  resolveImportTarget,
  toRepoPath,
};
