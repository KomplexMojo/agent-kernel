const assert = require("node:assert/strict");
const { existsSync, readFileSync, readdirSync, statSync } = require("node:fs");
const { extname, isAbsolute, join, relative, resolve, sep } = require("node:path");

const ROOT = resolve(__dirname, "../..");
const SOURCE_EXTENSIONS = new Set([".cjs", ".js", ".jsx", ".mjs", ".mts", ".ts", ".tsx"]);
const SKIPPED_DIRECTORIES = new Set(["dist", "node_modules"]);

// Match top-level numeric constant declarations whose names identify economy
// prices or budget splits. The semantic name filter avoids sweeping in
// unrelated gameplay values such as mana costs or walkable-density targets.
const PRICE_OR_BUDGET_CONSTANT = new RegExp(
  String.raw`^(?:export\s+)?const\s+(?=[\w$]*(?:price|(?:room|resource|layout|design|actor|vital|regen|stack)[\w$]*cost|budget[\w$]*(?:token|split|pool|pct|ratio)|(?:dungeon|delver)[\w$]*pct|(?:delver|warden)[\w$]*ratio|pool[\w$]*weight|sub[\w$]*pool|reference[\w$]*target|default_?pools?|resource[\w$]*permanent[\w$]*multiplier))[\w$]+\s*=\s*(?:-?(?:\d[\d_]*(?:\.[\d_]*)?|\.\d+)(?:e[+-]?\d+)?\b|(?:Object\.freeze\s*\(\s*)?[\[{][^;]*?\b-?(?:\d[\d_]*(?:\.[\d_]*)?|\.\d+)(?:e[+-]?\d+)?\b)`,
  "gim",
);

const SINGLE_ORIGIN_GUARDS = [
  {
    concept: "EffectKind",
    canonicalHome: "packages/core-ts/src/ports/effects.ts",
    forbiddenPattern: /\b(?:enum|const)\s+EffectKind\b/g,
    scope: "packages",
  },
  {
    concept: "price/budget-split numeric constants",
    canonicalHome: [
      "packages/runtime/src/personas/allocator/base-costs.json",
      "packages/runtime/src/personas/allocator",
    ],
    forbiddenPattern: PRICE_OR_BUDGET_CONSTANT,
    scope: "packages/runtime/src",
  },
];

const SKIPPED_CONCEPTS = new Set([
  // PX.1: Keep skipped until the diff that removes the duplicate EffectKind declaration un-skips it.
  "EffectKind",
  // CR.1: Keep skipped until the diff that moves price/budget splits into Allocator un-skips it.
  "price/budget-split numeric constants",
]);

function toRepoPath(path) {
  return relative(ROOT, path).split(sep).join("/");
}

function isInside(path, directory) {
  const pathFromDirectory = relative(directory, path);
  return pathFromDirectory === "" || (!pathFromDirectory.startsWith(`..${sep}`) && !isAbsolute(pathFromDirectory));
}

function collectSourceFiles(directory, files = new Set()) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRECTORIES.has(entry.name)) collectSourceFiles(path, files);
    } else if (entry.isFile() && SOURCE_EXTENSIONS.has(extname(entry.name))) {
      files.add(path);
    }
  }
  return files;
}

function maskCommentsAndStrings(source) {
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
        masked += "  ";
        index += 1;
      } else {
        masked += character === "\n" ? "\n" : " ";
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
      masked += " ";
    } else {
      masked += character;
    }
  }

  return masked;
}

function asList(value) {
  return Array.isArray(value) ? value : [value];
}

function isCanonicalFile(file, canonicalHome) {
  return asList(canonicalHome).some((home) => {
    const canonicalPath = resolve(ROOT, home);
    if (existsSync(canonicalPath) && statSync(canonicalPath).isDirectory()) {
      return isInside(file, canonicalPath);
    }
    return file === canonicalPath;
  });
}

function lineNumberAt(source, index) {
  return source.slice(0, index).split(/\r?\n/).length;
}

function scanGuard({ canonicalHome, forbiddenPattern, scope }) {
  const files = new Set();
  for (const scopedPath of asList(scope)) {
    collectSourceFiles(resolve(ROOT, scopedPath), files);
  }

  const violations = [];
  for (const file of [...files].sort()) {
    if (isCanonicalFile(file, canonicalHome)) continue;

    const source = maskCommentsAndStrings(readFileSync(file, "utf8"));
    const flags = forbiddenPattern.flags.includes("g")
      ? forbiddenPattern.flags
      : `${forbiddenPattern.flags}g`;
    const matcher = new RegExp(forbiddenPattern.source, flags);

    for (const match of source.matchAll(matcher)) {
      violations.push(`${toRepoPath(file)}:${lineNumberAt(source, match.index)}`);
    }
  }

  return violations;
}

for (const guard of SINGLE_ORIGIN_GUARDS) {
  const registerTest = SKIPPED_CONCEPTS.has(guard.concept) ? test.skip : test;
  registerTest(`${guard.concept} is declared only in its canonical home`, () => {
    const violations = scanGuard(guard);
    assert.equal(
      violations.length,
      0,
      `${guard.concept} declaration(s) outside ${asList(guard.canonicalHome).join(" or ")}:\n`
        + violations.map((violation) => `  ${violation}`).join("\n"),
    );
  });
}
