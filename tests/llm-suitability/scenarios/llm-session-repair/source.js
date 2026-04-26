export function extractJsonObject(text) {
  const cleaned = String(text || "").trim();
  const fenced = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : cleaned;
  if (candidate.startsWith("{") && candidate.endsWith("}")) return candidate;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  return start >= 0 && end > start ? candidate.slice(start, end + 1) : "";
}

export async function runRepairableJsonSession({
  adapter,
  model,
  prompt,
  validate,
  buildRepairPrompt,
  clock = () => new Date().toISOString(),
}) {
  const first = await adapter.generate({ model, prompt });
  const firstJson = extractJsonObject(first.response);
  let parsed = firstJson ? JSON.parse(firstJson) : null;
  let validation = parsed ? validate(parsed) : { ok: false, errors: ["missing-json"] };
  if (!validation.ok) {
    const repairPrompt = buildRepairPrompt({ prompt, responseText: first.response, errors: validation.errors });
    const repaired = await adapter.generate({ model, prompt: repairPrompt });
    const repairJson = extractJsonObject(repaired.response);
    parsed = repairJson ? JSON.parse(repairJson) : null;
    validation = parsed ? validate(parsed) : { ok: false, errors: ["missing-json"] };
    return {
      ok: validation.ok,
      value: validation.ok ? parsed : null,
      repaired: true,
      errors: validation.errors || [],
      capture: { prompt, responseText: first.response, repairedAt: clock() },
    };
  }
  return {
    ok: true,
    value: parsed,
    repaired: false,
    errors: [],
    capture: { prompt, responseText: first.response, capturedAt: clock() },
  };
}
