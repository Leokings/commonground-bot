# CommonGround Bot

CommonGround Bot turns a Discord server's written rules into an auditable
moderation system. Deterministic rules (links, profanity patterns, flooding,
mentions, and repeated messages) run locally for immediate enforcement.
Contextual disputes are submitted to a GenLayer Intelligent Contract, which
pins the applicable rule version and records a validator-backed decision.

The first working milestone now includes:

- versioned, on-chain server rules;
- Discord slash commands for rule administration;
- a six-rule editable starter pack installed during server setup;
- context-aware profanity triage that distinguishes emphasis from targeted abuse;
- a message-context command for opening moderation cases;
- deterministic local moderation;
- GenLayer-backed contextual adjudication and one appeal;
- a case explorer with transaction links.

## Live Studio Network deployment

- Contract: `0xf8145e93E2Ab9Ea40bA39707A6Ae4b1663a88A90`
- Dashboard: `https://commonground-constitution.plain3rd.chatgpt.site`
- Network: GenLayer Studio Network (`61999`)
- Live state: three rules, one version-pinned case, and one finalized decision

The dashboard is currently owner-private and reads the finalized contract state
at request time. See [`docs/live-verification.md`](docs/live-verification.md) for
the deployment and lifecycle transaction links.

See [`docs/architecture.md`](docs/architecture.md) for the trust boundary and
end-to-end flow.

## Repository layout

```text
contracts/       GenLayer Intelligent Contract
tests/direct/    fast contract tests
apps/bot/        Discord bot and transaction worker
packages/core/   shared rule engine and schemas
docs/            architecture, setup, and operations
```

The reviewer dashboard is deployed separately from the always-on bot so each
surface can use the hosting model that fits it best.

## Security

Never commit Discord tokens, database credentials, or wallet private keys.
Copy `.env.example` to `.env` locally and populate secrets there.

## Verification

```powershell
npm test
npm run typecheck
npm run build
python -m pytest -q tests/direct
genvm-lint check contracts/discord_constitution.py --json
```

The Discord integration can be exercised locally; a separate bot host is only
needed for continuous 24/7 operation.

For the hosted reviewer demo, the bot includes a secret-safe `/health` endpoint,
a Docker deployment, and optional PostgreSQL-backed restart recovery. See
[`docs/northflank-deployment.md`](docs/northflank-deployment.md).

## Discord commands

- `/rule setup` registers the server and installs the editable starter rules.
- `/rule install-defaults` installs missing defaults; `replace-existing:true`
  creates new on-chain versions of existing starter rules.
- `/rule add-rule` creates a versioned rule.
- `/rule edit-rule` creates a new version of an existing rule.
- `/rule list` reads the finalized active rules.
- `/rule disable-rule` disables an active rule.
- `/case status` and `/case appeal` manage moderation cases.
- `Apps → Check Rule` opens a contextual review from a Discord message.

The starter pack and its context examples are documented in
[`docs/default-rule-pack.md`](docs/default-rule-pack.md).
