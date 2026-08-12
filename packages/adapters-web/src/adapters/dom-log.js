export function createDomLogAdapter({ listEl, statusEl } = {}) {
  function formatValue(value) {
    if (value === undefined || value === null) return "";
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      return String(value);
    }
    try {
      return JSON.stringify(value);
    } catch (_error) {
      return String(value);
    }
  }

  function appendEntry(message, value, level = "") {
    if (!listEl) {
      return;
    }
    const entry = document.createElement("li");
    const formatted = formatValue(value);
    entry.textContent = formatted ? `${message} (${formatted})` : message;
    if (level) {
      entry.setAttribute("data-level", level);
    }
    listEl.prepend(entry);
  }

  return {
    logger: {
      log(value) {
        appendEntry("log", value);
      },
      warn(message, value) {
        appendEntry(message, value, "warn");
      },
    },
  };
}
