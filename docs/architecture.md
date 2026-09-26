# CommonGround Bot architecture

## Consensus boundary

CommonGround deliberately does not inspect or send every Discord message
through GenLayer. It is report-driven: an ordinary message produces no rule
evaluation, database case, or blockchain transaction.

- **Discord and the bot backend own:** Discord authentication, role checks,
  command handling, report intake, local deterministic checks, caching, queues,
  retries, and executing Discord moderation actions.
- **The Intelligent Contract owns:** finalized rule-set versions, immutable
  rule snapshots, contextual case evidence, validator-backed decisions, appeal
  history, and the action selected by the pinned rule.
- **Discord owns:** the source message and server/channel permissions. Discord is
  centralized and can delete or edit source data, so each case pins a content
  hash and an exact text snapshot.

GenLayer is required only when a natural-language rule needs contextual
interpretation. Exact URL, keyword, repetition, punctuation, mention, and rate
thresholds are deterministic and remain in the local rule engine.

## End-to-end flow

1. A Discord administrator runs `/rule add-rule`.
2. The bot verifies Discord permissions and displays an exact preview.
3. The administrator confirms the preview.
4. The backend writes the rule to the Intelligent Contract through a dedicated
   relayer wallet and persists the returned transaction ID immediately.
5. The worker waits for successful finalization, then refreshes its
   `LATEST_FINAL` rule cache.
6. Ordinary messages are ignored. Any server member can start a review by
   replying to a message with `@CommonGround report`, using `/report` with its
   Discord link, or choosing `Report to CommonGround` from the message menu.
7. The backend loads the finalized active rules and chooses the relevant rule.
   The member never has to know or enter a rule ID.
8. A deterministic match, such as an unsolicited invite or mass mention, uses
   the configured action immediately. A hybrid detector match or the server's
   contextual fallback rule opens a GenLayer case.
9. The backend opens the case using the exact active rule version, message hash,
   bounded context, and optional reporter context. The reported message is sent
   as the primary evidence. If it was a Discord reply, the replied-to message is
   fetched explicitly and labeled, even when it is older than the nearby-message
   window. Up to three nearby messages before and after are also included with
   pseudonymous speaker labels; nearby bot output and the report command itself
   are excluded.
10. The worker calls `adjudicate_case` and tracks the submitted transaction
    through finalization.
11. Validators independently return `allowed`, `violation`, or
    `needs_context`. Only that enum is authoritative; free-form analysis is
    explicitly non-authoritative.
12. After successful finalization, the bot performs the rule's predetermined
    Discord action and posts an audit record in the originating server.
13. One appeal can trigger a fresh adjudication while preserving the original
    ruling.

## Default-rule lifecycle

`/rule setup` registers a new server and then installs the starter pack one
finalized transaction at a time. `/rule install-defaults` repairs a partial
installation without changing customized rules. Supplying
`replace-existing:true` intentionally creates new versions from the latest
pack. `/rule edit-rule` uses the same contract `update_rule` method for custom
changes, so old versions and cases pinned to them remain auditable.

## Privacy boundary

Contract storage and transaction calldata must be treated as public. The bot
therefore accepts reports only when Discord confirms that the channel is
visible to the server's `@everyone` role. Private threads, DMs, private staff
channels, and sensitive personal data are rejected before case creation. A
deployment can further restrict its configured test server with a channel
allowlist without blocking public channels in other installed servers. The
`/report` reason field warns that its text becomes part of the public GenLayer
case. User, guild, channel, and message identifiers are
hashed before they are written on-chain, but message text sent for validator
review is necessarily visible to validators and chain observers.

## Authorization model

The MVP uses a dedicated service/relayer wallet as the contract owner. Discord
administrators are authenticated by Discord, while the contract accepts writes
only from the service wallet. This is an explicit bridge trust assumption, not
full decentralization.

A later version can bind Discord administrators to wallets and require signed
or multi-party rule changes without changing the moderation case model.

## Failure model

- Every submitted transaction ID is persisted before waiting.
- Timeouts resume tracking the existing transaction; they never trigger a blind
  duplicate write.
- A message/rule pair has one deterministic case ID, so repeated member reports
  reuse the existing case instead of creating duplicate transactions.
- Discord actions are idempotent by case ID and finalized decision revision.
- Contextual deletion happens only after a successful finalized transaction.
- Cases retain the rule snapshot that was active when the case was opened.
