from __future__ import annotations

import json


CONTRACT = "contracts/discord_constitution.py"
GENVM_VERSION = "v0.2.16"
GUILD_KEY = "sha256:discord-guild-123"
PROMPT = r"(?s).*ROLE: COMMON_GROUND_DISCORD_RULE_REVIEWER.*"


def deploy(direct_vm, direct_deploy, owner):
    direct_vm.sender = owner
    # Keep direct tests on the runtime used by the deployed contract. The
    # test runner otherwise follows GitHub's latest tag, which can be a
    # pre-release with a differently named artifact bundle.
    return direct_deploy(CONTRACT, sdk_version=GENVM_VERSION)


def register(contract, direct_vm, owner):
    direct_vm.sender = owner
    return contract.register_guild(GUILD_KEY, "CommonGround Test Guild")


def add_contextual_rule(contract, direct_vm, owner, *, rule_id="respect"):
    direct_vm.sender = owner
    return contract.add_rule(
        GUILD_KEY,
        rule_id,
        "No targeted abuse",
        "Messages intended to demean, threaten, or drive another member away are prohibited.",
        "hybrid",
        json.dumps(
            {
                "kind": "profanity",
                "terms": ["fuck", "shit"],
                "normalization": ["casefold", "unicode", "leet"],
            }
        ),
        json.dumps(
            {
                "allow": [
                    "good-faith quotation",
                    "non-targeted positive expression",
                ]
            }
        ),
        json.dumps({"channels": ["public"], "exclude": ["private", "dm"]}),
        "delete_and_warn",
        True,
    )


def open_case(
    contract,
    direct_vm,
    owner,
    *,
    case_id="case-001",
    message_text="Nobody here wants you. You should disappear.",
    context="The author repeated this statement after the recipient asked them to stop.",
    challenge_reason="The message appears intended to drive another member away.",
):
    direct_vm.sender = owner
    return contract.open_case(
        case_id,
        GUILD_KEY,
        "respect",
        "sha256:message-001",
        message_text,
        context,
        challenge_reason,
    )


def test_register_guild_and_owner_only_access(
    direct_vm, direct_deploy, direct_alice, direct_bob
):
    contract = deploy(direct_vm, direct_deploy, direct_alice)

    direct_vm.sender = direct_bob
    with direct_vm.expect_revert("Only the service owner may write"):
        contract.register_guild(GUILD_KEY, "Unauthorized")

    guild = register(contract, direct_vm, direct_alice)
    assert guild["guild_key"] == GUILD_KEY
    assert guild["constitution_version"] == 0
    assert contract.get_stats()["guilds"] == 1

    with direct_vm.expect_revert("Guild is already registered"):
        contract.register_guild(GUILD_KEY, "Duplicate")


def test_add_update_list_and_disable_rule(
    direct_vm, direct_deploy, direct_alice
):
    contract = deploy(direct_vm, direct_deploy, direct_alice)
    register(contract, direct_vm, direct_alice)

    first = add_contextual_rule(contract, direct_vm, direct_alice)
    assert first["version"] == 1
    assert first["constitution_version"] == 1
    assert first["mode"] == "hybrid"
    assert first["appeal_allowed"] is True
    assert json.loads(first["detector_json"])["kind"] == "profanity"

    rules = contract.list_rules(GUILD_KEY)
    assert [rule["rule_id"] for rule in rules] == ["respect"]

    direct_vm.sender = direct_alice
    updated = contract.update_rule(
        GUILD_KEY,
        "respect",
        "No targeted abuse or threats",
        "Messages intended to demean, threaten, or drive another member away are prohibited.",
        "contextual",
        "{}",
        json.dumps({"allow": ["good-faith quotation"]}),
        json.dumps({"channels": ["public"]}),
        "delete_and_strike",
        True,
    )
    assert updated["version"] == 2
    assert updated["constitution_version"] == 2
    assert contract.get_rule(GUILD_KEY, "respect", 1)["action"] == "delete_and_warn"
    assert contract.get_rule(GUILD_KEY, "respect", 0)["action"] == "delete_and_strike"

    disabled = contract.disable_rule(GUILD_KEY, "respect")
    assert disabled["active"] is False
    assert contract.list_rules(GUILD_KEY)[0]["active"] is False

    stats = contract.get_stats()
    assert stats["rules"] == 1
    assert stats["rule_versions"] == 2


