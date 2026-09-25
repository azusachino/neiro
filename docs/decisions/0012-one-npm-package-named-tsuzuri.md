# 0012 one npm package, named tsuzuri

Status: accepted, 2026-09-26 (0.7.0). Supersedes [ADR 0010](0010-agent-tools-as-an-extension-package.md)'s separate package.

## context

0.6.0 released `neiro` and `neiro-tools` as two private packages of one workspace, attached to GitHub releases as tarballs. A consumer depended on both tarball URLs and pinned `neiro` in `overrides`, because `neiro-tools`' own dependency on `neiro@0.6.0` would otherwise resolve from npm. A Git dependency did not work at all: Bun installs the workspace root, which has no exports, and cannot install a subdirectory. Neither package could be run with `npx` or `bunx`.

The owner wants the CLI on npm, runnable as `npx <name>` and `bunx <name>`, and its skill installable by general coding agents. The owner chose to rename the project for that release.

## decision

- **The project is renamed tsuzuri** (綴り, "to write, to bind pages"): the package, the `tsuzuri` command, the `tsuzuri.toml` settings file, the `TSUZURI_VAULT` variable, `TsuzuriError`, the `tsuzuri_` tool names, the skill, and the repository. No old name is read as a fallback: 0.7.0 is a breaking release, and its two known consumers change with it.
- **One package.** The agent tools become the `tsuzuri/tools` subpath of the same package, and `tsuzuri-tools` its second command. `src/tools.ts` still imports only the prelude in `src/index.ts`, so the rule that the tools use nothing a consumer cannot is kept; a contract test imports both entries.
- **Published to npm** from `packages/core`, public, with the built `dist/lib` for Node and the TypeScript source for Bun. `npx tsuzuri` and `bunx tsuzuri` run the CLI; `npx -p tsuzuri tsuzuri-tools` prints the tool definitions.
- **The skill** moves to `skills/tsuzuri/SKILL.md`, the path the `skills` installer searches, so `npx skills add azusachino/tsuzuri` installs it. It tells an agent without the command installed to run it through `npx` or `bunx`.

## alternatives considered

- **Keep the name and publish `neiro`**, which was free on npm: the owner chose a new name; "neiro" is also the name of a widely traded meme coin.
- **Publish under a scope, `@azusachino/neiro`**: rejected; `npx @azusachino/neiro` is clumsy to type.
- **Two npm packages**, as ADR 0010 had them: rejected by the owner. The separation cost every consumer a second dependency kept at the same version, and the reason for it, that a consumer without a model should not carry tool code, is served by a subpath it never imports: the tools add about 20 KB and no dependencies.

## consequences

A consumer installs one package from npm with no credentials, and imports `tsuzuri` or `tsuzuri/tools`. Every name a consumer used changes at once, so the 0.7.0 release notes list each rename. The tools version with the SDK by construction. The CHANGELOG entries and ADRs before this one keep the name neiro, as records of their time.
