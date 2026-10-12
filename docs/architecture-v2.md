# CommonGround v2 boundary and rollout

Discord report -> permission-checked public snapshot -> exact evidence digest
and expected rule version -> CaseCourt validator comparison of the decision enum
-> finalized decision -> bounded application appeal window -> Discord execution
-> separately labelled executor-reported action receipt.

## Components

- CommunityRegistry: versioned rules, guild administrator, revocable per-guild
  case relayer and policy editor. Registration remains a trusted Discord bridge.
  A policy-editor grant is explicit, time bounded, and never grants admin powers.
- CaseCourt: validates evidence bytes and rule version; accepts one defense before
  a fixed deadline; permits bounded missing-context supplements without consuming
  the single appeal; delays irreversible contextual actions while an appeal can
  be made. Only the decision enum is consensus-authoritative, not model prose.
- EnforcementLedger: source-authenticated finalized decision receipts and a
  separate stream of executor-reported Discord action outcomes. The latter are
  not cryptographic proof of Discord execution. Finalized callbacks are
  idempotent and have an explicit recovery method.
- Bot + PostgreSQL: Discord identities/permissions, evidence capture, durable
  workflow states, worker leases, idempotent steps, and reconciliation. Unknown
  transaction outcomes are pending, not permission to issue another write.
- Website: public, bounded, read-only finalized case/receipt explorer. The
  separate rule-delegation action is a wallet-signed write; no private signing
  key is handled by the site. No raw Discord IDs or database bindings are
  returned by the public case API.

## Trust and privacy

Validators review a bot-attested snapshot; Discord does not provide independently
verifiable signed message content. A valid hash proves integrity, not authenticity.
The identifier digests are unsalted and can be correlated when an ID is already
known; they are not anonymization. Only opted-in public channels are accepted.
Public Discord is not permission to publish arbitrary personal information; the
UI warns about on-chain permanence. The service must not claim private evidence,
trustless capture, or exactly-once Discord delivery. Deleted messages cannot be
restored on appeal.

## Compatibility and acceptance criteria

The old contract and evidence stay immutable. New cases use v2; legacy cases
remain readable. Rollout requires lint, direct guards, consensus paths, hash/source
readback, durable-store tests, bot command tests, and production desktop/mobile
API checks. The portal update must distinguish new verified evidence from older
historical receipts and document remaining trust assumptions.
