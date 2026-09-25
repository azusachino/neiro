#!/usr/bin/env bun
import { parseArgs } from "node:util";
import pkg from "../package.json" with { type: "json" };
import { TOOLS } from "./index.ts";

const USAGE = `neiro-tools ${pkg.version}: neiro's agent tool definitions

usage: neiro-tools [--json]

Lists each tool with its exposure and whether it reads, adds, or changes notes.
--json prints the definitions a tool-calling model takes: name, description, inputSchema, annotations, and exposure.`;

function parse() {
  try {
    return parseArgs({
      args: process.argv.slice(2),
      options: { json: { type: "boolean" }, help: { type: "boolean", short: "h" } },
    }).values;
  } catch (error) {
    console.error(`neiro-tools: ${(error as Error).message}\n\n${USAGE}`);
    process.exit(2);
  }
}

const opts = parse();
if (opts.help) {
  console.log(USAGE);
} else {
  const definitions = TOOLS.map(({ run: _, ...definition }) => definition);
  if (opts.json) {
    console.log(JSON.stringify(definitions, null, 2));
  } else {
    for (const { name, exposure, annotations, description } of definitions) {
      const effect = annotations.readOnlyHint ? "reads" : annotations.destructiveHint ? "changes" : "adds";
      console.log(`${name}\t${exposure}\t${effect}\t${description}`);
    }
  }
}
