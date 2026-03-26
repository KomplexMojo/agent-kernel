import { getCardTypeIcon } from "../../runtime/src/render/resource-icons.js";

export function wireCardTypeIcons({ root = document } = {}) {
  const nodes = typeof root?.querySelectorAll === "function"
    ? Array.from(root.querySelectorAll("[data-card-type-icon]"))
    : [];

  nodes.forEach((node) => {
    const type = typeof node?.dataset?.cardTypeIcon === "string"
      ? node.dataset.cardTypeIcon
      : "";
    node.textContent = getCardTypeIcon(type);
  });
}
