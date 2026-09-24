.PHONY: install check validate build format

install: ## Install dependencies from the lockfile
	bun install --frozen-lockfile

check: ## Pre-commit gate: lint, typecheck, test
	bun run lint && bun run typecheck && bun test

validate: check build ## Pre-PR gate: check, then run the compiled binary against the fixture vault
	./dist/neiro --vault test/fixtures/vault nav --json > /dev/null
	./dist/neiro --vault test/fixtures/vault search "cognitive load" --json > /dev/null

build: ## Compile the CLI into one binary at dist/neiro
	bun run build

format: ## Apply Biome formatting and safe fixes
	bun run format
