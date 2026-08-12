import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { collectTestInventory, ROOT, writeText } from "./shared.mjs";

function rewrite(source) {
  let next = source;
  next = next.replace(/^const test = require\("node:test"\);\n/gm, "");
  next = next.replace(/^const \{([^}]+)\} = require\("node:test"\);\n/gm, "");
  next = next.replace(/^import \{([^}]+)\} from "node:test";\n/gm, "");
  next = next.replace(/^import \{([^}]+)\} from 'node:test';\n/gm, "");
  next = next.replace(/^const \{([^}]+)\} = require\("vitest"\);\n/gm, "");
  next = next.replace(/^import \{([^}]+)\} from "vitest";\n/gm, "");
  next = next.replace(/^import \{([^}]+)\} from 'vitest';\n/gm, "");
  next = next.replace(/test\.before\(/g, "beforeAll(");
  next = next.replace(/test\.after\(/g, "afterAll(");
  return next;
}

const files = (process.argv.length > 2 ? process.argv.slice(2) : collectTestInventory().files.map((entry) => entry.path))
  .map((entry) => resolve(ROOT, entry));

const changed = [];
for (const filePath of files) {
  const source = readFileSync(filePath, "utf8");
  const next = rewrite(source);
  if (next !== source) {
    writeText(filePath, next);
    changed.push(filePath);
  }
}

console.log(JSON.stringify({
  ok: true,
  changedCount: changed.length,
  changedFiles: changed,
}, null, 2));
