# CommonGround reviewer guide

## Public links

- App: <https://commonground-bot.vercel.app>
- Discord install: <https://discord.com/oauth2/authorize?client_id=1552600187556462652&permissions=76800&integration_type=0&scope=bot%20applications.commands>
- Source: <https://github.com/Leokings/commonground-bot>
- Intelligent Contract: <https://explorer-studio.genlayer.com/address/0xf8145e93E2Ab9Ea40bA39707A6Ae4b1663a88A90>
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

CommonGround ignores ordinary messages. It checks only a message that a member
reports. Reports from private channels and private threads are rejected.

## Existing live transaction evidence

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