def test_rejects_invalid_configuration_and_automatic_cases(
    direct_vm, direct_deploy, direct_alice
):
    contract = deploy(direct_vm, direct_deploy, direct_alice)
    register(contract, direct_vm, direct_alice)
    direct_vm.sender = direct_alice

    with direct_vm.expect_revert("Detector configuration must be valid JSON"):
        contract.add_rule(
            GUILD_KEY,
            "broken",
            "Broken",
            "A valid-looking rule with broken detector configuration.",
            "automatic",
            "not-json",
            "{}",
            "{}",
            "warn",
            False,
        )

    contract.add_rule(
        GUILD_KEY,
        "no-links",
        "No links",
        "External links are prohibited.",
        "automatic",
        json.dumps({"kind": "link"}),
        "{}",
        "{}",
        "delete",
        False,
    )

    with direct_vm.expect_revert(
        "Automatic rules do not require contextual cases"
    ):
        contract.open_case(
            "case-auto",
            GUILD_KEY,
            "no-links",
            "sha256:auto",
            "https://spam.example",
            "",
            "Contains a prohibited link.",
        )


def test_case_pins_rule_version_and_accepts_one_defense(
    direct_vm, direct_deploy, direct_alice
):
    contract = deploy(direct_vm, direct_deploy, direct_alice)
    register(contract, direct_vm, direct_alice)
    add_contextual_rule(contract, direct_vm, direct_alice)
    case = open_case(contract, direct_vm, direct_alice)

    assert case["rule_version"] == 1
    assert case["rule_snapshot"]["name"] == "No targeted abuse"
    assert case["decision"] == "pending"

    direct_vm.sender = direct_alice
    contract.update_rule(
        GUILD_KEY,
        "respect",
        "Updated rule",
        "A materially changed future rule.",
        "contextual",
        "{}",
        "{}",
        "{}",
        "warn",
        True,
    )
    pinned = contract.get_case("case-001")
    assert pinned["rule_version"] == 1
    assert pinned["rule_snapshot"]["name"] == "No targeted abuse"

    defended = contract.submit_defense(
        "case-001", "I was quoting a line from a fictional scene."
    )
    assert defended["author_defense"].startswith("I was quoting")

    with direct_vm.expect_revert("Defense was already submitted"):
        contract.submit_defense("case-001", "Second defense")


def test_adjudication_records_authoritative_decision(
    direct_vm, direct_deploy, direct_alice
):
    contract = deploy(direct_vm, direct_deploy, direct_alice)
    register(contract, direct_vm, direct_alice)
    add_contextual_rule(contract, direct_vm, direct_alice)
    open_case(contract, direct_vm, direct_alice)

    direct_vm.mock_llm(
        PROMPT,
        json.dumps(
            {
                "decision": "RULE_VIOLATION",
                "analysis": "The statement targets a member and tells them to leave.",
            }
        ),
    )
    direct_vm.sender = direct_alice
    decision = contract.adjudicate_case("case-001")

    assert decision["decision"] == "violation"
    assert decision["kind"] == "initial"
    stored = contract.get_case("case-001")
    assert stored["status"] == "decided"
    assert stored["decision_revision"] == 1
    assert stored["decision_history"][0]["analysis_provenance"] == (
        "leader_output_non_authoritative"
    )
    assert contract.get_stats()["decisions"] == 1

    with direct_vm.expect_revert("Case is not ready for adjudication"):
        contract.adjudicate_case("case-001")


