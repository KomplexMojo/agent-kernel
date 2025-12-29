export function createOllamaTestAdapter({ responses = {} } = {}) {
  const store = { ...responses };

  async function generate({ model, prompt } = {}) {
    const key = `${model || "unknown"}:${prompt || ""}`;
    if (key in store) {
      return store[key];
    }
    return { model, response: "", done: true };
  }

  function setResponse(model, prompt, value) {
    const key = `${model}:${prompt}`;
    store[key] = value;
  }

  return {
    generate,
    setResponse,
  };
}
