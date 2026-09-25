# neiro-tools

Agent tool definitions over [neiro](../../README.md)'s SDK, for a tool-calling model. It imports only the `neiro` public entry, and is released with neiro at the same version.

```ts
import { Vault } from "neiro";
import { agentTools, validateInput } from "neiro-tools";

const vault = new Vault(process.env.NEIRO_VAULT ?? ".");
const tools = agentTools(); // register each tool's name, description, and inputSchema with the model
const tool = tools.find((candidate) => candidate.name === "neiro_search");
const result = await tool?.run(vault, validateInput(tool, { query: "cognitive load" }));
```

`agentTools()` returns ready-made tool definitions for a tool-calling model: a `neiro_` name, a JSON Schema for the input, MCP-style `readOnlyHint`, `destructiveHint`, and `idempotentHint`, an `exposure`, and a `run` bound to the SDK. Validate a model's input with `validateInput`, then call `run(vault, input)`.

The default exposure, agreed in neiro's [ADR 0010](../../docs/decisions/0010-agent-tools-as-an-extension-package.md): reads, `neiro_capture`, and `neiro_journal_append` are `direct`; `neiro_append`, `neiro_section_put`, `neiro_prop_set`, and `neiro_new` need a human's `confirm`; `neiro_put` is never offered. Pass a changed copy of `DEFAULT_EXPOSURE` to `agentTools` to change it. `neiro_grep` reads a model's pattern as literal text unless it sets `regex`, and caps it at 200 characters, since a regular expression runs in the host's process.

`neiro-tools` lists each tool with its exposure and whether it reads, adds, or changes notes, and `neiro-tools --json` prints the definitions.
