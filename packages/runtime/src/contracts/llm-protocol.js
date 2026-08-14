/**
 * The CR.4 LLM request/response protocol — one runtime origin for the VALUES.
 *
 * WHY A `.js` CONTRACTS MODULE AND NOT `artifacts.ts`. Same reason as
 * `contracts/spend-protocol.js` (CR.9 M4): `artifacts.ts` is types-plus-consts and there
 * is no TS loader on the Node path, so **no runtime `.js` module can import it**. Left
 * alone, that is precisely how schema strings come to be restated at each point of use —
 * which is how the spend vocabulary ended up declared three times. The types in
 * `artifacts.ts` remain the definitions of record for SHAPE; this file is the definition
 * of record for the VALUES.
 *
 * WHY THESE ARE NOT core-ts `EffectKind` MEMBERS. core-ts's `EffectKind` is backed by
 * `Int32Array`s and carries integers only — actor ids, coordinates, deltas. A prompt
 * string, a model name and an options bag cannot ride that bus. The LLM effect therefore
 * uses the runtime's STRUCTURED string-kind layer, alongside `solver_request`. PX.1 is
 * untouched: core-ts is still the sole origin of the numeric `EffectKind`.
 *
 * WHAT THIS IS FOR (CR.4). `personas/orchestrator/llm-session.js` currently `await`s
 * `adapter.generate(...)` at three sites, so external IO runs inline inside the persona
 * whose chartered role is external interaction, is not returned as data, and never passes
 * through `ports/effects.js`. `LLM_REQUEST_EFFECT_KIND` is what the Orchestrator returns
 * INSTEAD of making that call.
 */

// M9: both declared in artifacts.ts, re-exported here under the names importers use.
import { LLM_REQUEST_SCHEMA, LLM_RESPONSE_SCHEMA } from "./artifacts.ts";

export { LLM_REQUEST_SCHEMA, LLM_RESPONSE_SCHEMA };

/**
 * The structured-effect kind. `ports/effects.js` MUST carry an explicit case for this.
 *
 * ⚠️ `dispatchEffect`'s `default:` branch returns `{ status: "fulfilled" }` after only
 * logging "Unhandled effect kind". For a stray effect that is harmless; for an LLM
 * request it would mean the model was never called and the caller was told it was — a
 * silent no-op wearing a success status, which is this repo's most repeated defect class.
 * `tests/runtime/llm-request-effect.test.js` fails if the explicit case is ever removed.
 */
export const LLM_REQUEST_EFFECT_KIND = "llm_request";

/** Returned by `dispatchEffect` when no LLM adapter is wired. Never "fulfilled". */
export const LLM_MISSING_ADAPTER_REASON = "missing_llm";
