/**
 * Every vault operation, named with its kind, and the mask a host sets over them (ADR 0018). tsuzuri ships no policy:
 * a `Vault` opened without `allow` permits everything.
 */
import { posix } from "node:path";
import { ConfigError, TsuzuriError } from "./errors.ts";

export type OperationKind = "read" | "create" | "edit" | "move" | "delete";

export const OPERATION_KINDS: readonly OperationKind[] = ["read", "create", "edit", "move", "delete"];

/** Each `Vault` method that touches the vault's files, by name, with its kind. */
export const OPERATIONS = {
  notes: "read",
  get: "read",
  find: "read",
  suggest: "read",
  list: "read",
  search: "read",
  grep: "read",
  tags: "read",
  links: "read",
  backlinks: "read",
  orphans: "read",
  unresolved: "read",
  outline: "read",
  property: "read",
  nav: "read",
  select: "read",
  capture: "create",
  create: "create",
  append: "edit",
  putSection: "edit",
  setProperty: "edit",
  put: "edit",
} as const satisfies Record<string, OperationKind>;

export type OperationName = keyof typeof OPERATIONS;

/**
 * One rule of a mask: a kind or an operation name, or several with `under`, the folders they are limited to.
 * `"read"`, `"capture"`, and `{ ops: ["edit"], under: ["Inbox"] }` are rules.
 */
export type AllowRule = OperationKind | OperationName | { ops: (OperationKind | OperationName)[]; under?: string[] };

/** Raised when a `Vault`'s mask does not allow an operation, or a path it would touch. Nothing is touched first. */
export class PermissionError extends TsuzuriError {}

/** Where an operation may reach: everywhere, or only inside these folder prefixes (lowercase, ending in `/`). */
export type Scope = { everywhere: true } | { everywhere: false; folders: string[] };

/**
 * A vault-relative path, normalized, lowercase for comparison, or `undefined` when it leaves the vault. Compared
 * without case, so `inbox/` cannot slip past a rule for `Inbox/` on a case-insensitive disk.
 */
export function vaultPath(path: string): string | undefined {
  const normalized = posix.normalize(path.replaceAll("\\", "/").trim()).replace(/^\.\//, "");
  if (normalized.startsWith("/") || normalized === ".." || normalized.startsWith("../")) return undefined;
  return normalized.toLowerCase();
}

function folder(under: string, rule: number): string {
  const path = vaultPath(under);
  if (path === undefined) throw new ConfigError(`allow rule ${rule}: under "${under}" leaves the vault`);
  const trimmed = path.replace(/\/+$/, "");
  return trimmed === "" || trimmed === "." ? "" : `${trimmed}/`;
}

export class Mask {
  private readonly scopes = new Map<OperationName, Scope>();

  /** Without rules, every operation is allowed everywhere. */
  constructor(rules?: AllowRule[]) {
    for (const name of Object.keys(OPERATIONS) as OperationName[]) {
      this.scopes.set(name, rules ? { everywhere: false, folders: [] } : { everywhere: true });
    }
    rules?.forEach((rule, i) => {
      const { ops, under } = typeof rule === "string" ? { ops: [rule], under: undefined } : rule;
      const folders = under?.map((path) => folder(path, i));
      for (const op of ops) {
        const named = (Object.keys(OPERATIONS) as OperationName[]).filter(
          (name) => name === op || OPERATIONS[name] === op,
        );
        if (named.length === 0) {
          throw new ConfigError(
            `allow rule ${i}: "${op}" is neither a kind (${OPERATION_KINDS.join(", ")}) nor an operation`,
          );
        }
        for (const name of named) this.widen(name, folders);
      }
    });
  }

  private widen(name: OperationName, folders: string[] | undefined): void {
    const scope = this.scopes.get(name) as Scope;
    if (scope.everywhere) return;
    // A folder of "" is the vault root, which is everywhere.
    if (!folders || folders.includes("")) this.scopes.set(name, { everywhere: true });
    else scope.folders.push(...folders);
  }

  scope(op: OperationName): Scope {
    return this.scopes.get(op) as Scope;
  }

  /** Whether `op` may run at all, anywhere. */
  allows(op: OperationName): boolean {
    const scope = this.scope(op);
    return scope.everywhere || scope.folders.length > 0;
  }

  /** Whether `op` may reach this vault-relative path. */
  reaches(op: OperationName, path: string): boolean {
    const scope = this.scope(op);
    if (scope.everywhere) return true;
    const normalized = vaultPath(path);
    return normalized !== undefined && scope.folders.some((prefix) => normalized.startsWith(prefix));
  }

  /** Refuse `op` unless it may run, and reach every path given, before anything is touched. */
  check(op: OperationName, paths: string[] = []): void {
    if (!this.allows(op)) throw new PermissionError(`this vault's mask does not allow ${op}`);
    const outside = paths.find((path) => !this.reaches(op, path));
    if (outside !== undefined) throw new PermissionError(`this vault's mask does not allow ${op} on ${outside}`);
  }
}
