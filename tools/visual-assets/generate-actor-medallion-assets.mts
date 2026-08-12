#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";
import {
  ACTOR_MEDALLION_CANONICAL_SIZE,
  ACTOR_MEDALLION_COMPONENT_IDS,
  buildActorMedallionComponentSprite,
  composeActorMedallion,
} from "../../packages/runtime/src/render/actor-medallion-composer.js";
import {
  GAME_AFFINITY_KINDS,
  GAME_MOTIVATION_KINDS,
} from "../../packages/runtime/src/contracts/game-elements.js";
import { encodeRgbaToPng } from "../../packages/runtime/src/render/resource-bundle.js";

type DecodedPng = {
  width: number;
  height: number;
  pixels: Uint8ClampedArray;
};

type SheetCell = {
  name: string;
  column: number;
  row: number;
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");
const sourceDir = path.join(repoRoot, "packages/runtime/src/render/source-assets/actor-medallions");
const defaultOutputDir = path.join(repoRoot, "packages/runtime/src/render/visual-assets/actor-medallions");
const expressions = ["push", "pull", "emit", "draw"] as const;

function parseArgs(argv: string[]) {
  const args = {
    outputDir: defaultOutputDir,
    expressionStyle: "triangles",
    reviewOnly: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--output-dir") {
      args.outputDir = path.resolve(argv[++i]);
    } else if (arg === "--expression-style") {
      args.expressionStyle = argv[++i] || "triangles";
    } else if (arg === "--review-only") {
      args.reviewOnly = true;
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }
  }
  if (args.expressionStyle !== "triangles") {
    throw new Error("Only --expression-style triangles is currently supported.");
  }
  return args;
}

function printHelp() {
  console.log(`Usage: pnpm exec ts-node tools/visual-assets/generate-actor-medallion-assets.mts [options]

Options:
  --expression-style triangles   Expression indicator style. Defaults to triangles.
  --output-dir <path>            Output directory for components and review sheets.
  --review-only                  Emit review sheets without component asset PNGs.
`);
}

async function readPng(filePath: string): Promise<DecodedPng> {
  const bytes = await readFile(filePath);
  const png = PNG.sync.read(bytes);
  return {
    width: png.width,
    height: png.height,
    pixels: new Uint8ClampedArray(png.data),
  };
}

function cropGridCell(sheet: DecodedPng, columns: number, rows: number, column: number, row: number): Uint8ClampedArray {
  const width = Math.round(sheet.width / columns);
  const height = Math.round(sheet.height / rows);
  const left = Math.round(column * sheet.width / columns);
  const top = Math.round(row * sheet.height / rows);
  const out = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const sx = Math.min(sheet.width - 1, left + x);
      const sy = Math.min(sheet.height - 1, top + y);
      const sourceIndex = (sy * sheet.width + sx) * 4;
      const targetIndex = (y * width + x) * 4;
      out[targetIndex] = sheet.pixels[sourceIndex];
      out[targetIndex + 1] = sheet.pixels[sourceIndex + 1];
      out[targetIndex + 2] = sheet.pixels[sourceIndex + 2];
      out[targetIndex + 3] = sheet.pixels[sourceIndex + 3];
    }
  }
  return out;
}

function createSheet(cells: Array<{ name: string; pixels: Uint8ClampedArray }>, columns: number, cellSize = ACTOR_MEDALLION_CANONICAL_SIZE) {
  const rows = Math.max(1, Math.ceil(cells.length / columns));
  const width = columns * cellSize;
  const height = rows * cellSize;
  const pixels = new Uint8ClampedArray(width * height * 4);
  cells.forEach((cell, index) => {
    const col = index % columns;
    const row = Math.floor(index / columns);
    for (let y = 0; y < cellSize; y += 1) {
      for (let x = 0; x < cellSize; x += 1) {
        const sourceIndex = (y * cellSize + x) * 4;
        const targetIndex = ((row * cellSize + y) * width + col * cellSize + x) * 4;
        pixels[targetIndex] = cell.pixels[sourceIndex];
        pixels[targetIndex + 1] = cell.pixels[sourceIndex + 1];
        pixels[targetIndex + 2] = cell.pixels[sourceIndex + 2];
        pixels[targetIndex + 3] = cell.pixels[sourceIndex + 3];
      }
    }
  });
  return { width, height, pixels };
}

