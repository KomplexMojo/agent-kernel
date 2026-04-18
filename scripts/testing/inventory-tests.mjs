import { resolve } from "node:path";
import { collectTestInventory, LOCAL_CODEX_DIR, writeJson } from "./shared.mjs";

const outputPath = process.argv[2]
  ? resolve(process.argv[2])
  : resolve(LOCAL_CODEX_DIR, "test-inventory.json");

const inventory = collectTestInventory();
writeJson(outputPath, inventory);
console.log(JSON.stringify({
  ok: true,
  outputPath,
  summary: inventory.summary,
}, null, 2));
