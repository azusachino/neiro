/**
 * Run the SDK's read commands on Node and on Bun against the fixture vault, and fail on any difference in output.
 * Then import the built package on Node from a `node_modules` folder, as an installed consumer would; Node strips
 * no types there, so this is what `exports` must serve. `make node-smoke` builds the package first.
 */
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const CORE = join(import.meta.dirname, "..", "core");
const FIXTURE = join(import.meta.dirname, "fixtures", "vault");
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
  const result = spawnSync(runtime, ["src/cli.ts", "--vault", FIXTURE, ...args, "--json"], {
    cwd: CORE,
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

// Inside the core package, so neiro's own dependencies resolve from its node_modules as they would once installed.
const consumer = join(CORE, ".tmp", "node-consumer");
const installed = join(consumer, "node_modules", "neiro");
rmSync(consumer, { recursive: true, force: true });
mkdirSync(installed, { recursive: true });
cpSync(join(CORE, "package.json"), join(installed, "package.json"));
cpSync(join(CORE, "dist", "lib"), join(installed, "dist", "lib"), { recursive: true });
// Its own package scope, so nothing above it can answer the import by self-reference.
writeFileSync(join(consumer, "package.json"), '{ "private": true, "type": "module" }\n');
const probe = join(consumer, "probe.mjs");
writeFileSync(
  probe,
  `import { Vault } from "neiro";\nconsole.log(JSON.stringify(await new Vault(process.argv[2]).list(), null, 2));\n`,
);
const imported = spawnSync("node", [probe, FIXTURE], { encoding: "utf8" });
const same = imported.status === 0 && imported.stdout === run("bun", ["list"]);
console.log(
  `${same ? "ok  " : "DIFF"} import neiro from node_modules on Node${same ? "" : `: ${imported.stderr.trim()}`}`,
);
failed ||= !same;

// The tools entry, then each `bin` run on Node as an installed command would be.
writeFileSync(probe, `import { TOOLS } from "neiro/tools";\nconsole.log(TOOLS.length);\n`);
const tooled = spawnSync("node", [probe], { encoding: "utf8" });
const toolsOk = tooled.status === 0 && Number(tooled.stdout) > 0;
console.log(
  `${toolsOk ? "ok  " : "DIFF"} import neiro/tools from node_modules on Node${toolsOk ? "" : `: ${tooled.stderr.trim()}`}`,
);
failed ||= !toolsOk;
const bins = JSON.parse(readFileSync(join(installed, "package.json"), "utf8")).bin as Record<string, string>;
const commands: [string, string[], string][] = [
  [join(installed, bins.neiro as string), ["--vault", FIXTURE, "list", "--json"], run("bun", ["list"])],
  [
    join(installed, bins["neiro-tools"] as string),
    ["--json"],
    spawnSync("bun", [join(CORE, "src", "tools-cli.ts"), "--json"], { encoding: "utf8" }).stdout,
  ],
];
for (const [bin, args, expected] of commands) {
  const ran = spawnSync("node", [bin, ...args], { encoding: "utf8" });
  const ok = ran.status === 0 && ran.stdout === expected;
  console.log(`${ok ? "ok  " : "DIFF"} ${bin.slice(consumer.length + 1)} on Node${ok ? "" : `: ${ran.stderr.trim()}`}`);
  failed ||= !ok;
}
if (failed) process.exit(1);
