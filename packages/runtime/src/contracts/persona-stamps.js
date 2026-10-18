/**
 * #275: the persona that must have produced each boundary artifact of a level.
 *
 * `ArtifactMeta.producedBy` names the originating persona. The persona stamps its own output
 * (`personas/_shared/persona-stamp.js`), so a flow that goes around the persona leaves the
 * artifact with some other stamp, and `personaStampViolations` reports it. Enforced on every
 * level-producing command by `tests/architecture/persona-stamps.test.mjs`.
 */
import {
  BUDGET_RECEIPT_ARTIFACT_SCHEMA,
  INITIAL_STATE_SCHEMA,
  PLAN_ARTIFACT_SCHEMA,
  PRICE_LIST_SCHEMA,
  SIM_CONFIG_SCHEMA,
  SPEND_PROPOSAL_SCHEMA,
} from "./artifacts.ts";

export const PERSONA_IDS = Object.freeze({
  orchestrator: "orchestrator",
  director: "director",
  configurator: "configurator",
  allocator: "allocator",
  actor: "actor",
  moderator: "moderator",
  annotator: "annotator",
});

export const REQUIRED_PERSONA_STAMPS = Object.freeze({
  [PLAN_ARTIFACT_SCHEMA]: PERSONA_IDS.director,
  [SIM_CONFIG_SCHEMA]: PERSONA_IDS.configurator,
  [INITIAL_STATE_SCHEMA]: PERSONA_IDS.configurator,
  [PRICE_LIST_SCHEMA]: PERSONA_IDS.allocator,
  [SPEND_PROPOSAL_SCHEMA]: PERSONA_IDS.allocator,
  [BUDGET_RECEIPT_ARTIFACT_SCHEMA]: PERSONA_IDS.allocator,
});

/**
 * Artifacts whose schema names a required persona but whose `meta.producedBy` is another.
 * Artifacts of other schemas are not judged.
 * @returns {{ schema: string, id: (string|undefined), expected: string, found: (string|undefined) }[]}
 */
export function personaStampViolations(artifacts = []) {
  const violations = [];
  for (const artifact of artifacts) {
    const expected = REQUIRED_PERSONA_STAMPS[artifact?.schema];
    if (expected && artifact?.meta?.producedBy !== expected) {
      violations.push({ schema: artifact.schema, id: artifact?.meta?.id, expected, found: artifact?.meta?.producedBy });
    }
  }
  return violations;
}
