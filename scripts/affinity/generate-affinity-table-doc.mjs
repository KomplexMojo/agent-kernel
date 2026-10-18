// #352 — writes docs/affinity-table.md from core's one affinity table. A drift test
// (tests/core-ts/affinity-table.test.mts) fails when the two disagree.
// Usage: node scripts/affinity/generate-affinity-table-doc.mjs
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  AFFINITY_FORMULAS,
  AFFINITY_RECEIVER_RULES,
  AFFINITY_TABLE,
} from "../../packages/core-ts/src/state/affinity-table.ts";

export const AFFINITY_TABLE_DOC_PATH = fileURLToPath(new URL("../../docs/affinity-table.md", import.meta.url));

const INWARD = { drain: "steal into the source", neutralize: "neutralize" };

export function renderAffinityTableDoc() {
  const lines = [
    "# Affinity table",
    "",
    "<!-- Generated from packages/core-ts/src/state/affinity-table.ts by",
    "     node scripts/affinity/generate-affinity-table-doc.mjs. Do not edit by hand. -->",
    "",
    "Every affinity kind's effect on a receiver, as core holds it (#352). Outward is push and emit;",
    "inward is pull and draw. Spill is where outward damage goes once the primary vital is empty:",
    "the receiver's defeat vital (health for delvers and wardens, durability for hazards, resources",
    "and barriers). A receiver without the primary vital takes the whole hit there (#353).",
    "",
    "| Kind | Primary vital | Outward (emit / push) | Inward (draw / pull) | Spill |",
    "|---|---|---|---|---|",
    ...AFFINITY_TABLE.map((row) => `| ${row.kind} | ${row.primaryVital} | ${row.outward} | ${INWARD[row.inward]} | ${row.spill === "defeat" ? "defeat vital" : "none"} |`),
    "",
    "## Receiver rules",
    "",
    "The same for fields and casts:",
    "",
    `- A same-kind \`${AFFINITY_RECEIVER_RULES.absorbedBy}\` on the receiver absorbs an incoming ${AFFINITY_RECEIVER_RULES.absorbs.join(" or ")} into its mana.`,
    `- A same-kind slot is immune where the ${AFFINITY_RECEIVER_RULES.sameKindImmunity} says so.`,
    `- Any opposite slot multiplies ${AFFINITY_RECEIVER_RULES.amplifies.join(" and ")} by ${AFFINITY_RECEIVER_RULES.oppositeAmplification}.`,
    "",
    "## Formulas",
    "",
    "Every row names one formula per stack-driven quantity. Token prices are the Allocator's.",
    "",
    "| Id | Quantity | Formula | Computed in |",
    "|---|---|---|---|",
    ...Object.entries(AFFINITY_FORMULAS).map(([id, entry]) => `| \`${id}\` | ${entry.quantity} | ${entry.formula} | ${entry.source} |`),
    "",
  ];
  return lines.join("\n");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  writeFileSync(AFFINITY_TABLE_DOC_PATH, renderAffinityTableDoc());
  console.log(`wrote ${AFFINITY_TABLE_DOC_PATH}`);
}
