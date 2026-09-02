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

  /** One vital as a compact side-by-side cell: label, bar, value. */
  function vitalCell(v) {
    const pct = Math.round(v.fraction * 100);
    const regen = v.regen > 0 ? `<i class="ak-inv-regen">↻${v.regen}</i>` : "";
    return `<span class="ak-inv-vital" style="--v:${v.colorHex}">
      <b>${v.label}</b>
      <span class="ak-inv-bar"><span style="width:${pct}%"></span></span>
      <em>${v.current}/${v.max}</em>${regen}
    </span>`;
  }

  /** One inventory item: identity on the left, its HUD laid out across. */
  function itemRow(card, group, bundle) {
    const hud = card.hud;
    const icon = resolveIconHTML(bundle, group.iconCategory, group.type);
    const identity = hud
      ? [hud.affinity, hud.expression].filter(Boolean).join(" · ")
      : "";
    const vitals = hud?.vitals?.length
      ? hud.vitals.map(vitalCell).join("")
      : `<span class="ak-inv-novitals">no vitals</span>`;
    return `<li class="ak-inv-item">
      <span class="ak-inv-chip">${icon}</span>
      <span class="ak-inv-id">${card.id || group.label}</span>
      <span class="ak-inv-mult">×${card.count}</span>
      <span class="ak-inv-identity">${identity}</span>
      <span class="ak-inv-vitals">${vitals}</span>
      <span class="ak-inv-motivation">${hud?.motivation || ""}</span>
      <span class="ak-inv-tokens">${fmt(card.tokens)}</span>
    </li>`;
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

    const sections = summary.groups.map((g) => {
      const over = g.remainingTokens < 0;
      const items = g.cards.length
        ? g.cards.map((c) => itemRow(c, g, bundle)).join("")
        : `<li class="ak-inv-item is-empty"><span class="ak-inv-chip">${resolveIconHTML(bundle, g.iconCategory, g.type)}</span><span class="ak-inv-id">none</span></li>`;
      return `<section class="ak-inv-group">
        <header style="--g:${g.colorHex}">
          <h3>${g.label}</h3>
          <span class="ak-inv-gcount">${g.count}</span>
          <span class="ak-inv-gtokens">
            ${fmt(g.usedTokens)} of ${fmt(g.allocatedTokens)}
            <b class="${over ? "is-over" : ""}">${fmt(g.remainingTokens)} left</b>
          </span>
        </header>
        <ul>${items}</ul>
      </section>`;
    }).join("");

    const unknown = summary.unknown.length
      ? `<section class="ak-inv-group is-unknown"><header><h3>Unplaced</h3>
           <span class="ak-inv-gcount">${summary.unknown.length}</span></header>
           <ul>${summary.unknown.map((u) => `<li class="ak-inv-item"><span class="ak-inv-id">${u.id || "?"}</span><span class="ak-inv-identity">${u.type || "unknown type"}</span></li>`).join("")}</ul>
         </section>`
      : "";

    el.innerHTML = `
      <div class="ak-inv-screen-inner">
        <header class="ak-inv-header">
          <h2>Inventory</h2>
          <span class="ak-inv-totals">
            ${summary.totals.cardCount} cards ·
            ${fmt(summary.totals.usedTokens)} of ${fmt(summary.totals.allocatedTokens)} ·
            <b class="${summary.totals.overspent ? "is-over" : ""}">${fmt(summary.totals.remainingTokens)} left</b>
          </span>
          <span class="ak-inv-hint">⌘} or Esc to close</span>
        </header>
        <div class="ak-inv-groups">${sections}${unknown}</div>
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
