# Live verification

CommonGround is deployed to the GenLayer Studio Network at
[`0xf8145e93E2Ab9Ea40bA39707A6Ae4b1663a88A90`](https://explorer-studio.genlayer.com/address/0xf8145e93E2Ab9Ea40bA39707A6Ae4b1663a88A90).

Every transaction below reached `FINALIZED`; the current explorer displays the
consensus result as `Accepted` and the GenVM execution result as `SUCCESS`:

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
15. [Update `no-profanity` to the context-aware starter rule](https://explorer-studio.genlayer.com/tx/0x7ba1e2c40b9240efeb729900199ddbc14c6139df75b6918946736a43f28caa9a)
16. [Update `no-targeted-abuse`](https://explorer-studio.genlayer.com/tx/0x80a5f3eacadb47427c8bdf6249efa8f74610142d2e7eb0225a363a73bfece9bd)
17. [Update `no-external-invites`](https://explorer-studio.genlayer.com/tx/0xf8f57dd5a27c395f641ac6badb9c779972e6bf2b77344bc19b66c001c2128d59)
18. [Update `no-message-flooding`](https://explorer-studio.genlayer.com/tx/0x62f0791022e3adc31d6198897c90fefbb94353a36022b0b01f638e583dda33ad)
19. [Update `no-repeated-spam`](https://explorer-studio.genlayer.com/tx/0x7ed3606031822033d598cab1569843ee0a0701abf53248ba68934f49327425f9)
20. [Update `no-mass-mentions`](https://explorer-studio.genlayer.com/tx/0xc070ddb31fd73f3f533e8fd9eb58dfc06fb67db4877e3adab81d8182387f9318)
21. [Open the non-targeted praise case](https://explorer-studio.genlayer.com/tx/0x7501a90210d7f9975ca16dad13140ba647baf6a45091fb12bf87b913990b00d4)
22. [Finalize the non-targeted praise case as allowed](https://explorer-studio.genlayer.com/tx/0x9e0b873db0e400efda59d4079b092c3fa96613fc58058756f73552a38029d07f)
23. [Open the targeted-insult case](https://explorer-studio.genlayer.com/tx/0xaa8416f3e6ab15efb3bdfb239c84cbc4e58526e64a6477b20f876f01955867f9)
24. [Finalize the targeted-insult case as a violation](https://explorer-studio.genlayer.com/tx/0xacc4df48fcd4bd20a0d531a555b6e2e93338d90a89ded945b6279f00ab2c2a58)
25. [Open the member-reported reply-context case](https://explorer-studio.genlayer.com/tx/0x71232b8447b3f12f1d3c98c5a0c80b9bc1991c0b6979368510563be39894a248)
26. [Finalize the member-reported reply-context case as allowed](https://explorer-studio.genlayer.com/tx/0x28dd6e26d304fbfdc850a1f686c2c04f15e093e212c4bedbe2a57c96abbf4edf)

The original demo-guild readback contains three active rules and one decided case.
That case is pinned to `no-targeted-abuse` version 1, includes the author's defence,
and was finalized as `violation` with an on-chain decision history. The separate
live Discord guild and its live contextual case are documented below.

## Live Discord integration

- Discord application: `Common ground` (`1552600187556462652`)
- Test server: `Plain3rd's server`
- Test channel: `#testing-channel`
- Registered administration commands: `/rule` and `/case`
- Discord API readback confirms `/constitution` was replaced rather than retained as a duplicate
- Server-registration transaction: [`0xd8968521e66b1ce87da824a3c48b3e1d3a099a153aaad72402d25f76d598d6dc`](https://explorer-studio.genlayer.com/tx/0xd8968521e66b1ce87da824a3c48b3e1d3a099a153aaad72402d25f76d598d6dc)
- Receipt: `FINALIZED`; leader execution `SUCCESS`; three agreeing validator votes and two idle/cancelled-after-quorum votes
- Final readback: active guild with the editable six-rule starter pack plus the
  existing custom `no-unapproved-links` rule
- Privacy-preserving guild key: `sha256:bf2bf0aca29766a23a40bde8478dfdcfccaa8355e1d2cbe660593f19fa9b4321`
- Hosted service health: [`ready: true` on Northflank](https://p01--commonground-bot--2tgdv5n7tzkj.code.run/health)

### Live rules and Discord tests

- The editable starter pack contains `no-profanity`, `no-targeted-abuse`,
  `no-external-invites`, `no-message-flooding`, `no-repeated-spam`, and
  `no-mass-mentions`. The custom `no-unapproved-links` rule remains active.
- `/rule install-defaults replace-existing:true` upgraded the six starter rules
  without replacing the server's custom link rule. `/rule edit-rule` can revise
  any installed rule later.
- `no-profanity` is deliberately context-aware. Profanity used as untargeted
  praise or emphasis can be allowed; profanity used to attack a person is a
  violation.
- Positive case `case-1552757069248069643-no-profanity`: the public message
  `Fuck, this is so great!` remained visible. GenLayer finalized it as `allowed`
  because the word was non-targeted praise/emphasis. The bot posted the allowed
  finalization notice in Discord.
- Violation case `case-1552757632115154955-no-profanity`: the public message
  `You are fucking stupid.` was finalized as `violation`. The GenLayer analysis
  identified a direct personal attack and found that no exception applied. The
  bot deleted the source message and posted the `delete_and_warn` enforcement
  record in Discord.
- The hosted gateway retries transient receipt-read failures. This prevents an
  HTML/RPC edge response from incorrectly reporting a failed Discord command
  after an otherwise successful on-chain write.
- The current member UX is report-driven: reply with `@CommonGround report`, use
  `/report` with a message link, or choose `Report to CommonGround`. The bot
  selects the rule; ordinary unreported messages are ignored.

### Live member-report and reply-context test

- A parent message, `Live context test: I finally shipped the feature.`, was
  posted, followed by the reply `Fuck, this is so great!`.
- The reply remained visible with no CommonGround response during the
  unreported observation period, confirming that ordinary messages are not
  reviewed automatically.
- A server member then replied to that exact message with
  `@Common ground report`. The bot checked seven active rules and selected
  `Context-aware profanity` without asking the member for a rule ID.
- The finalized `open_case` calldata contains the exact reported message and
  `replied-to [reported-author]: Live context test: I finally shipped the feature.`
  The reporting command itself is absent from the submitted context.
- GenLayer finalized the case as `allowed`: the validators interpreted the
  profanity as non-targeted emphasis/praise rather than an attack. The source
  message remained visible and the bot posted the decision and explanation in
  Discord.
- Open transaction:
  [`0x71232b8447b3f12f1d3c98c5a0c80b9bc1991c0b6979368510563be39894a248`](https://explorer-studio.genlayer.com/tx/0x71232b8447b3f12f1d3c98c5a0c80b9bc1991c0b6979368510563be39894a248)
- Adjudication transaction:
  [`0x28dd6e26d304fbfdc850a1f686c2c04f15e093e212c4bedbe2a57c96abbf4edf`](https://explorer-studio.genlayer.com/tx/0x28dd6e26d304fbfdc850a1f686c2c04f15e093e212c4bedbe2a57c96abbf4edf)

## Reproducible verification

The repository verification command covers GenVM linting, direct contract
execution, shared moderation logic, Discord commands, and the production build:

- 9 direct intelligent-contract tests
- 9 shared core tests
- 31 Discord-bot tests
- TypeScript type-check and production build

Run `npm run verify` from the repository root. The context regression explicitly
asserts that praise is allowed and the targeted insult is a violation.

The report-driven release was deployed on 24 September 2026 as Northflank pod
`commonground-bot-55694fbd9b-mdzmr`. Northflank showed `1/1 passing`, the bot
logged `CommonGround bot is ready`, the public health endpoint returned
`ready: true`, and Discord accepted all four current command definitions.

The owner-private live dashboard is available at
[`commonground-constitution.plain3rd.chatgpt.site`](https://commonground-constitution.plain3rd.chatgpt.site).
