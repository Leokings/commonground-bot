# Northflank deployment

CommonGround runs as an always-on Northflank service. The container exposes a
small HTTP endpoint for platform health checks while the Discord Gateway
connection remains the moderation transport.

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
- `AUTO_SUBMIT_HYBRID=false`
- `DATABASE_URL` from the project PostgreSQL addon
- `PORT=8080`

The database makes submitted transaction recovery and Discord case bindings
survive container restarts. The GenLayer contract remains the canonical store
for rules and finalized decisions.
