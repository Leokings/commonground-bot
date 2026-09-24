# Northflank deployment

CommonGround runs as an always-on Northflank service. The container exposes a
small HTTP endpoint for platform health checks while the Discord Gateway
connection remains the moderation transport.

## Live deployment

- Public health URL: <https://p01--commonground-bot--2tgdv5n7tzkj.code.run/health>
- GitHub repository: <https://github.com/Leokings/commonground-bot>
- Container image: `ghcr.io/leokings/commonground-bot:latest`
- Northflank project: `plain3rd`
- Service: `commonground-bot`
- PostgreSQL addon: `commonground-db`
- Secret group: `commonground-secrets`

## Live verification

Verified on 24 September 2026:

- The public health endpoint returned HTTP `200` with
  `{"service":"commonground-bot","ready":true,"network":"studionet"}`.
- Northflank reported the service as running and the hosted process logged
  `CommonGround bot is ready`.
- The local development bot was stopped before the hosted verification, so the
  Discord response could only have come from the Northflank deployment.
- Running `/rule install-defaults replace-existing:true` in the configured
  Discord test server finalized the editable six-rule starter pack while
  preserving the custom `no-unapproved-links` rule.
- A non-targeted profanity example was finalized as `allowed` and remained
  visible. A targeted insult was finalized as `violation`, deleted, and recorded
  in the moderation channel. Both decisions came from the deployed GenLayer
  contract rather than a hard-coded word-list outcome.
- The live transaction and case evidence is recorded in
  [`live-verification.md`](./live-verification.md).

## Service

- Build type: Dockerfile
- Dockerfile: `/Dockerfile`
- Port: `8080` (HTTP)
- Health path: `/health`
- Start command: provided by the Dockerfile

The root endpoint returns public service readiness only. It never returns the
Discord token, signing key, guild identifiers, or database credentials.

## Required variables

Configure these as Northflank secrets rather than committing them:

- `DISCORD_BOT_TOKEN`
- `DISCORD_CLIENT_ID`
- `DISCORD_TEST_GUILD_ID`
- `DISCORD_MOD_LOG_CHANNEL_ID`
- `DISCORD_MONITORED_CHANNEL_IDS`
- `GENLAYER_PRIVATE_KEY`
- `GENLAYER_NETWORK=studionet`
- `GENLAYER_CONTRACT_ADDRESS`
- `DATABASE_URL` from the project PostgreSQL addon
- `PORT=8080`

The database makes submitted transaction recovery and Discord case bindings
survive container restarts. The GenLayer contract remains the canonical store
for rules and finalized decisions.

The hosted bot is report-driven. It ignores every ordinary message and starts a
check only after a member explicitly reports a message. `AUTO_SUBMIT_HYBRID` is
retained as a backwards-compatible environment variable but no longer enables
background message scanning.
