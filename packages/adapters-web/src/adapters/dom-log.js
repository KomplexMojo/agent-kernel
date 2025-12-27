export function createDomLogAdapter({ listEl, statusEl } = {}) {
  return {
    logger: {
      log(value) {
        if (statusEl) {
          statusEl.textContent = String(value);
        }
        if (!listEl) {
          return;
        }
        const entry = document.createElement("li");
        entry.textContent = `Effect: counter = ${value}`;
        listEl.prepend(entry);
      },
      warn(message, value) {
        if (!listEl) {
          return;
        }
        const entry = document.createElement("li");
        entry.textContent = `${message} (${value})`;
        entry.setAttribute("data-level", "warn");
        listEl.prepend(entry);
      },
    },
  };
}
