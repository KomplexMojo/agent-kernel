import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { collectTestInventory, ROOT } from "./shared.mjs";

const candidates = collectTestInventory().files
  .filter((entry) => entry.runner === "playwright")
  .map((entry) => {
    const source = readFileSync(resolve(ROOT, entry.path), "utf8");
    const usesPlaywrightCli = source.includes("playwright-cli");
    return {
      path: entry.path,
      usesPlaywrightCli,
      reason: usesPlaywrightCli ? "manual_cli_session_flow" : "already_native_or_non_cli_browser_test",
    };
  });

console.log(JSON.stringify({
  ok: true,
  candidateCount: candidates.length,
  manualReviewCount: candidates.filter((entry) => entry.usesPlaywrightCli).length,
  candidates,
}, null, 2));
