export function wireCardListView({ root, cards = [], onSelect = () => {} } = {}) {
  const list = root?.querySelector?.("#card-list");
  const status = root?.querySelector?.("#card-status");
  if (!list || !status) {
    return { ok: false, reason: "missing_elements" };
  }

  function render(nextCards = cards) {
    list.textContent = "";
    nextCards.forEach((card) => {
      const button = root.ownerDocument.createElement("button");
      button.dataset.cardId = card.id;
      button.className = `card-row is-${card.type}`;
      button.textContent = `${card.type}:${card.id}`;
      button.addEventListener("click", () => {
        status.textContent = `selected:${card.id}`;
        onSelect(card);
      });
      list.appendChild(button);
    });
    status.textContent = `cards:${nextCards.length}`;
  }

  render(cards);
  return { ok: true, render };
}
