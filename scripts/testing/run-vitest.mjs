import { runProcess } from "./shared.mjs";

const passthroughArgs = process.argv.slice(2).filter((arg) => arg !== "--");
const args = ["exec", "vitest", "--config", "vitest.config.mjs", "run", ...passthroughArgs];
const result = runProcess("pnpm", args);

if (result.stdout) {
  process.stdout.write(result.stdout);
}
if (result.stderr) {
  process.stderr.write(result.stderr);
}
process.exit(result.status ?? 1);
