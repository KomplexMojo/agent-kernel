// docs/engine-api.md lists the public API; it must name exactly the modules in apiSurface.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

describe("engine API doc", () => {
  it("names every apiSurface module and no others", () => {
    const surface = Object.keys(JSON.parse(read("tests/architecture/framework-game-boundary.json")).apiSurface).sort();
    const doc = read("docs/engine-api.md");
    const rows = [...doc.matchAll(/^\| `(packages\/[^`]+)` \|/gm)].map((m) => m[1]).sort();
    expect(rows).toEqual(surface);
  });
});