function downscaleNearest(source: Uint8ClampedArray, sourceSize: number, targetSize: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(targetSize * targetSize * 4);
  for (let y = 0; y < targetSize; y += 1) {
    for (let x = 0; x < targetSize; x += 1) {
      const sx = Math.min(sourceSize - 1, Math.floor((x / targetSize) * sourceSize));
      const sy = Math.min(sourceSize - 1, Math.floor((y / targetSize) * sourceSize));
      const sourceIndex = (sy * sourceSize + sx) * 4;
      const targetIndex = (y * targetSize + x) * 4;
      out[targetIndex] = source[sourceIndex];
      out[targetIndex + 1] = source[sourceIndex + 1];
      out[targetIndex + 2] = source[sourceIndex + 2];
      out[targetIndex + 3] = source[sourceIndex + 3];
    }
  }
  return out;
}

async function writePng(filePath: string, width: number, height: number, pixels: Uint8ClampedArray) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, encodeRgbaToPng({ width, height, pixels }));
}

function componentAssetIds(): string[] {
  return [
    ACTOR_MEDALLION_COMPONENT_IDS.frame,
    ...Object.values(ACTOR_MEDALLION_COMPONENT_IDS.actors),
    ...Object.values(ACTOR_MEDALLION_COMPONENT_IDS.vitals),
    ...Object.values(ACTOR_MEDALLION_COMPONENT_IDS.expressions),
    ...Object.values(ACTOR_MEDALLION_COMPONENT_IDS.affinities),
    ...Object.values(ACTOR_MEDALLION_COMPONENT_IDS.motivations),
  ];
}

function componentFilename(assetId: string) {
  return `${assetId.slice("component.actor-medallion.".length).replace(/\./g, "-")}.png`;
}

