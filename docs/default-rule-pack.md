# Editable starter rule pack

CommonGround installs a useful rule set during `/rule setup`. Every rule is a
normal versioned GenLayer rule: administrators can edit it, disable it, or
restore the latest starter version without erasing history.

## Included rules

1. `no-profanity` — hybrid, context-aware review. A local word detector finds
   candidates, while GenLayer judges the complete message and nearby context.
2. `no-targeted-abuse` — contextual review for personal attacks, harassment,
   intimidation, threats, and attempts to drive somebody away.
3. `no-external-invites` — immediate removal of unsolicited Discord invites.
4. `no-message-flooding` — six messages in ten seconds.
5. `no-repeated-spam` — the same message three times in thirty seconds.
6. `no-mass-mentions` — five or more user or broadcast mentions in one message.

## Context-aware profanity

The profanity list is candidate detection, not the verdict. Both of these
messages contain the same candidate language:

- `Fuck, this is so great!` — non-targeted praise, allowed by the starter rule.
- `You are fucking stupid.` — a direct demeaning personal attack, a violation.

The active rule text and exceptions determine the outcome. A server that wants
zero-tolerance language can use `/rule edit-rule` to replace the rule text and
mode. A server that wants contextual moderation can retain the default hybrid
mode. Clearly marked quotation, education, moderation evidence, frustration at
a situation, and non-targeted emphasis are explicit starter exceptions.

## Administration

- `/rule install-defaults replace-existing:false` adds only missing rules.
- `/rule install-defaults replace-existing:true` creates a new version for
  every starter rule already present and adds any missing rules.
- `/rule edit-rule` creates a custom new version while keeping the rule ID.
- `/rule disable-rule` disables an unwanted rule.
- `/rule list` displays the finalized active version and enforcement mode.

Automatic contextual moderation requires `AUTO_SUBMIT_HYBRID=true`. Set it to
`false` only when moderators should manually submit every candidate through
**Apps → Check Rule**.
