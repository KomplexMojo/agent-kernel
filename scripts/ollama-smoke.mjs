import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { buildBuildSpecPrompt } from "../packages/ui-web/src/ollama-template.js";
import { validateBuildSpec } from "../packages/runtime/src/contracts/build-spec.js";

function readArg(argv, key, fallback) {
  const index = argv.indexOf(key);
  if (index === -1) return fallback;
  return argv[index + 1] ?? fallback;
}

function hasFlag(argv, key) {
  return argv.includes(key);
}

function extractResponseText(payload) {
  if (!payload) return "";
  if (typeof payload === "string") return payload;
  if (typeof payload.response === "string") return payload.response;
  if (typeof payload.output === "string") return payload.output;
  if (typeof payload.content === "string") return payload.content;
  return "";
}

function extractJsonCandidate(text) {
  if (!text) return "";
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) return fenced[1].trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start !== -1 && end !== -1 && end > start) {
    return text.slice(start, end + 1).trim();
  }
  return text.trim();
}

function stripAdapterCaptures(spec) {
  if (!spec || typeof spec !== "object") return spec;
  if (!spec.adapters || typeof spec.adapters !== "object") return spec;
  if (!Array.isArray(spec.adapters.capture) || spec.adapters.capture.length === 0) return spec;
  const next = { ...spec, adapters: { ...spec.adapters } };
  delete next.adapters.capture;
  return next;
}

async function main() {
  const argv = process.argv.slice(2);
  const model = readArg(argv, "--model", process.env.OLLAMA_MODEL || "llama3.2");
  const baseUrl = readArg(argv, "--base-url", process.env.OLLAMA_BASE_URL || "http://localhost:11434");
  const promptArg = readArg(argv, "--prompt", process.env.OLLAMA_PROMPT || "");
  const promptFile = readArg(argv, "--prompt-file", "");
  const outDirArg = readArg(argv, "--out-dir", "");
  const allowAdapters = hasFlag(argv, "--allow-adapters");
  const skipBuild = hasFlag(argv, "--no-build");

  const userPrompt = promptFile
    ? await readFile(promptFile, "utf8")
    : (promptArg || "Design a small grid-based level with 2 rooms and 2 actors.");

  const prompt = buildBuildSpecPrompt({ userPrompt });
  const response = await fetch(`${baseUrl}/api/generate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model,
      prompt,
      stream: false,
      options: { temperature: 0, top_p: 1 },
    }),
  });

  if (!response.ok) {
    throw new Error(`Ollama request failed: ${response.status} ${response.statusText}`);
  }

  const payload = await response.json();
  const responseText = extractResponseText(payload);
  const candidate = extractJsonCandidate(responseText);
  if (!candidate) {
    throw new Error("Ollama response did not include JSON output.");
  }

  let spec = null;
  try {
    spec = JSON.parse(candidate);
  } catch (error) {
    throw new Error(`Failed to parse BuildSpec JSON: ${error?.message || error}`);
  }

  const validation = validateBuildSpec(spec);
  if (!validation.ok) {
    throw new Error(`BuildSpec validation failed:\n${validation.errors.join("\n")}`);
  }

  const cleanedSpec = allowAdapters ? spec : stripAdapterCaptures(spec);
  const runId = cleanedSpec?.meta?.runId || `run_${Date.now().toString(36)}`;
  const specDir = resolve(process.cwd(), "artifacts", `ollama_prompt_${runId}`);
  await mkdir(specDir, { recursive: true });
  const specPath = resolve(specDir, "spec.json");
  await writeFile(specPath, JSON.stringify(cleanedSpec, null, 2), "utf8");

  console.log(`Ollama BuildSpec saved: ${specPath}`);

  if (skipBuild) {
    return;
  }

  const cliPath = resolve(process.cwd(), "packages/adapters-cli/src/cli/ak.mjs");
  const outDir = outDirArg || "";
  const buildArgs = [cliPath, "build", "--spec", specPath];
  if (outDir) {
    buildArgs.push("--out-dir", outDir);
  }

  const result = spawnSync(process.execPath, buildArgs, {
    encoding: "utf8",
    env: {
      ...process.env,
      AK_ALLOW_NETWORK: allowAdapters ? "1" : (process.env.AK_ALLOW_NETWORK || "0"),
    },
  });

  if (result.status !== 0) {
    const output = [result.stdout, result.stderr].filter(Boolean).join("\n");
    throw new Error(`Build failed:\n${output}`);
  }

  const output = [result.stdout, result.stderr].filter(Boolean).join("\n");
  if (output) {
    console.log(output.trim());
  }
}

main().catch((error) => {
  console.error(error?.message || error);
  process.exit(1);
});
