import { describe, test } from "vitest";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { resolve, join } from "node:path";
import { orchestrateBuild } from "../../../packages/runtime/src/build/orchestrate-build.js";

const ROOT = resolve(import.meta.dirname, "../../..");

// The seven personas. Glue may never stamp any of these as an artifact's producer
// unless it actually routed the work through that persona's controller.
const PERSONA_NAMES = [
  "orchestrator",
  "director",
  "configurator",
  "actor",
  "allocator",
  "annotator",
  "moderator",
];

function loadFixture(name) {
  return JSON.parse(readFileSync(resolve(ROOT, `tests/fixtures/artifacts/${name}`), "utf8"));
}

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.(js|mjs)$/.test(entry)) out.push(full);
  }
  return out;
}

describe("build-plane provenance — glue must not impersonate a persona", () => {
  // P3.4 / D1a. The build plane runs NO tick. The Annotator subscribes only to the EMIT and
  // SUMMARIZE tick phases, so it cannot have produced any build artifact. orchestrate-build.js
  // nevertheless stamped the affinity summary `producedBy: "annotator"` — a label the persona
  // never earned. Every sibling artifact in the same function uses the caller's `producedBy`;
  // the affinity summary must too.
  test("affinity summary is stamped with the caller's producedBy, not a persona name", async () => {
    const spec = loadFixture("build-spec-v1-configurator-mixed-rooms-small.json");
    const result = await orchestrateBuild({ spec, producedBy: "cli-build" });

    assert.ok(result.affinitySummary, "fixture must actually produce an affinity summary");
    const producedBy = result.affinitySummary.meta.producedBy;

    assert.notEqual(
      producedBy,
      "annotator",
      "glue must not claim Annotator provenance for a build artifact — builds run no tick",
    );
    assert.equal(
      producedBy,
      "cli-build",
      "affinity summary must carry the caller's producedBy, like every sibling build artifact",
    );
  });

  test("affinity summary provenance follows the caller, proving it is not hardcoded", async () => {
    const spec = loadFixture("build-spec-v1-configurator-mixed-rooms-small.json");
    const result = await orchestrateBuild({ spec, producedBy: "cli-llm-plan" });
    assert.equal(result.affinitySummary.meta.producedBy, "cli-llm-plan");
  });

  // Standing guard for the whole defect class, not just the one site P3.4 fixed.
  // This is the spec's "grep that no glue file stamps a persona name it did not invoke",
  // promoted to an executable assertion so it cannot silently regress.
  test("no build-plane glue hardcodes a persona name as producedBy", () => {
    const offenders = [];
    for (const file of walk(resolve(ROOT, "packages/runtime/src/build"))) {
      const src = readFileSync(file, "utf8");
      src.split("\n").forEach((line, i) => {
        for (const persona of PERSONA_NAMES) {
          // Matches createBuildMeta(spec, "annotator", …) and producedBy: "annotator"
          const stamped =
            new RegExp(`createBuildMeta\\([^,]+,\\s*["']${persona}["']`).test(line) ||
            new RegExp(`producedBy\\s*:\\s*["']${persona}["']`).test(line);
          if (stamped) {
            offenders.push(`${file.replace(ROOT + "/", "")}:${i + 1} -> "${persona}"`);
          }
        }
      });
    }
    assert.deepEqual(
      offenders,
      [],
      `build-plane glue must not stamp persona provenance it did not earn:\n  ${offenders.join("\n  ")}`,
    );
  });
});
