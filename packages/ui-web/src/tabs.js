export function wireTabs({ buttons = [], panels = [], defaultTab, onChange } = {}) {
  const buttonList = Array.from(buttons);
  const panelList = Array.from(panels);

  function setActive(tabId) {
    buttonList.forEach((button) => {
      const active = button?.dataset?.tab === tabId;
      if (button?.classList?.toggle) {
        button.classList.toggle("active", active);
      }
      if (button?.setAttribute) {
        button.setAttribute("aria-selected", active ? "true" : "false");
      }
    });
    panelList.forEach((panel) => {
      panel.hidden = panel?.dataset?.tabPanel !== tabId;
    });
    if (typeof onChange === "function") {
      onChange(tabId);
    }
  }

  const initial = defaultTab || buttonList[0]?.dataset?.tab;
  if (initial) {
    setActive(initial);
  }

  buttonList.forEach((button) => {
    if (!button?.addEventListener) return;
    button.addEventListener("click", () => {
      if (button.disabled || button.getAttribute?.("aria-disabled") === "true") {
        return;
      }
      const tabId = button?.dataset?.tab;
      if (tabId) setActive(tabId);
    });
  });

  return { setActive };
}
