import { collectTestInventory } from "./shared.mjs";

const browserFiles = collectTestInventory().files.filter((entry) => entry.runner === "playwright");

console.log(JSON.stringify({
  ok: true,
  count: browserFiles.length,
  files: browserFiles,
}, null, 2));
