export function createControlledExecutionAdapter({ operationId, operations = {} } = {}) {
  if (typeof operationId !== "string" || !operationId.trim() || /^workflow(?::|$)/.test(operationId) || typeof operations[operationId] !== "function") {
    throw Object.assign(new Error(`Controlled operation is not allowed: ${operationId || "missing"}`), { code: "controlled_operation_not_allowed", category: "execution" });
  }
  return Object.freeze({
    async run(request) {
      const receipt = await operations[operationId](clone(request));
      if (receipt === undefined) throw Object.assign(new Error("Controlled operation returned no receipt"), { code: "invalid_execution_receipt", category: "execution" });
      return clone(receipt);
    },
  });
}
const clone = (value) => JSON.parse(JSON.stringify(value));
