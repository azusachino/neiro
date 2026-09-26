.PHONY: install check validate build node-smoke pack publish format corpus

install: ## Install dependencies from the lockfile and check out the CI corpus
	bun install --frozen-lockfile
	git submodule update --init --depth 1 tests/vaults/kepano-obsidian

check: ## Pre-commit gate: Biome lint and format, types, Markdown, spelling, tests
	bun run lint
	bun run typecheck
	rumdl check .
	typos
	bun test

validate: check build ## Pre-PR gate: check, then run the compiled binary against the fixture vault
	dist/tsuzuri --vault tests/fixtures/vault nav --json > /dev/null
	dist/tsuzuri --vault tests/fixtures/vault search "cognitive load" --json > /dev/null

node-smoke: ## Run the read commands on Node, then run the package and its two commands from a node_modules install, requiring Bun's output
	bun run build:lib
	bun tests/node-smoke.ts

build: ## Compile tsuzuri into one binary at dist/tsuzuri, and the package into JavaScript at dist/lib
	bun run build
	bun run build:lib

pack: ## Pack tsuzuri into dist/pack, the tarball npm and each GitHub release carry
	rm -rf dist/pack
	# bun pm pack does not run prepack, so build the JavaScript and declarations Node and tsc need first
	bun run build:lib
	bun pm pack --destination dist/pack
	tar -tzf dist/pack/tsuzuri-[0-9]*.tgz | grep -q package/dist/lib/index.d.ts
	tar -tzf dist/pack/tsuzuri-[0-9]*.tgz | grep -q package/dist/lib/tools.d.ts
	tar -tzf dist/pack/tsuzuri-[0-9]*.tgz | grep -q package/README.md
	! tar -tzf dist/pack/tsuzuri-[0-9]*.tgz | grep -q -e '\.test\.ts$$' -e '^package/tests/'

# Needs `npm login` as the package owner; npm asks for a one-time password when 2FA is on.
publish: pack ## Publish the packed tarball to npm, after the release is tagged
	npm publish dist/pack/tsuzuri-[0-9]*.tgz

format: ## Apply Biome and rumdl formatting
	bun run format
	rumdl fmt .

corpus: ## Check out the opt-in obsidian-help corpus (about 635 MB), which bun test then includes
	git -c submodule.test/vaults/obsidian-help.update=checkout submodule update --init --depth 1 tests/vaults/obsidian-help
