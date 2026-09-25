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
	packages/core/dist/neiro --vault packages/tests/fixtures/vault nav --json > /dev/null
	packages/core/dist/neiro --vault packages/tests/fixtures/vault search "cognitive load" --json > /dev/null

node-smoke: ## Run the read commands on Node, then run both packages from a node_modules install, requiring Bun's output
	bun run --cwd packages/core build:lib
	bun run --cwd packages/tools build:lib
	bun packages/tests/node-smoke.ts

build: ## Compile neiro into one binary at packages/core/dist/neiro, and both packages into JavaScript at dist/lib
	bun run --cwd packages/core build
	bun run --cwd packages/core build:lib
	bun run --cwd packages/tools build:lib

pack: ## Pack neiro and neiro-tools into dist/pack, the tarballs each GitHub release carries
	rm -rf dist/pack
	cd packages/core && bun pm pack --destination ../../dist/pack
	cd packages/tools && bun pm pack --destination ../../dist/pack

format: ## Apply Biome and rumdl formatting
	bun run format
	rumdl fmt .

corpus: ## Check out the opt-in obsidian-help corpus (about 635 MB), which bun test then includes
	git -c submodule.test/vaults/obsidian-help.update=checkout submodule update --init --depth 1 packages/tests/vaults/obsidian-help
