/**
 * #275: every artifact a persona emits carries that persona in `meta.producedBy`
 * (`ArtifactMeta.producedBy` — "Originating persona/module"). The persona stamps its own
 * output, so glue cannot pass an artifact off as a persona's, and a flow that skips the
 * persona leaves an artifact without its stamp. `tests/architecture/persona-stamps.test.mjs`
 * checks the stamps on every level-producing command against
 * `REQUIRED_PERSONA_STAMPS` (contracts/persona-stamps.js).
 */
import { PERSONA_IDS } from "../../contracts/persona-stamps.js";

export { PERSONA_IDS };

/** `meta` with `producedBy` set to `persona`; an absent meta stays absent. */
export function stampPersona(meta, persona) {
  if (!meta || typeof meta !== "object") return meta;
  return { ...meta, producedBy: persona };
}
