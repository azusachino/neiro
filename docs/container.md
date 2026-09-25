# running neiro in a container

A bot or agent that reads and writes a vault from a container works on a Git clone of the vault, never on the owner's working copy. The owner keeps editing in Obsidian and syncing through Git; the container pulls before it reads and pushes after it writes, one commit per write. The steps below are exercised by `test/container.test.ts` against a temporary bare remote.

## 1. a deploy key for one repository

Create a key pair for this one consumer and add the public key as a deploy key on the vault's repository only, never as a user key:

```sh
ssh-keygen -t ed25519 -N "" -C "vault-bot" -f vault_deploy_key
```

Grant write access only if the consumer writes (`capture`, `append`, the tools with `push`). A reader needs read access alone. Store the private key as a secret, such as a Kubernetes `Secret` mounted read-only, and nowhere in an image.

## 2. an image with Bun, Git, and SSH

neiro runs on Bun or Node and needs `git` and `ssh` for history:

```dockerfile
FROM oven/bun:1-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends git openssh-client ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production
COPY . .
CMD ["bun", "src/main.ts"]
```

## 3. clone at startup, as the bot

Clone into a writable volume with the deploy key, and give commits the bot's identity so the owner can tell its commits apart:

```sh
export GIT_SSH_COMMAND="ssh -i /secrets/vault_deploy_key -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new"
git clone git@github.com:OWNER/VAULT.git /data/vault
git -C /data/vault config user.name "vault-bot"
git -C /data/vault config user.email "vault-bot@example.com"
```

Pin the host key in `known_hosts` instead of `accept-new` when the image can carry it.

## 4. pull before reads, push after writes

Open the clone once and keep the `Vault` for the life of the process:

```ts
import { agentTools, Vault } from "neiro";

const vault = new Vault("/data/vault", { watch: 5000 });

await vault.sync(); // before a burst of reads: pull the owner's changes, then reload
const today = await vault.journalFor("day");

await vault.capture({ text, tags: ["inbox"] }, { push: true, author: "vault-bot <vault-bot@example.com>" });

const tools = agentTools(); // for a model; run each call with the consumer's policy:
// await tool.run(vault, input, { push: true, author: "vault-bot <vault-bot@example.com>" });
```

- `watch` rescans when the notes' modification times change, at most once per interval, so edits arriving by other means are seen without a rescan on every read.
- `push: true` pulls with rebase before writing, commits the one note, and pushes. `capture` only ever creates a new file, so its rebase does not conflict with the owner's edits.
- A targeted write passes the `hash` from `get` as `ifHash`; if the owner changed the note since, the write is refused with `WriteConflictError` instead of overwriting their change. Read the note again and retry.
- A failed pull or push raises `HistoryError`. The local commit stays; call `await vault.sync()` to retry.

## 5. what the container must not do

- Edit the owner's working copy, or share a clone with another writer.
- Hold a user key or a key that opens other repositories.
- Force-push, rebase shared history, or delete notes; neiro has no verb for any of these.
