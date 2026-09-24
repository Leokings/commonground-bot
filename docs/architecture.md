# CommonGround Bot architecture

## Consensus boundary

CommonGround deliberately does not send every Discord message through GenLayer.

- **Discord and the bot backend own:** Discord authentication, role checks,
  command handling, message delivery, local deterministic detectors, caching,
  queues, retries, and executing Discord moderation actions.
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
6. For every opted-in public message, the local rule engine evaluates automatic
   detectors.
7. Hybrid rules use local detection only as candidate triage. A match never
   proves a contextual violation; when automatic hybrid submission is enabled,
   the exact message, bounded context, pinned rule, and exceptions go to
   GenLayer.
8. A moderator can right-click a message and choose `Check Rule` for a
   contextual rule.
9. The backend opens a case using the exact active rule version, message hash,
   bounded context, and challenge reason.
10. After an optional defence window, the worker calls `adjudicate_case`.
11. Validators independently return `allowed`, `violation`, or
    `needs_context`. Only that enum is authoritative; free-form analysis is
    explicitly non-authoritative.
12. After successful finalization, the bot performs the rule's predetermined
    Discord action and posts an audit record.
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

Contract storage and transaction calldata must be treated as public. The MVP
therefore operates only in server channels explicitly opted into public rule
review. DMs, private staff channels, and sensitive personal data
must never be submitted. User, guild, channel, and message identifiers are
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
- Discord interactions are idempotent by interaction ID.
- Discord actions are idempotent by case ID and finalized decision revision.
- Contextual deletion happens only after a successful finalized transaction.
- Cases retain the rule snapshot that was active when the case was opened.
