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
- GenLayer-backed contextual adjudication and one authorized, server-bound appeal;
- a case explorer with transaction links.

## Live Studio Network deployment

- Contract: `0x01858Aad8C071fE3677588C6d3b107da47d879C8`
- Public app: <https://commonground-bot.vercel.app>
- Install in Discord: <https://discord.com/oauth2/authorize?client_id=1552600187556462652&permissions=76800&integration_type=0&scope=bot%20applications.commands>
- Hosted bot health: <https://p01--commonground-bot--2tgdv5n7tzkj.code.run/health>
- Network: GenLayer Studio Network (`61999`)
- Live state: seven active rules and multiple version-pinned decisions

The public reviewer app includes the normal first-time flow, a Remotion product
walkthrough, a context-routing demo, and direct explorer evidence. See
[`docs/reviewer-guide.md`](docs/reviewer-guide.md) for the shortest live test and
[`docs/live-verification.md`](docs/live-verification.md) for lifecycle links.

See [`docs/architecture.md`](docs/architecture.md) for the trust boundary and
end-to-end flow.

## Repository layout

```text
contracts/       GenLayer Intelligent Contract
tests/direct/    fast contract tests
apps/bot/        Discord bot and transaction worker
apps/web/        public reviewer app, Canvas visual, and Remotion walkthrough
packages/core/   shared rule engine and schemas
docs/            architecture, setup, and operations
```

The reviewer app is deployed separately from the always-on bot so each surface
can use the hosting model that fits it best.

## Security

Never commit Discord tokens, database credentials, or wallet private keys.
Copy `.env.example` to `.env` locally and populate secrets there.

## Verification

```powershell
npm run verify
```

The same complete verification now runs in GitHub Actions before any container
image is published.

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
- `/case status` reads cases only from the current server. `/case appeal` is
  available only to the reported-message author or a server moderator.
- Reply to a message with `@CommonGround report` for the simplest member flow.
- `/report message-link:<link>` reports a copied Discord message link.
- `Apps → Report to CommonGround` is an alternative one-click message action.

All three report paths choose the relevant active rule automatically. Ordinary,
unreported messages are ignored and produce no GenLayer transaction.

Reports are accepted only from channels visible to the server's `@everyone`
role. Private channels and private threads are rejected before any content can
be sent to GenLayer. A local allowlist can further restrict the configured test
server without blocking installations in other servers.

For contextual reviews, GenLayer receives the exact reported message plus a
bounded conversation snapshot. A Discord reply always includes its replied-to
message explicitly, along with nearby messages before and after it. Speaker IDs
are replaced with temporary labels such as `reported-author` and `member-1`.
Nearby bot output and the report command itself are excluded from that snapshot.

The starter pack and its context examples are documented in
[`docs/default-rule-pack.md`](docs/default-rule-pack.md).
