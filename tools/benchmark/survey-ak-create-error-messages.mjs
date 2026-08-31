#!/usr/bin/env node
// SM0 of error-message-quality-sweep.md: mechanically lists every `throw new Error(...)` site
// reachable from a single `ak_create` call and flags which have zero `${...}` interpolation --
// the entry point for SM1's per-site "is there dropped detail" triage, not the answer to it.
//
// Scope is the ak_create model-facing surface only (see the plan's own §Scope table), not the 468
// throw sites across the whole codebase -- most of those are unreachable from ak_create at all
// (simulation-tick internals, other CLI subcommands like room-plan/llm-plan/narrate).
//
// Function names below are the scope DECISION (which functions constitute "the ak_create surface"),
// not a duplicated line-number range -- boundaries are found by scanning brace depth from each
// function's own declaration, so this stays correct as the file grows or lines shift.
//
// Usage:
//   node tools/benchmark/survey-ak-create-error-messages.mjs [--out <path>]

import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const OUT_DEFAULT = join(REPO_ROOT, "error-message-quality-sweep-worklist.json");

// { file, functions: [...] } scans only those named functions (bracket-depth bounded from their
// declaration). { file, wholeFile: true } scans the entire file -- used where every throw in the
// file is already on the ak_create path (orchestrate-build.js has no other entry point; the
// Configurator/Allocator persona files listed are wholly part of the build/budget resolution create
// invokes).
const SCOPE = [
  {
    file: "packages/adapters-cli/src/cli/ak-impl.mjs",
    functions: [
      "parseOptimizationPriority", "parseOptimizationGoalEntry", "parseOptimizationGoalList",
      "parsePositiveIntStrict", "parseNonNegativeIntStrict", "parseActorAffinityTuple",
      "parseActorAffinities", "parseActorVitals", "parseRoomSpec", "parseRoomSpecs",
      "parseFloorTileSpec", "parseFloorTileSpecs", "parsePlacedHazardVitals", "parseBooleanStrict",
      "parsePlacedHazardSpec", "parsePlacedHazardSpecs", "parseHazardVitalSpec", "parseHazardSpec",
      "parseHazardSpecs", "parseAuthoringHazardSpec", "parseResourceAffinityPayload",
      "parseResourceSpec", "parseResourceSpecs", "parseDelverSpec", "parseDelverSpecs",
      "parseWardenSpec", "parseWardenSpecs", "agentAuthoringCommand", "createCommand",
    ],
  },
  { file: "packages/runtime/src/build/orchestrate-build.js", wholeFile: true },
  { file: "packages/runtime/src/personas/configurator/actor-authoring.js", wholeFile: true },
  { file: "packages/runtime/src/personas/configurator/artifact-builders.js", wholeFile: true },
  { file: "packages/runtime/src/personas/configurator/budget-maximizer.js", wholeFile: true },
  { file: "packages/runtime/src/personas/configurator/affinity-rules.js", wholeFile: true },
  { file: "packages/runtime/src/personas/configurator/state-machine.js", wholeFile: true },
  { file: "packages/runtime/src/personas/configurator/motivation-rules.js", wholeFile: true },
  { file: "packages/runtime/src/personas/allocator/budget-fulfillment.js", wholeFile: true },
  { file: "packages/runtime/src/personas/allocator/state-machine.js", wholeFile: true },
];

function lineAt(text, index) {
  return text.slice(0, index).split("\n").length;
}

