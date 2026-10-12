# CommonGround reviewer guide

## Public links

- App: <https://commonground-bot.vercel.app>
- Discord install: <https://discord.com/oauth2/authorize?client_id=1552600187556462652&permissions=76800&integration_type=0&scope=bot%20applications.commands>
- Source: <https://github.com/Leokings/commonground-bot>
- CaseCourt: <https://explorer-studio.genlayer.com/address/0x461ea2fbA9339F099c38eF4A0c910011EAcC8483>
- CommunityRegistry: <https://explorer-studio.genlayer.com/address/0x58D98ffb1f181B5ea93EC3E7afbc7941834f96AD>
- EnforcementLedger: <https://explorer-studio.genlayer.com/address/0x6bA7eD094Cc2Bd035BDb8996b7D7D6C9bC7AACb9>
- Hosted bot health: <https://p01--commonground-bot--2tgdv5n7tzkj.code.run/health>

## First-time test

1. Add CommonGround to a Discord server where you can manage the server.
2. In a public text channel, run `/rule setup` and provide a display name plus
   an `admin-wallet` public 0x address. Use a browser or CLI wallet you control;
   never enter a private key. This
   registers the server and installs the six-rule editable starter pack. The
   writes finalize one at a time, so initial setup can take several minutes.
3. Send a harmless context message, then send a second message as a reply. For
   example, reply to `I finally shipped the feature` with
   `Fuck, this is so great!`.
4. As any server member, reply to the second message with
   `@CommonGround report`.
5. The bot selects the relevant rule automatically. No reporter needs a rule ID.
6. For contextual language, the bot returns a queued case ID. Once it opens
   on-chain, the author or a moderator can use `/case defend` before the announced
   two-minute deadline. `/case status` shows progress. After review, paste the same
   ID into the website's public case lookup and compare the decision revision.
7. A violation under an appealable rule waits five minutes before enforcement.
   Only the reported author or a moderator can use `/case appeal` before that
   deadline. An allowed case receives no penalty. Missing-context responses use
   `/case context` and do not consume the appeal.

Optional customization: the admin wallet can grant the bot rule-edit permission
for up to seven days using the website. With a CLI-owned admin wallet, select its
CLI account and call the registry's `set_roles` with the guild key, bot relayer
address, policy editor address and an expiry. To revoke editing while preserving
reports, keep the bot as case relayer, set the editor to the zero address and set
expiry to 0. See the deployment manifest for this test server's public addresses.

The admin wallet belongs to one server's rule settings. Other server owners
choose their own wallet; members need only Discord. The bot attests Discord
identity and evidence authenticity; hashes prove byte integrity, not authenticity.

CommonGround ignores ordinary messages. It checks only a message that a member
reports. Reports from private channels and private threads are rejected.

## Current v2 evidence

The [live verification record](live-verification.md) documents the real Discord
report, finalized allowed revision, separate decision/action ledger readback,
restart recovery, API checks, and intentional wrong-hash rejection. The
[deployment manifest](../deployments/studionet-v2.json) pins the public addresses,
source hashes and image; [CI](https://github.com/Leokings/commonground-bot/actions/runs/38235463982)
passed 25 direct, 9 core and 79 bot tests plus eight real PostgreSQL checks.
V2 appeal/defense branches were regression-tested locally; do not interpret the
historical v1 appeal below as a new v2 network appeal.

## Historical v1 appeal and recovery evidence

- Repaired contract deployment: <https://explorer-studio.genlayer.com/tx/0x00054cbbc97eced2172550d92eada348ead2d88a4c1be49896b855ab37b66b93>
- Changed-decision case opened: <https://explorer-studio.genlayer.com/tx/0xf43ef19fc38b14911db3e3b144c713fbdaa9c47fa49c9cdce9259e7cbfabb5f9>
- Initial `violation` finalized at revision 1: <https://explorer-studio.genlayer.com/tx/0x150f6703cd480895b320e05c9bd807232fc2ccdae76b3cd9579e2e88f05437ce>
- Authorized same-server appeal changed the decision to `allowed` at revision 2: <https://explorer-studio.genlayer.com/tx/0x3c438624d8970ef677ba999c20568c8ab7781fc48e0546e9ec4969fd8b8ae180>
- Cross-server appeal rejected before consuming the appeal: <https://explorer-studio.genlayer.com/tx/0xe0c067e20956367c5a8fd7015e168827902d6f903f18fe60c3938d4f24873e4d>

Final readback for `reviewer-changed-appeal-20260926` is `allowed`, revision
`2`, appeal count `1`, with both the original and appeal decisions preserved.
The rejected cross-server attempt left its separate proof case at revision `1`
and appeal count `0`; its later valid same-server appeal then finalized.

## Earlier member-report evidence

- Case opened: <https://explorer-studio.genlayer.com/tx/0x71232b8447b3f12f1d3c98c5a0c80b9bc1991c0b6979368510563be39894a248>
- Decision finalized: <https://explorer-studio.genlayer.com/tx/0x28dd6e26d304fbfdc850a1f686c2c04f15e093e212c4bedbe2a57c96abbf4edf>

This pair demonstrates the complete member-report path with reply context. The
positive profanity example was finalized as `allowed`, showing that a matched
word is a candidate for contextual review rather than an automatic violation.

## What is on-chain

- Server rules and every rule version.
- The exact rule snapshot used for each case.
- A hash and snapshot of the reported message.
- Bounded, pseudonymized conversational context for contextual cases.
- Validator-backed decisions and one optional appeal.

Discord remains responsible for authentication, permissions, and executing the
predetermined moderation action after a decision finalizes.
