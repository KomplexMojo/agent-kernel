// Drift guard for error-message-quality-sweep.md (SM0-SM3): re-runs the SM0 survey tool against
// today's source and fails if any throw site on the ak_create model-facing surface has no
// interpolated detail UNLESS it is in the allowlist below with a stated reason. Without this, a
// new `throw new Error("static string")` on this surface (or a regression stripping detail from an
// existing one) would sit undetected until the next benchmark run happened to hit it -- the same
// silent-collapse pattern this whole plan exists to close, recurring one function at a time.
//
// The allowlist is not a budget to shrink to zero (contrast persona-boundary-allowlist.json): a
// handful of these throw sites are genuinely internal backstops or already carry detail through a
// helper function the classifier can't see into (formatBudgetReceiptDenial()) or a concatenated
// template literal (`...` + `...`) the classifier can't parse as one interpolated string. Adding an
// entry here is legitimate when the site truly has nothing more to say -- the guard's job is to
// force that judgment to be recorded, not to prevent it.

const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");

const ROOT = resolve(__dirname, "../..");
const ALLOWLIST_PATH = resolve(__dirname, "ak-create-error-detail-allowlist.json");

function siteKey({ file, line }) {
  return `${file}:${line}`;
}

function formatSites(sites) {
  return sites.map((s) => `  ${siteKey(s)}${s.reason ? ` -- ${s.reason}` : ""}`).join("\n");
}

test("every ak_create throw site without interpolation is an explicitly allowlisted, justified exception", async () => {
  const { surveyErrorMessages } = await import(
    "../../tools/benchmark/survey-ak-create-error-messages.mjs"
  );
  const results = surveyErrorMessages({ repoRoot: ROOT });
  const flagged = results.filter((r) => r.disposition !== "has-interpolation");

  const allowlist = JSON.parse(readFileSync(ALLOWLIST_PATH, "utf8"));
  const allowlistedKeys = new Set(allowlist.map(siteKey));
  const flaggedKeys = new Set(flagged.map(siteKey));

  const newSites = flagged.filter((site) => !allowlistedKeys.has(siteKey(site)));
  const staleEntries = allowlist.filter((entry) => !flaggedKeys.has(siteKey(entry)));

  const failures = [];
  if (newSites.length > 0) {
    failures.push(
      `New throw site(s) on the ak_create surface with no interpolated detail -- either add the `
      + `missing detail (the fix this whole plan is about) or, if the site genuinely has nothing `
      + `more to say, add a justified entry to ${ALLOWLIST_PATH}:\n${formatSites(newSites)}`,
    );
  }
  if (staleEntries.length > 0) {
    failures.push(
      `Stale allowlist entries -- these sites no longer match a flagged line (moved, fixed, or `
      + `removed). Update the line number or delete the entry:\n${formatSites(staleEntries)}`,
    );
  }
  assert.equal(failures.length, 0, failures.join("\n\n"));
});
