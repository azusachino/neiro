.PHONY: install check validate build node-smoke pack format corpus

install: ## Install dependencies from the lockfile and check out the CI corpus
	bun install --frozen-lockfile
	git submodule update --init --depth 1 packages/tests/vaults/kepano-obsidian

check: ## Pre-commit gate: Biome lint and format, types, Markdown, spelling, tests
	bun run lint
	bun run typecheck
	rumdl check .
	typos
	bun test

validate: check build ## Pre-PR gate: check, then run the compiled binary against the fixture vault
	packages/core/dist/tsuzuri --vault packages/tests/fixtures/vault nav --json > /dev/null
	packages/core/dist/tsuzuri --vault packages/tests/fixtures/vault search "cognitive load" --json > /dev/null

node-smoke: ## Run the read commands on Node, then run the package and its two commands from a node_modules install, requiring Bun's output
	bun run --cwd packages/core build:lib
	bun packages/tests/node-smoke.ts

build: ## Compile tsuzuri into one binary at packages/core/dist/tsuzuri, and the package into JavaScript at dist/lib
	bun run --cwd packages/core build
	bun run --cwd packages/core build:lib

pack: ## Pack tsuzuri into dist/pack, the tarball each GitHub release carries
	rm -rf dist/pack
	# bun pm pack does not run prepack, so build the JavaScript and declarations Node and tsc need first
	bun run --cwd packages/core build:lib
	cd packages/core && bun pm pack --destination ../../dist/pack
	tar -tzf dist/pack/tsuzuri-[0-9]*.tgz | grep -q package/dist/lib/index.d.ts
	tar -tzf dist/pack/tsuzuri-[0-9]*.tgz | grep -q package/dist/lib/tools.d.ts

format: ## Apply Biome and rumdl formatting
	bun run format
	rumdl fmt .

corpus: ## Check out the opt-in obsidian-help corpus (about 635 MB), which bun test then includes
	git -c submodule.test/vaults/obsidian-help.update=checkout submodule update --init --depth 1 packages/tests/vaults/obsidian-help
