.PHONY: install check validate build node-smoke format corpus

install: ## Install dependencies from the lockfile and check out the CI corpus
	bun install --frozen-lockfile
	git submodule update --init --depth 1 test/vaults/kepano-obsidian

check: ## Pre-commit gate: Biome lint and format, types, Markdown, spelling, tests
	bun run lint
	bun run typecheck
	rumdl check .
	typos
	bun test

validate: check build ## Pre-PR gate: check, then run the compiled binary against the fixture vault
	./dist/neiro --vault test/fixtures/vault nav --json > /dev/null
	./dist/neiro --vault test/fixtures/vault search "cognitive load" --json > /dev/null

# The SDK's read commands, each run with --json against the fixture vault.
SMOKE = "nav" "nav Topics" "list --tag psychology/memory" "search cognitive load" "get clt" "links clt" "backlinks clt" \
	"unresolved" "journal day --date 2026-09-16" "journal week --date 2026-09-16"

node-smoke: ## Run the read commands on Node and require the same output as on Bun
	@mkdir -p dist
	@set -e; for args in $(SMOKE); do \
	  echo "node src/cli.ts $$args"; \
	  bun src/cli.ts --vault test/fixtures/vault $$args --json > dist/smoke-bun.json; \
	  node src/cli.ts --vault test/fixtures/vault $$args --json > dist/smoke-node.json; \
	  diff -u dist/smoke-bun.json dist/smoke-node.json; \
	done

build: ## Compile the CLI into one binary at dist/neiro
	bun run build

format: ## Apply Biome and rumdl formatting
	bun run format
	rumdl fmt .

corpus: ## Check out the opt-in obsidian-help corpus (about 635 MB), which bun test then includes
	git -c submodule.test/vaults/obsidian-help.update=checkout submodule update --init --depth 1 test/vaults/obsidian-help
