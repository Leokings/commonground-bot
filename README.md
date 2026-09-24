# CommonGround Bot

CommonGround Bot turns a Discord server's written rules into an auditable,
member-driven moderation system. It does not scan or judge every conversation.
A check starts only when a member reports a specific message. Deterministic
rules run locally after that report, while contextual disputes are submitted to
a GenLayer Intelligent Contract that pins the applicable rule version and
records a validator-backed decision.

The first working milestone now includes:

- versioned, on-chain server rules;
- Discord slash commands for rule administration;
- a six-rule editable starter pack installed during server setup;
- context-aware profanity triage that distinguishes emphasis from targeted abuse;
- reply-and-mention, slash-command, and message-action reporting for every member;
- automatic rule selection with no rule ID required from the reporter;
- deterministic local checks only after a report;
- GenLayer-backed contextual adjudication and one appeal;
- a case explorer with transaction links.

## Live Studio Network deployment

- Contract: `0xf8145e93E2Ab9Ea40bA39707A6Ae4b1663a88A90`
- Dashboard: `https://commonground-constitution.plain3rd.chatgpt.site`
- Network: GenLayer Studio Network (`61999`)
- Live state: seven active rules and multiple version-pinned decisions

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
- Reply to a message with `@CommonGround report` for the simplest member flow.
- `/report message-link:<link>` reports a copied Discord message link.
- `Apps → Report to CommonGround` is an alternative one-click message action.

All three report paths choose the relevant active rule automatically. Ordinary,
unreported messages are ignored and produce no GenLayer transaction.

For contextual reviews, GenLayer receives the exact reported message plus a
bounded conversation snapshot. A Discord reply always includes its replied-to
message explicitly, along with nearby messages before and after it. Speaker IDs
are replaced with temporary labels such as `reported-author` and `member-1`.

The starter pack and its context examples are documented in
[`docs/default-rule-pack.md`](docs/default-rule-pack.md).
