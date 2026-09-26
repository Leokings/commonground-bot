# CommonGround reviewer guide

## Public links

- App: <https://commonground-bot.vercel.app>
- Discord install: <https://discord.com/oauth2/authorize?client_id=1552600187556462652&permissions=76800&integration_type=0&scope=bot%20applications.commands>
- Source: <https://github.com/Leokings/commonground-bot>
- Intelligent Contract: <https://explorer-studio.genlayer.com/address/0x01858Aad8C071fE3677588C6d3b107da47d879C8>
- Hosted bot health: <https://p01--commonground-bot--2tgdv5n7tzkj.code.run/health>

## First-time test

1. Add CommonGround to a Discord server where you can manage the server.
2. In a public text channel, run `/rule setup` and provide a display name. This
   registers the server and installs the six-rule editable starter pack. The
   writes finalize one at a time, so initial setup can take several minutes.
3. Send a harmless context message, then send a second message as a reply. For
   example, reply to `I finally shipped the feature` with
   `Fuck, this is so great!`.
4. As any server member, reply to the second message with
   `@CommonGround report`.
5. The bot selects the relevant rule automatically. No reporter needs a rule ID.
6. For contextual language, the bot returns a case ID and GenLayer transaction
   hash, waits for finalization, and posts the final decision in the originating
   server.
7. The reported-message author or a server moderator can run `/case appeal`.
   The command waits for revision 2 and announces whether the decision changed.

CommonGround ignores ordinary messages. It checks only a message that a member
reports. Reports from private channels and private threads are rejected.

## Current appeal and recovery evidence

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
