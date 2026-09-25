.PHONY: install check validate build node-smoke format corpus

install: ## Install dependencies from the lockfile and check out the CI corpus
	bun install --frozen-lockfile
	git submodule update --init --depth 1 packages/core/test/vaults/kepano-obsidian

check: ## Pre-commit gate: Biome lint and format, types, Markdown, spelling, tests
	bun run lint
	bun run typecheck
	rumdl check .
	typos
	bun test

validate: check build ## Pre-PR gate: check, then run the compiled binary against the fixture vault
	packages/core/dist/neiro --vault packages/core/test/fixtures/vault nav --json > /dev/null
	packages/core/dist/neiro --vault packages/core/test/fixtures/vault search "cognitive load" --json > /dev/null

node-smoke: ## Run the read commands on Node, and import the built package there, requiring Bun's output
	bun run --cwd packages/core build:lib
	bun packages/core/test/node-smoke.ts

build: ## Compile the CLI into one binary at dist/neiro, and the library into JavaScript and declarations at dist/lib
	bun run --cwd packages/core build
	bun run --cwd packages/core build:lib

format: ## Apply Biome and rumdl formatting
	bun run format
	rumdl fmt .

corpus: ## Check out the opt-in obsidian-help corpus (about 635 MB), which bun test then includes
	git -c submodule.test/vaults/obsidian-help.update=checkout submodule update --init --depth 1 packages/core/test/vaults/obsidian-help