function representativeActors() {
  return [
    {
      id: "delver_fire_push_attacking",
      role: "delver",
      affinities: [{ kind: "fire", expression: "push" }],
      motivation: "attacking",
    },
    {
      id: "warden_water_pull_defending",
      role: "warden",
      affinities: [{ kind: "water", expression: "pull" }],
      motivation: "defending",
    },
    {
      id: "delver_light_emit_exploring",
      role: "delver",
      affinities: [{ kind: "light", expression: "emit" }],
      motivation: "exploring",
      vitals: { health: { current: 7, max: 10 }, mana: { current: 3, max: 10 } },
    },
    {
      id: "warden_dark_draw_stealthy",
      role: "warden",
      affinities: [{ kind: "dark", expression: "draw" }],
      motivation: "stealthy",
      vitals: { stamina: { current: 5, max: 10 }, durability: { current: 4, max: 10 } },
    },
  ];
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const sourceSheets = {
    frame: await readPng(path.join(sourceDir, "frame-template-components.png")),
    actors: await readPng(path.join(sourceDir, "actor-symbol-components.png")),
    motivations: await readPng(path.join(sourceDir, "motivation-symbol-components.png")),
    affinities: await readPng(path.join(sourceDir, "approved-affinity-sprite-sheet.png")),
  };

  const sourceManifest = {
    frame: {
      path: "frame-template-components.png",
      grid: "3x3",
      sampleBytes: cropGridCell(sourceSheets.frame, 3, 3, 0, 0).length,
    },
    actors: {
      path: "actor-symbol-components.png",
      grid: "3x2",
      sampleBytes: cropGridCell(sourceSheets.actors, 3, 2, 0, 0).length,
    },
    motivations: {
      path: "motivation-symbol-components.png",
      grid: "4x3",
      sampleBytes: cropGridCell(sourceSheets.motivations, 4, 3, 0, 0).length,
    },
    affinities: {
      path: "approved-affinity-sprite-sheet.png",
      grid: "5x2",
      preserveOriginal: true,
      sampleBytes: cropGridCell(sourceSheets.affinities, 5, 2, 0, 0).length,
    },
  };

  await mkdir(args.outputDir, { recursive: true });
  const componentIds = componentAssetIds();
  const componentCells = componentIds.map((assetId) => ({
    name: assetId,
    pixels: buildActorMedallionComponentSprite(assetId, ACTOR_MEDALLION_CANONICAL_SIZE),
  }));

  if (!args.reviewOnly) {
    for (const cell of componentCells) {
      await writePng(
        path.join(args.outputDir, "components", componentFilename(cell.name)),
        ACTOR_MEDALLION_CANONICAL_SIZE,
        ACTOR_MEDALLION_CANONICAL_SIZE,
        cell.pixels,
      );
    }
  }

  const expressionCells = expressions.map((expression) => ({
    name: expression,
    pixels: buildActorMedallionComponentSprite(`component.actor-medallion.expression.${expression}`, ACTOR_MEDALLION_CANONICAL_SIZE),
  }));
  const expressionSheet = createSheet(expressionCells, 4);
  await writePng(path.join(args.outputDir, "review", "expression-triangles-sheet.png"), expressionSheet.width, expressionSheet.height, expressionSheet.pixels);

  const actorAffinityCells = GAME_AFFINITY_KINDS.flatMap((affinity) => [
    {
      name: `delver-${affinity}`,
      pixels: composeActorMedallion({
        size: ACTOR_MEDALLION_CANONICAL_SIZE,
        actor: { role: "delver", affinities: [{ kind: affinity, expression: "push" }], motivation: "exploring" },
      }),
    },
    {
      name: `warden-${affinity}`,
      pixels: composeActorMedallion({
        size: ACTOR_MEDALLION_CANONICAL_SIZE,
        actor: { role: "warden", affinities: [{ kind: affinity, expression: "pull" }], motivation: "defending" },
      }),
    },
  ]);
  const actorAffinitySheet = createSheet(actorAffinityCells, 5);
  await writePng(path.join(args.outputDir, "review", "representative-actor-affinity-sheet.png"), actorAffinitySheet.width, actorAffinitySheet.height, actorAffinitySheet.pixels);

  const limitedPermutationCells = representativeActors().map((actor) => ({
    name: actor.id,
    pixels: composeActorMedallion({ size: ACTOR_MEDALLION_CANONICAL_SIZE, actor }),
  }));
  const limitedPermutationSheet = createSheet(limitedPermutationCells, 4);
  await writePng(path.join(args.outputDir, "review", "limited-permutation-contact-sheet.png"), limitedPermutationSheet.width, limitedPermutationSheet.height, limitedPermutationSheet.pixels);

  for (const size of [32, 16]) {
    const scaledCells = limitedPermutationCells.map((cell) => ({
      name: cell.name,
      pixels: downscaleNearest(cell.pixels, ACTOR_MEDALLION_CANONICAL_SIZE, size),
    }));
    const sheet = createSheet(scaledCells, 4, size);
    await writePng(path.join(args.outputDir, "review", `limited-permutation-contact-sheet-${size}.png`), sheet.width, sheet.height, sheet.pixels);
  }

  const registry = {
    schema: "agent-kernel/actor-medallion-generated-assets",
    schemaVersion: 1,
    canonicalSize: ACTOR_MEDALLION_CANONICAL_SIZE,
    expressionStyle: args.expressionStyle,
    sourceSheets: sourceManifest,
    components: Object.fromEntries(componentCells.map((cell) => [
      cell.name,
      {
        relativePath: `components/${componentFilename(cell.name)}`,
        dataUri: `data:image/png;base64,${Buffer.from(encodeRgbaToPng({
          width: ACTOR_MEDALLION_CANONICAL_SIZE,
          height: ACTOR_MEDALLION_CANONICAL_SIZE,
          pixels: cell.pixels,
        })).toString("base64")}`,
      },
    ])),
    reviewSheets: [
      "review/expression-triangles-sheet.png",
      "review/representative-actor-affinity-sheet.png",
      "review/limited-permutation-contact-sheet.png",
      "review/limited-permutation-contact-sheet-32.png",
      "review/limited-permutation-contact-sheet-16.png",
    ],
    knownAffinities: GAME_AFFINITY_KINDS,
    knownMotivations: GAME_MOTIVATION_KINDS,
  };
  await writeFile(path.join(args.outputDir, "actor-medallion-generated-assets.json"), JSON.stringify(registry, null, 2));
  console.log(JSON.stringify({ outputDir: args.outputDir, components: componentCells.length, reviewSheets: registry.reviewSheets }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