// Scans forward from `openIndex` (the index of an opening bracket char) to find the index of its
// matching close, honoring string/template-literal/comment boundaries so a brace inside a string
// doesn't desync the count. Returns -1 if the file ends before the bracket closes (malformed input,
// not expected in a linted source file).
function matchBracket(text, openIndex, openChar, closeChar) {
  let depth = 0;
  let inString = null; // one of ' " ` or null
  let inLineComment = false;
  let inBlockComment = false;
  let escaped = false;
  for (let i = openIndex; i < text.length; i++) {
    const c = text[i];
    const next = text[i + 1];
    if (inLineComment) {
      if (c === "\n") inLineComment = false;
      continue;
    }
    if (inBlockComment) {
      if (c === "*" && next === "/") { inBlockComment = false; i++; }
      continue;
    }
    if (inString) {
      if (escaped) { escaped = false; continue; }
      if (c === "\\") { escaped = true; continue; }
      if (c === inString) inString = null;
      continue;
    }
    if (c === "/" && next === "/") { inLineComment = true; i++; continue; }
    if (c === "/" && next === "*") { inBlockComment = true; i++; continue; }
    if (c === '"' || c === "'" || c === "`") { inString = c; continue; }
    if (c === openChar) depth++;
    else if (c === closeChar) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function findFunctionRange(text, functionName) {
  const re = new RegExp(`^(?:async\\s+)?function\\s+${functionName}\\s*\\(`, "m");
  const declMatch = re.exec(text);
  if (!declMatch) return null;
  // The parameter list can itself contain `{` (a destructured default, e.g.
  // `function f(a, { x = 1 } = {})`) -- skip past the WHOLE parameter list via paren-matching
  // before looking for the body's opening brace, or that inner `{` gets mistaken for the body.
  const parenOpen = text.indexOf("(", declMatch.index);
  if (parenOpen === -1) return null;
  const parenClose = matchBracket(text, parenOpen, "(", ")");
  if (parenClose === -1) return null;
  const braceOpen = text.indexOf("{", parenClose);
  if (braceOpen === -1) return null;
  const braceClose = matchBracket(text, braceOpen, "{", "}");
  if (braceClose === -1) return null;
  return { start: declMatch.index, end: braceClose };
}

// Extracts the argument expression of `throw new Error(` starting at the character after its `(`,
// via paren-depth scan (string/template-aware) -- robust to multi-line construction, unlike a
// single-line regex.
function extractThrowArg(text, parenOpenIndex) {
  const close = matchBracket(text, parenOpenIndex, "(", ")");
  if (close === -1) return null;
  return { arg: text.slice(parenOpenIndex + 1, close), end: close };
}

function classifyArg(arg) {
  const trimmed = arg.trim();
  const isTemplate = trimmed.startsWith("`") && trimmed.endsWith("`");
  const isPlainString = (trimmed.startsWith('"') && trimmed.endsWith('"'))
    || (trimmed.startsWith("'") && trimmed.endsWith("'"));
  if (isTemplate) {
    // A single, complete template literal (no trailing `+ something` or `,` object arg).
    const inner = trimmed.slice(1, -1);
    // Reject if there's an unescaped backtick inside implying this isn't really one literal --
    // matchBracket already balanced parens, but the arg could still be `a` + `b`.
    if (/`\s*\+/.test(trimmed) || /\+\s*`/.test(trimmed)) {
      return { disposition: "needs-manual-read", message: null };
    }
    return {
      disposition: inner.includes("${") ? "has-interpolation" : "no-interpolation",
      message: inner,
    };
  }
  if (isPlainString) {
    return { disposition: "no-interpolation", message: trimmed.slice(1, -1) };
  }
  return { disposition: "needs-manual-read", message: null };
}

function surveyRange(text, file, rangeStart, rangeEnd, results) {
  const marker = "throw new Error(";
  let searchFrom = rangeStart;
  while (searchFrom < rangeEnd) {
    const idx = text.indexOf(marker, searchFrom);
    if (idx === -1 || idx >= rangeEnd) break;
    const parenOpen = idx + marker.length - 1;
    const extracted = extractThrowArg(text, parenOpen);
    if (!extracted) {
      results.push({
        file, line: lineAt(text, idx), disposition: "needs-manual-read",
        message: null, note: "unterminated throw new Error( -- could not find matching )",
      });
      searchFrom = idx + marker.length;
      continue;
    }
    const { disposition, message } = classifyArg(extracted.arg);
    results.push({ file, line: lineAt(text, idx), disposition, message });
    searchFrom = extracted.end + 1;
  }
}

function main() {
  const results = [];
  for (const entry of SCOPE) {
    const path = join(REPO_ROOT, entry.file);
    const text = readFileSync(path, "utf8");
    if (entry.wholeFile) {
      surveyRange(text, entry.file, 0, text.length, results);
      continue;
    }
    for (const fn of entry.functions) {
      const range = findFunctionRange(text, fn);
      if (!range) {
        results.push({
          file: entry.file, line: null, disposition: "needs-manual-read",
          message: null, note: `function "${fn}" not found -- scope definition is stale, re-check`,
        });
        continue;
      }
      surveyRange(text, entry.file, range.start, range.end, results);
    }
  }

  results.sort((a, b) => (a.file === b.file ? (a.line || 0) - (b.line || 0) : a.file < b.file ? -1 : 1));

  const counts = results.reduce((acc, r) => {
    acc[r.disposition] = (acc[r.disposition] || 0) + 1;
    return acc;
  }, {});

  const outPath = process.argv.includes("--out")
    ? process.argv[process.argv.indexOf("--out") + 1]
    : OUT_DEFAULT;
  writeFileSync(outPath, `${JSON.stringify({ total: results.length, counts, sites: results }, null, 2)}\n`, "utf8");

  console.log(`Surveyed ${results.length} throw sites across ${SCOPE.length} scope entries.`);
  for (const [disposition, count] of Object.entries(counts)) {
    console.log(`  ${disposition}: ${count}`);
  }
  console.log(`Worklist written to ${outPath}`);
}

main();
