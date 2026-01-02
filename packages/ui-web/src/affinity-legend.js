export const AFFINITY_KINDS = Object.freeze([
  "fire",
  "water",
  "earth",
  "wind",
  "life",
  "decay",
  "corrode",
  "dark",
]);

export const AFFINITY_EXPRESSIONS = Object.freeze(["push", "pull", "emit"]);

function clearList(listEl) {
  if (!listEl) return;
  if (typeof listEl.replaceChildren === "function") {
    listEl.replaceChildren();
    return;
  }
  if (Array.isArray(listEl.children)) {
    listEl.children.length = 0;
    return;
  }
  if ("textContent" in listEl) {
    listEl.textContent = "";
  }
}

function appendItem(listEl, label) {
  if (!listEl) return;
  if (typeof listEl.appendChild === "function" && listEl.ownerDocument?.createElement) {
    const item = listEl.ownerDocument.createElement("span");
    item.className = "legend-chip";
    item.textContent = label;
    listEl.appendChild(item);
    return;
  }
  if (typeof listEl.appendChild === "function") {
    const item = { textContent: label };
    listEl.appendChild(item);
    return;
  }
  if (Array.isArray(listEl.children)) {
    listEl.children.push({ textContent: label });
  }
}

function renderList(listEl, items) {
  clearList(listEl);
  items.forEach((item) => appendItem(listEl, item));
}

export function wireAffinityLegend({ button, panel, kindsEl, expressionsEl } = {}) {
  renderList(kindsEl, AFFINITY_KINDS);
  renderList(expressionsEl, AFFINITY_EXPRESSIONS);

  if (panel) {
    panel.hidden = true;
  }
  if (button?.setAttribute) {
    button.setAttribute("aria-expanded", "false");
  }
  if (!button?.addEventListener) {
    return { open: () => {}, close: () => {}, toggle: () => {} };
  }

  function open() {
    if (panel) panel.hidden = false;
    if (button?.setAttribute) button.setAttribute("aria-expanded", "true");
  }

  function close() {
    if (panel) panel.hidden = true;
    if (button?.setAttribute) button.setAttribute("aria-expanded", "false");
  }

  function toggle() {
    if (!panel) return;
    if (panel.hidden) {
      open();
    } else {
      close();
    }
  }

  button.addEventListener("click", toggle);

  return { open, close, toggle };
}
