/**
 * The `tsuzuri/extension` entry: what an extension needs to add operations to a vault (ADR 0019). It imports only the
 * prelude, as every extension does.
 */
import type { Extension, OperationDefinition } from "./index.ts";

export type { Extension, InputProperty, OperationDefinition, OperationKind } from "./index.ts";

/** An operation for an extension, checked by its type: a name, a kind, a command, its input, and `run`. */
export function defineOperation(definition: OperationDefinition): OperationDefinition {
  return definition;
}

/** An extension: its name, the `tsuzuri.toml` table it reads, and its operations. */
export function defineExtension(extension: Extension): Extension {
  return extension;
}
