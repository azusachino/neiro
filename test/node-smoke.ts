/** Run the SDK's read commands on Node and on Bun against the fixture vault, and fail on any difference in output. */
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const COMMANDS = [
  ["nav"],
  ["nav", "Topics"],
  ["list", "--tag", "psychology/memory"],
  ["search", "cognitive load"],
  ["get", "Working memory"],
  ["links", "clt"],
  ["backlinks", "clt"],
  ["unresolved"],
  ["journal", "day", "--date", "2026-09-16"],
  ["journal", "week", "--date", "2026-09-16"],
];

function run(runtime: string, args: string[]): string {
  const result = spawnSync(runtime, ["src/cli.ts", "--vault", "test/fixtures/vault", ...args, "--json"], {
    cwd: ROOT,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(`${runtime} ${args.join(" ")} failed: ${result.error?.message ?? result.stderr.trim()}`);
  }
  return result.stdout;
}

let failed = false;
for (const args of COMMANDS) {
  const same = run("node", args) === run("bun", args);
  console.log(`${same ? "ok  " : "DIFF"} ${args.join(" ")}`);
  failed ||= !same;
}
if (failed) process.exit(1);
