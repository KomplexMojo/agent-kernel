export const FAILURE_CATEGORIES = Object.freeze([
  "model_transport",
  "model_contract",
  "validation",
  "execution",
  "infrastructure",
  "persistence",
  "cancellation",
  "budget_exhaustion",
]);

const byCategory = {
  cancellation: ["cancelled", "cancellation_requested"],
  model_transport: ["timeout", "model_timeout", "network_error", "transport_error"],
  model_contract: ["invalid_json", "missing_response_text", "missing_summary", "parse_error"],
  budget_exhaustion: ["missing_budget_tokens", "budget_exhausted", "over_budget", "layout_over_budget"],
  persistence: ["write_failed", "read_failed", "persistence_failed"],
  execution: ["cli_exit_nonzero", "execution_failed", "command_failed"],
  infrastructure: ["missing_adapter", "missing_clock", "missing_model", "missing_run_id"],
  validation: ["missing_prompt", "missing_catalog_match", "missing_actors", "missing_layout", "empty_layout", "insufficient_floor_tiles"],
};

const CODE_CATEGORY = Object.freeze(Object.fromEntries(
  Object.entries(byCategory).flatMap(([category, codes]) => codes.map((code) => [code, category])),
));
const NAME_CATEGORY = Object.freeze({ aborterror: "cancellation", cancellationerror: "cancellation", syntaxerror: "model_contract", timeouterror: "model_transport" });

function codeFrom(value) {
  if (!value || typeof value !== "object") return "";
  return typeof value.code === "string" ? value.code : typeof value.name === "string" ? value.name : "";
}

function hasAny(words, values) { return values.some((value) => words.has(value)); }
export function classifyFailure(value) {
  if (typeof value === "string") return CODE_CATEGORY[value.toLowerCase()] || "infrastructure";
  const explicit = typeof value?.category === "string" ? value.category : "";
  if (FAILURE_CATEGORIES.includes(explicit)) return explicit;
  const name = typeof value?.name === "string" ? value.name.toLowerCase() : "";
  if (NAME_CATEGORY[name]) return NAME_CATEGORY[name];
  const code = codeFrom(value).toLowerCase();
  if (CODE_CATEGORY[code]) return CODE_CATEGORY[code];
  const words = new Set(`${value?.message || ""} ${code.replace(/_/g, " ")}`.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
  if (hasAny(words, ["abort", "aborted", "cancel", "cancelled", "cancellation"])) return "cancellation";
  if (hasAny(words, ["network", "socket", "timeout", "transport"])) return "model_transport";
  if (hasAny(words, ["json", "parse", "response", "schema"])) return "model_contract";
  if (hasAny(words, ["budget"])) return "budget_exhaustion";
  if (hasAny(words, ["persist", "persistence", "read", "write"])) return "persistence";
  if (hasAny(words, ["command", "execute", "execution", "exit", "nonzero"])) return "execution";
  return "infrastructure";
}
