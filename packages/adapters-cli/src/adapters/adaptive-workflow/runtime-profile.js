import { availableParallelism } from "node:os";
import { readFile } from "node:fs/promises";
import { createRuntimeProfileSnapshotV1, isRuntimeProfileSnapshotV1 } from "../../../../runtime/src/adaptive-workflow/profiles.js";

export function createRuntimeProfileAdapter({ clock = () => new Date().toISOString() } = {}) {
  return Object.freeze({
    async snapshot({ path, runId } = {}) {
      const capturedAt = clock();
      const meta = { id: `${runId}:runtime-profile`, runId, createdAt: capturedAt, producedBy: "adapters-cli" };
      if (path) {
        const supplied = JSON.parse(await readFile(path, "utf8"));
        if (!isRuntimeProfileSnapshotV1(supplied)) throw new Error("Invalid RuntimeProfileSnapshotV1.");
        return createRuntimeProfileSnapshotV1({ ...supplied, meta, capturedAt });
      }
      return createRuntimeProfileSnapshotV1({
        meta, profileVersion: "adaptive-workflow-runtime-profile-v1", capturedAt, source: "probed",
        capabilities: { providerIds: ["fixture", "ollama"], maxConcurrency: Math.max(1, availableParallelism()), supportsReplay: true, supportsCancellation: true },
      });
    },
  });
}
