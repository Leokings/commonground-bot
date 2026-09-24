# Live verification

CommonGround is deployed to the GenLayer Studio Network at
[`0xf8145e93E2Ab9Ea40bA39707A6Ae4b1663a88A90`](https://explorer-studio.genlayer.com/address/0xf8145e93E2Ab9Ea40bA39707A6Ae4b1663a88A90).

Every transaction below reached `FINALIZED` with `MAJORITY_AGREE`:

1. [Deploy the Intelligent Contract](https://explorer-studio.genlayer.com/tx/0xef16c8551190023d6bf9427333901cbb3d1ec680a4a470969beb6ec7b3ffcc6b)
2. [Register the demo Discord guild](https://explorer-studio.genlayer.com/tx/0x5dfff3f50ce4193cf41aa769a3089155df72b994f60ef9e318c99930f567591e)
3. [Add the external-link rule](https://explorer-studio.genlayer.com/tx/0xd2b849a46d62894ff0afa2ccd471958f1c8c6fb893dfe84a0bbe345c6ea64554)
4. [Add the targeted-abuse hybrid rule](https://explorer-studio.genlayer.com/tx/0x9525af8948927373616d441cdc1e31ff20ed856e337ba8b8d27020dbaedc32bb)
5. [Add the punctuation/flood rule](https://explorer-studio.genlayer.com/tx/0xc469e99af54b0c172b0515f24757310a72a1f8e6ece9a6fd3d11ca1db2530476)
6. [Open a version-pinned contextual case](https://explorer-studio.genlayer.com/tx/0x71ea426d63403bf7dc1a6f0a8cb6ec38926d3bb52e26604e5b15a26006d587a5)
7. [Record the message author's defence](https://explorer-studio.genlayer.com/tx/0x0e10297214b1f940570379637d19161a77872e656eb328f5409750f3a2861e5b)
8. [Finalize the validator-consensus decision](https://explorer-studio.genlayer.com/tx/0x2d07da160f6e6d998eef1103960c47a94da4300f494b7c2332f1e6cb2a49f14f)
9. [Register Plain3rd's live Discord server through the installed bot](https://explorer-studio.genlayer.com/tx/0xd8968521e66b1ce87da824a3c48b3e1d3a099a153aaad72402d25f76d598d6dc)
10. [Add the live server's unapproved-link rule](https://explorer-studio.genlayer.com/tx/0x32cbdd52f8f7be9d8a6d393648e7d9b8344b808871413ea98de60b94b7d74131)
11. [Add the live server's profanity rule](https://explorer-studio.genlayer.com/tx/0xdf514530e5ba2ed2d34cc4c1462947b608ed8509d0f5fc9a88b8b4e7448c81f1)
12. [Add the live server's targeted-abuse hybrid rule](https://explorer-studio.genlayer.com/tx/0x3e9dc25b9d0035c8bfde7db2321cce7bf42c6637f1d9c0286117bcd36cf8d86f)
13. [Open the live Discord contextual-review case](https://explorer-studio.genlayer.com/tx/0x242e1769988a7643ad08d6312dd8da0a3069e753d8a2648b4d6b0547299d65e2)
14. [Finalize the live Discord contextual-review decision](https://explorer-studio.genlayer.com/tx/0xeb225c44256dd909af9c4d754c00ea9e2e2c85135f88ac3773548123a8f97454)

The original demo-guild readback contains three active rules and one decided case.
That case is pinned to `no-targeted-abuse` version 1, includes the author's defence,
and was finalized as `violation` with an on-chain decision history. The separate
live Discord guild and its live contextual case are documented below.

## Live Discord integration

- Discord application: `Common ground` (`1552600187556462652`)
- Test server: `Plain3rd's server`
- Test channel: `#testing-channel`
- Registered command groups: `/rule`, `/case`, and `Check Rule`
- Discord API readback confirms `/constitution` was replaced rather than retained as a duplicate
- Server-registration transaction: [`0xd8968521e66b1ce87da824a3c48b3e1d3a099a153aaad72402d25f76d598d6dc`](https://explorer-studio.genlayer.com/tx/0xd8968521e66b1ce87da824a3c48b3e1d3a099a153aaad72402d25f76d598d6dc)
- Receipt: `FINALIZED`; leader execution `SUCCESS`; three agreeing validator votes and two idle/cancelled-after-quorum votes
- Final readback: active guild, rule-set version `3`, display name `Plain3rd's server`, and three active version-1 rules
- Privacy-preserving guild key: `sha256:bf2bf0aca29766a23a40bde8478dfdcfccaa8355e1d2cbe660593f19fa9b4321`

### Live rules and Discord tests

- `no-unapproved-links` — automatic `delete_and_warn`; allows official `genlayer.com` and `genlayer.foundation` links. A live message containing an unapproved `example.com` link was deleted, a direct warning was delivered, and an enforcement record appeared in `#testing-channel`.
- `no-profanity` — automatic `delete_and_warn`; detects configured profane terms, including separated and leetspeak spellings. A live disguised-profanity test message was deleted, a direct warning was delivered, and an enforcement record appeared in `#testing-channel`.
- `no-targeted-abuse` — hybrid `delete_and_warn` with appeals enabled; prohibits messages intended to demean, threaten, intimidate, or drive another member away while allowing good-faith criticism, moderation reports, and clearly marked quotations.
- `/rule list` returned all three live rules as active version 1 entries.
- The hybrid detector left the contextual test message in place and posted a `Possible rule issue` notice, as configured by `AUTO_SUBMIT_HYBRID=false`.
- A moderator used **Apps -> Check Rule** to open case `case-1552710674738585611-no-targeted-abuse`.
- GenLayer finalized the case as `violation` with decision revision `1`. The on-chain analysis found that the message directly demeaned a member and attempted to drive them away, while none of the rule's exceptions applied.
- After finalization, the bot deleted the unchanged source message, delivered a direct warning, and posted the final `CommonGround enforcement` record with the case ID.

The owner-private live dashboard is available at
[`commonground-constitution.plain3rd.chatgpt.site`](https://commonground-constitution.plain3rd.chatgpt.site).