def test_one_appeal_preserves_history(
    direct_vm, direct_deploy, direct_alice
):
    contract = deploy(direct_vm, direct_deploy, direct_alice)
    register(contract, direct_vm, direct_alice)
    add_contextual_rule(contract, direct_vm, direct_alice)
    open_case(contract, direct_vm, direct_alice)

    direct_vm.mock_llm(
        PROMPT,
        json.dumps({"decision": "violation", "analysis": "Targeted abuse."}),
    )
    direct_vm.sender = direct_alice
    contract.adjudicate_case("case-001")

    direct_vm.clear_mocks()
    direct_vm.mock_llm(
        PROMPT,
        json.dumps(
            {
                "verdict": "allowed",
                "reason": "The additional defence establishes a quoted fictional line.",
            }
        ),
    )
    appeal = contract.appeal_case(
        "case-001", "The line was quoted from a fictional role-play scene."
    )
    assert appeal["decision"] == "allowed"
    assert appeal["kind"] == "appeal"

    stored = contract.get_case("case-001")
    assert stored["status"] == "appealed"
    assert stored["appeal_count"] == 1
    assert stored["decision_revision"] == 2
    assert [item["decision"] for item in stored["decision_history"]] == [
        "violation",
        "allowed",
    ]

    with direct_vm.expect_revert("Only a decided case can be appealed"):
        contract.appeal_case("case-001", "Try again")


def test_same_profanity_can_be_allowed_or_violate_based_on_context(
    direct_vm, direct_deploy, direct_alice
):
    contract = deploy(direct_vm, direct_deploy, direct_alice)
    register(contract, direct_vm, direct_alice)
    add_contextual_rule(contract, direct_vm, direct_alice)

    open_case(
        contract,
        direct_vm,
        direct_alice,
        case_id="case-positive",
        message_text="Fuck, this is so great!",
        context="The member is celebrating another member's successful launch.",
        challenge_reason="A profanity candidate was detected.",
    )
    direct_vm.mock_llm(
        r"(?s).*Fuck, this is so great.*",
        json.dumps(
            {
                "decision": "allowed",
                "analysis": "The profanity is non-targeted praise, an explicit exception.",
            }
        ),
    )
    direct_vm.sender = direct_alice
    positive = contract.adjudicate_case("case-positive")
    assert positive["decision"] == "allowed"

    direct_vm.clear_mocks()
    open_case(
        contract,
        direct_vm,
        direct_alice,
        case_id="case-insult",
        message_text="You are fucking stupid.",
        context="The message directly replies to another member during an argument.",
        challenge_reason="A profanity candidate was detected.",
    )
    direct_vm.mock_llm(
        r"(?s).*You are fucking stupid.*",
        json.dumps(
            {
                "decision": "violation",
                "analysis": "The profanity forms a direct demeaning personal attack.",
            }
        ),
    )
    direct_vm.sender = direct_alice
    insult = contract.adjudicate_case("case-insult")
    assert insult["decision"] == "violation"

    assert contract.get_case("case-positive")["message_text"] == (
        "Fuck, this is so great!"
    )
    assert contract.get_case("case-insult")["message_text"] == (
        "You are fucking stupid."
    )


def test_duplicate_case_id_is_rejected(
    direct_vm, direct_deploy, direct_alice
):
    contract = deploy(direct_vm, direct_deploy, direct_alice)
    register(contract, direct_vm, direct_alice)
    add_contextual_rule(contract, direct_vm, direct_alice)
    open_case(contract, direct_vm, direct_alice)

    with direct_vm.expect_revert("Case already exists"):
        open_case(contract, direct_vm, direct_alice)


def test_list_cases_is_recent_first_and_paginated(
    direct_vm, direct_deploy, direct_alice
):
    contract = deploy(direct_vm, direct_deploy, direct_alice)
    register(contract, direct_vm, direct_alice)
    add_contextual_rule(contract, direct_vm, direct_alice)
    open_case(contract, direct_vm, direct_alice, case_id="case-001")
    open_case(contract, direct_vm, direct_alice, case_id="case-002")
    open_case(contract, direct_vm, direct_alice, case_id="case-003")

    assert [case["case_id"] for case in contract.list_cases(GUILD_KEY, 0, 2)] == [
        "case-003",
        "case-002",
    ]
    assert [case["case_id"] for case in contract.list_cases(GUILD_KEY, 2, 2)] == [
        "case-001"
    ]

    with direct_vm.expect_revert("Offset cannot be negative"):
        contract.list_cases(GUILD_KEY, -1, 10)
    with direct_vm.expect_revert("Limit must be between 1 and 50"):
        contract.list_cases(GUILD_KEY, 0, 51)
