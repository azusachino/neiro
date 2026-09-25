/**
 * Run the SDK's read commands on Node and on Bun against the fixture vault, and fail on any difference in output.
 * Then import the built package on Node from a `node_modules` folder, as an installed consumer would; Node strips
 * no types there, so this is what `exports` must serve. `make node-smoke` builds the package first.
 */
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
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

// Inside the repository, so the package's own dependencies resolve from its node_modules.
const consumer = join(ROOT, ".tmp", "node-consumer");
const installed = join(consumer, "node_modules", "neiro");
rmSync(consumer, { recursive: true, force: true });
mkdirSync(installed, { recursive: true });
cpSync(join(ROOT, "package.json"), join(installed, "package.json"));
cpSync(join(ROOT, "dist", "lib"), join(installed, "dist", "lib"), { recursive: true });
// Its own package scope, so nothing above it can answer the import by self-reference.
writeFileSync(join(consumer, "package.json"), '{ "private": true, "type": "module" }\n');
const probe = join(consumer, "probe.mjs");
writeFileSync(
  probe,
  `import { Vault } from "neiro";\nconsole.log(JSON.stringify(await new Vault(process.argv[2]).list(), null, 2));\n`,
);
const imported = spawnSync("node", [probe, join(ROOT, "test/fixtures/vault")], { encoding: "utf8" });
const same = imported.status === 0 && imported.stdout === run("bun", ["list"]);
console.log(
  `${same ? "ok  " : "DIFF"} import neiro from node_modules on Node${same ? "" : `: ${imported.stderr.trim()}`}`,
);
failed ||= !same;
if (failed) process.exit(1);
