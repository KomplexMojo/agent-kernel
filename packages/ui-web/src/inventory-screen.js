/**
 * inventory-screen.js
 *
 * A toggleable inventory summary, drawn in the DOM rather than on a Phaser
 * canvas.
 *
 * The inventory rail is painted inside the card-builder canvas, which is why it
 * sat under the gameplay canvas when that canvas overhung its grid column, and
 * why its labels clipped instead of wrapping. A DOM overlay does not compete for
 * canvas space, stays crisp at any size, and can scroll.
 *
 * Semantics — grouping, ordering, labels, colours, token arithmetic — come from
 * `runtime/render/inventory-summary-model.js`. This module only draws.
 *
 * @module inventory-screen
 */

import { buildInventorySummary } from "../../runtime/src/render/inventory-summary-model.js";
import { resolveIconHTML } from "./icon-resolver.js";

const ROOT_ID = "ak-inventory-screen";

function fmt(tokens) {
  return `${Math.round(tokens)}t`;
}

/**
 * @param {{ getCards?: () => unknown[], getAllocationLedger?: () => object,
 *           getResourceBundle?: () => object|null, doc?: Document }} [deps]
 */
export function createInventoryScreen({
  getCards = () => [],
  getAllocationLedger = () => null,
  getResourceBundle = () => null,
  doc = globalThis.document,
} = {}) {
  let root = null;
  let open = false;

  function ensureRoot() {
    if (root || !doc?.createElement) return root;
    root = doc.createElement("div");
    root.id = ROOT_ID;
    root.className = "ak-inventory-screen";
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-label", "Inventory summary");
    root.hidden = true;
    doc.body?.appendChild?.(root);
    return root;
  }

  function render() {
    const el = ensureRoot();
    if (!el) return;
    let summary;
    try {
      summary = buildInventorySummary({
        cards: getCards() || [],
        allocationLedger: getAllocationLedger(),
      });
    } catch {
      // A summary that throws must not take the screen down with it.
      summary = buildInventorySummary({});
    }
    const bundle = getResourceBundle?.() || null;

    const rows = summary.groups.map((g) => {
      const icon = resolveIconHTML(bundle, g.iconCategory, g.type);
      const over = g.remainingTokens < 0;
      return `<tr class="${g.count === 0 ? "is-empty" : ""}">
        <td class="ak-inv-icon"><span class="ak-inv-chip">${icon}</span></td>
        <td class="ak-inv-label" style="color:${g.colorHex}">${g.label}</td>
        <td class="ak-inv-count">${g.count}</td>
        <td class="ak-inv-num">${fmt(g.usedTokens)}</td>
        <td class="ak-inv-num">${fmt(g.allocatedTokens)}</td>
        <td class="ak-inv-num ${over ? "is-over" : ""}">${fmt(g.remainingTokens)}</td>
      </tr>`;
    }).join("");

    const unknownRow = summary.unknown.length
      ? `<tr class="is-unknown"><td></td><td class="ak-inv-label">Unplaced</td>
           <td class="ak-inv-count">${summary.unknown.length}</td><td colspan="3">
           ${summary.unknown.map((u) => u.type || "?").join(", ")}</td></tr>`
      : "";

    el.innerHTML = `
      <div class="ak-inv-panel">
        <header class="ak-inv-header">
          <h2>Inventory</h2>
          <span class="ak-inv-hint">⌘} or Esc to close</span>
        </header>
        <table class="ak-inv-table">
          <thead><tr><th></th><th>Group</th><th>Cards</th><th>Spent</th><th>Budget</th><th>Left</th></tr></thead>
          <tbody>${rows}${unknownRow}</tbody>
          <tfoot><tr>
            <td></td><td>Total</td>
            <td class="ak-inv-count">${summary.totals.cardCount}</td>
            <td class="ak-inv-num">${fmt(summary.totals.usedTokens)}</td>
            <td class="ak-inv-num">${fmt(summary.totals.allocatedTokens)}</td>
            <td class="ak-inv-num ${summary.totals.overspent ? "is-over" : ""}">${fmt(summary.totals.remainingTokens)}</td>
          </tr></tfoot>
        </table>
      </div>`;
  }

  return {
    isOpen: () => open,
    show() {
      const el = ensureRoot();
      if (!el) return false;
      render();
      el.hidden = false;
      open = true;
      return true;
    },
    hide() {
      if (root) root.hidden = true;
      open = false;
      return true;
    },
    toggle() {
      if (open) {
        this.hide();
        return false;
      }
      this.show();
      return open;
    },
    /** Re-render in place; a no-op while closed so a closed screen costs nothing. */
    refresh() {
      if (open) render();
    },
    dispose() {
      root?.remove?.();
      root = null;
      open = false;
    },
  };
}
