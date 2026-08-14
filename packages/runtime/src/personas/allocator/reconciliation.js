// Allocator-owned budget reconciliation (P5.5).
//
// The charter's persona table has named reconciliation as Allocator work since
// the persona model was enforced, and this persona's README has described it
// under "Reconciliation and Adjustment" for just as long. Neither was ever
// implemented: until P5.5, `rg reconcil` over packages/runtime/src found only the
// Configurator's LAYOUT tile reconciliation, a different word for a different
// thing. The FSM meanwhile had a `monitoring → rebalancing` edge that gated
// NOTHING — advance() behaved identically in every state, so REBALANCING was a
// label-only state, which the charter's enforcement checklist calls a defect.
// This module is what that state now gates.
//
// It DECIDES; it never reads. The ledger comes in as data (ports/budget.js reads
// core's counters, which is glue's job) and the verdict goes out as data, so the
// whole decision is replayable from a tick frame. Pure: no clock, no adapters,
// no core handle.
//
// ⚠️ **There is deliberately no default ledger.** A reconciliation asked to run
// with nothing to reconcile would report "within budget" for a run that blew its
// cap — well-formed, auditable-looking, and wrong. That is the CR.1 defect class
// (a second silently-diverging answer), and it is why every capability this
// persona needs and does not own refuses instead of defaulting, the same way
// `deriveRoomLayout` refuses with `allocator_room_geometry_required`.

/** Core's sentinel for "no cap set" (core-ts state/budget.ts UNLIMITED_CAP). */
const UNLIMITED_CAP = -1;

export class AllocatorReconciliationError extends Error {
  constructor(message) {
    super(message);
    this.name = "AllocatorReconciliationError";
    this.code = "allocator_reconciliation_input_required";
  }
}

/**
 * Per-category verdicts. `unlimited` is distinct from `within` on purpose: a
 * category with no cap has nothing to be within, and collapsing the two would
 * let an uncapped run report the same clean verdict as a run that stayed inside
 * a real budget.
 */
export const ReconciliationDispositions = Object.freeze({
  UNLIMITED: "unlimited",
  WITHIN: "within",
  AT_LIMIT: "at_limit",
  EXCEEDED: "exceeded",
});

/**
 * The adjustments the charter says the Allocator "may" make, expressed as data
 * rather than performed: it signals, and the plane that owns the work acts.
 */
export const ReconciliationAdjustments = Object.freeze({
  /** Spend passed the cap: the chartered "require simplification". */
  REDUCE_SCOPE: "reduce_scope",
  /** Spend reached the cap exactly: no headroom left, nothing overspent yet. */
  HOLD: "hold",
});

function dispositionFor(issued, spent) {
  if (!Number.isFinite(issued) || issued === UNLIMITED_CAP) {
    return ReconciliationDispositions.UNLIMITED;
  }
  if (spent > issued) return ReconciliationDispositions.EXCEEDED;
  if (spent === issued) return ReconciliationDispositions.AT_LIMIT;
  return ReconciliationDispositions.WITHIN;
}

/**
 * Reconcile actual spend against the issued budget.
 *
 * @param {{ ledger?: { categories?: Array<{ category: string, categoryId?: number,
 *   issued: number, spent: number }> } }} params the run's budget ledger — issued
 *   caps as applied to core, and the spend core has actually charged against them.
 * @returns {{ disposition: string, categories: Array<object>, adjustments: Array<object> }}
 *   the run-level verdict (the worst category's), the per-category detail, and the
 *   adjustment signals. Every field is plain serializable data.
 * @throws {AllocatorReconciliationError} when there is no ledger to reconcile.
 */
export function reconcileBudget({ ledger } = {}) {
  const rows = Array.isArray(ledger?.categories) ? ledger.categories : null;
  if (!rows || rows.length === 0) {
    throw new AllocatorReconciliationError(
      "Allocator cannot reconcile without a budget ledger: pass { ledger: { categories: "
        + "[{ category, issued, spent }] } }. Reconciling nothing would report the run as "
        + "within budget, which is indistinguishable from a run that stayed inside it.",
    );
  }

  const categories = rows.map((row) => {
    const issued = Number(row?.issued);
    const spent = Number(row?.spent);
    const normalizedSpent = Number.isFinite(spent) ? spent : 0;
    const disposition = dispositionFor(issued, normalizedSpent);
    const remaining = disposition === ReconciliationDispositions.UNLIMITED
      ? null
      : issued - normalizedSpent;
    return {
      category: row?.category ?? null,
      ...(row?.categoryId === undefined ? {} : { categoryId: row.categoryId }),
      issued: Number.isFinite(issued) ? issued : null,
      spent: normalizedSpent,
      remaining,
      disposition,
    };
  });

  const adjustments = [];
  for (const row of categories) {
    if (row.disposition === ReconciliationDispositions.EXCEEDED) {
      adjustments.push({
        kind: ReconciliationAdjustments.REDUCE_SCOPE,
        category: row.category,
        overspend: row.spent - row.issued,
      });
    } else if (row.disposition === ReconciliationDispositions.AT_LIMIT) {
      adjustments.push({ kind: ReconciliationAdjustments.HOLD, category: row.category });
    }
  }

  // The run-level verdict is the WORST category, not an average: a run that blew
  // one cap has not "mostly" stayed in budget.
  const severity = [
    ReconciliationDispositions.UNLIMITED,
    ReconciliationDispositions.WITHIN,
    ReconciliationDispositions.AT_LIMIT,
    ReconciliationDispositions.EXCEEDED,
  ];
  const disposition = categories.reduce(
    (worst, row) => (severity.indexOf(row.disposition) > severity.indexOf(worst) ? row.disposition : worst),
    ReconciliationDispositions.UNLIMITED,
  );

  return { disposition, categories, adjustments };
}
