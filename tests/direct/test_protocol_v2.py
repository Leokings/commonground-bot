"""Guard tests use mocked companion views; live tests exercise real messages."""
import hashlib
import json
from types import SimpleNamespace
import pytest
from pathlib import Path
from gltest.direct.loader import _allocate_contract, _calldata_roundtrip_args, _make_contract_proxy, _patch_run_nondet_for_direct_mode, load_contract_class

def deploy(path, direct_vm, direct_deploy, *args):
    contract_path = Path(path).resolve()
    direct_vm._contract_address = hashlib.sha256(str(contract_path).encode()).digest()[:20]
    contract_class = load_contract_class(contract_path, direct_vm, "v0.2.16")
    from genlayer import Address
    converted = [Address("0x" + value.hex()) if isinstance(value, bytes) and len(value) == 20 else value for value in args]
    converted, kwargs = _calldata_roundtrip_args(converted, {})
    _patch_run_nondet_for_direct_mode()
    return _make_contract_proxy(_allocate_contract(contract_class, direct_vm, *converted, **kwargs))

GUILD = "sha256:" + "a" * 64
MESSAGE = "sha256:" + "b" * 64
CHANNEL = "sha256:" + "c" * 64
AUTHOR = "sha256:" + "d" * 64
TEXT = "  Café: you are unwelcome.  "

def digest(value):
    return "sha256:" + hashlib.sha256(value.encode()).hexdigest()

def frame(values):
    return "".join(str(len(value.encode())) + ":" + value for value in values)

def starter():
    return [{"ruleId": "respect", "name": "Respect", "text": "Do not direct insults at members.",
             "mode": "contextual", "detectorJson": "{}", "exceptionsJson": "{}",
             "scopeJson": "{}", "action": "delete_and_strike", "appealAllowed": True}]

def rule():
    return {"guild_key": GUILD, "rule_id": "respect", "version": 1,
            "constitution_version": 1, "active": True, "mode": "contextual",
            "name": "Respect", "text": "Do not direct insults at members.",
            "exceptions_json": "{}", "action": "delete_and_strike", "appeal_allowed": True}

def arguments(text=TEXT, context="bounded context", reason="Community report."):
    values = [GUILD, "respect", "1", MESSAGE, CHANNEL, AUTHOR, text, context, reason]
    commitment = digest(frame(["CommonGroundEvidenceV2", *values]))
    message_hash = digest(text)
    cid = "case-" + hashlib.sha256((GUILD + "|" + MESSAGE + "|respect|1|" + message_hash).encode()).hexdigest()
    return [cid, GUILD, "respect", 1, message_hash, text, context, reason, commitment, MESSAGE, CHANNEL, AUTHOR]

@pytest.fixture
def court(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie, monkeypatch):
    direct_vm.sender = direct_alice
    direct_vm.warp("2026-10-12T00:00:00Z")
    contract = deploy("contracts/CaseCourt.py", direct_vm, direct_deploy, direct_bob, direct_charlie)
    from genlayer import gl
    companion = SimpleNamespace(authorized=True, rule=rule(), emitted=[], receipt={})
    class Fake:
        def view(self): return self
        def emit(self, **kwargs):
            assert kwargs == {"on": "finalized"}
            return self
        def can_relay_case(self, *args): return companion.authorized
        def get_rule(self, *args): return companion.rule
        def record_decision(self, payload): companion.emitted.append(json.loads(payload))
        def get_decision(self, *args): return companion.receipt
    monkeypatch.setattr(gl, "get_contract_at", lambda address: Fake())
    return contract, companion

def test_registry_guild_admin_and_default_pack(direct_vm, direct_deploy, direct_alice, direct_bob):
    direct_vm.sender = direct_alice
    contract = deploy("contracts/CommunityRegistry.py", direct_vm, direct_deploy, direct_alice, json.dumps(starter()))
    from genlayer import Address
    direct_bob = Address("0x" + direct_bob.hex())
    guild = contract.register_guild(GUILD, "Public test guild", direct_bob)
    assert guild["constitution_version"] == 1
    assert len(contract.list_rules(GUILD)) == 1
    with direct_vm.expect_revert("No active guild policy permission"):
        contract.disable_rule(GUILD, "respect", 1)
    direct_vm.sender = direct_bob
    contract.disable_rule(GUILD, "respect", 1)
    assert contract.get_rule(GUILD, "respect", 1)["active"] is True
    assert contract.get_rule(GUILD, "respect", 2)["active"] is False
    with direct_vm.expect_revert("Stale rule version"):
        contract.disable_rule(GUILD, "respect", 1)

def test_scoped_delegation_expiry_and_revocation(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie):
    direct_vm.sender = direct_alice
    direct_vm.warp("2026-10-12T00:00:00Z")
    contract = deploy("contracts/CommunityRegistry.py", direct_vm, direct_deploy, direct_alice, json.dumps(starter()))
    from genlayer import Address
    direct_bob = Address("0x" + direct_bob.hex())
    direct_alice = Address("0x" + direct_alice.hex())
    direct_charlie = Address("0x" + direct_charlie.hex())
    contract.register_guild(GUILD, "Guild", direct_bob)
    with direct_vm.expect_revert("Only the guild admin"):
        contract.set_roles(GUILD, direct_charlie, direct_alice, 1791763300)
    direct_vm.sender = direct_bob
    contract.set_roles(GUILD, direct_charlie, direct_alice, 1791763300)
    assert contract.can_relay_case(GUILD, direct_charlie)
    direct_vm.sender = direct_alice
    contract.disable_rule(GUILD, "respect", 1)
    direct_vm.warp("2026-10-12T00:02:00Z")
    with direct_vm.expect_revert("No active guild policy permission"):
        contract.disable_rule(GUILD, "respect", 2)

def test_exact_evidence_and_idempotent_open(court):
    contract, _ = court
    args = arguments()
    item = contract.open_case(*args)
    assert item["message_text"] == TEXT
    assert item["evidence_digest"] == args[8]
    assert contract.open_case(*args) == item
    assert len(contract.list_cases(GUILD, 0, 20)) == 1
    changed = arguments(reason="A different reporter.")
    with pytest.raises(Exception, match="different evidence package"):
        contract.open_case(*changed)

@pytest.mark.parametrize("index,value,expected", [
    (4, "sha256:" + "0" * 64, "Message hash mismatch"),
    (8, "sha256:" + "0" * 64, "Evidence digest mismatch"),
    (9, "not-a-hash", "Expected SHA-256"),
    (0, "case-wrong", "Case ID mismatch"),
    (3, 2, "Stale"),
])
def test_bad_commitments_rejected(court, index, value, expected):
    contract, _ = court
    args = arguments()
    args[index] = value
    with pytest.raises(Exception, match=expected): contract.open_case(*args)

def test_unauthorized_report(court):
    contract, companion = court
    companion.authorized = False
    with pytest.raises(Exception, match="No guild case permission"):
        contract.open_case(*arguments())

def test_defense_cutoff_and_initial_consensus(court, direct_vm):
    contract, companion = court
    cid = arguments()[0]
    contract.open_case(*arguments())
    with direct_vm.expect_revert("Defense window is open"):
        contract.adjudicate_case(cid, 0)
    contract.submit_defense(GUILD, cid, "A quotation for moderation evidence.")
    with direct_vm.expect_revert("Defense unavailable"):
        contract.submit_defense(GUILD, cid, "Second defense")
    direct_vm.warp("2026-10-12T00:02:00Z")
    with direct_vm.expect_revert("Defense unavailable"):
        contract.submit_defense(GUILD, cid, "Too late")
    direct_vm.mock_llm(r"(?s).*COMMON_GROUND_DISCORD_RULE_REVIEWER_V2.*", json.dumps({"decision": "violation", "analysis": "Directed insult."}))
    result = contract.adjudicate_case(cid, 0)
    assert result["decision"] == "violation"
    assert companion.emitted[0]["revision"] == 1
    assert not contract.get_enforcement(cid)["eligible"]
    direct_vm.warp("2026-10-12T00:07:00Z")
    assert contract.get_enforcement(cid)["eligible"]
    with direct_vm.expect_revert("Appeal unavailable"):
        contract.appeal_case(GUILD, cid, "Too late", 1)

def test_missing_context_is_not_an_appeal(court, direct_vm):
    contract, _ = court
    cid = arguments()[0]
    contract.open_case(*arguments())
    direct_vm.warp("2026-10-12T00:02:01Z")
    direct_vm.mock_llm(r"(?s).*COMMON_GROUND_DISCORD_RULE_REVIEWER_V2.*", '{"decision":"needs_context","analysis":"Missing parent."}')
    contract.adjudicate_case(cid, 0)
    contract.supply_context(GUILD, cid, 1, "Public reply parent supplied.")
    assert contract.get_case(cid)["appeal_count"] == 0
    direct_vm.clear_mocks()
    direct_vm.mock_llm(r"(?s).*COMMON_GROUND_DISCORD_RULE_REVIEWER_V2.*", '{"decision":"allowed","analysis":"Good-faith quotation."}')
    contract.adjudicate_case(cid, 1)
    assert contract.get_case(cid)["decision_history"][1]["kind"] == "context"
    assert contract.get_case(cid)["appeal_count"] == 0

def test_cross_guild_appeal_and_historical_callback_recovery(court, direct_vm):
    contract, companion = court
    cid = arguments()[0]
    contract.open_case(*arguments())
    direct_vm.warp("2026-10-12T00:02:01Z")
    direct_vm.mock_llm(r"(?s).*COMMON_GROUND_DISCORD_RULE_REVIEWER_V2.*", '{"decision":"violation","analysis":"Insult."}')
    contract.adjudicate_case(cid, 0)
    with direct_vm.expect_revert("Appeal unavailable"):
        contract.appeal_case("another-guild", cid, "Wrong guild", 1)
    assert contract.get_case(cid)["appeal_count"] == 0
    direct_vm.clear_mocks()
    direct_vm.mock_llm(r"(?s).*COMMON_GROUND_DISCORD_RULE_REVIEWER_V2.*", '{"decision":"allowed","analysis":"New context."}')
    contract.appeal_case(GUILD, cid, "Good-faith quotation exception.", 1)
    direct_vm.warp("2026-10-12T00:04:02Z")
    contract.sync_receipt(cid, 1)
    assert companion.emitted[-1] == companion.emitted[0]
    assert contract.get_case(cid)["decision"] == "allowed"
    assert contract.get_case(cid)["appeal_count"] == 1
    with direct_vm.expect_revert("Appeal unavailable"):
        contract.appeal_case(GUILD, cid, "Twice", 2)

def test_allowed_decision_cannot_be_appealed(court, direct_vm):
    contract, _ = court
    cid = arguments()[0]
    contract.open_case(*arguments())
    direct_vm.warp("2026-10-12T00:02:01Z")
    direct_vm.mock_llm(r"(?s).*COMMON_GROUND_DISCORD_RULE_REVIEWER_V2.*", '{"decision":"allowed","analysis":"No violation."}')
    contract.adjudicate_case(cid, 0)
    with direct_vm.expect_revert("Appeal unavailable"):
        contract.appeal_case(GUILD, cid, "Try to worsen this case", 1)

def test_missing_context_deadline_closes_without_inventing_verdict(court, direct_vm):
    contract, companion = court
    cid = arguments()[0]
    contract.open_case(*arguments())
    direct_vm.warp("2026-10-12T00:02:01Z")
    direct_vm.mock_llm(r"(?s).*COMMON_GROUND_DISCORD_RULE_REVIEWER_V2.*", '{"decision":"needs_context","analysis":"Parent is missing."}')
    contract.adjudicate_case(cid, 0)
    direct_vm.warp("2026-10-13T00:00:01Z")
    closed = contract.expire_case(cid)
    assert closed["status"] == "closed_unresolved"
    assert closed["decision"] == "needs_context"
    assert closed["decision_revision"] == 1
    assert not contract.get_enforcement(cid)["eligible"]
    assert len(companion.emitted) == 1

def test_ledger_requires_bound_court_and_records_auditable_execution(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie, monkeypatch):
    direct_vm.sender = direct_alice
    ledger = deploy("contracts/EnforcementLedger.py", direct_vm, direct_deploy, direct_bob)
    from genlayer import Address, gl
    registry_address = Address("0x" + direct_bob.hex())
    source = Address("0x" + direct_charlie.hex())
    ledger_address = Address("0x" + hashlib.sha256(str(Path("contracts/EnforcementLedger.py").resolve()).encode()).digest()[:20].hex())
    class FakeCourt:
        def view(self): return self
        def get_contracts(self): return {"ledger": str(ledger_address), "registry": str(registry_address), "protocol": 2}
        def get_case(self, case_id): return {"case_id": case_id, "guild_key": GUILD, "decision_revision": 1}
        def get_enforcement(self, case_id): return {"eligible": True}
    class FakeRegistry:
        def view(self): return self
        def can_relay_case(self, guild, sender): return str(sender).lower() == str(source).lower()
    monkeypatch.setattr(gl, "get_contract_at", lambda address: FakeCourt() if Address(str(address)) == source else FakeRegistry())
    with direct_vm.expect_revert("Court is not bound"):
        ledger.record_enforcement(GUILD, "case-test", 1, "applied", digest("done"))
    ledger.bind_source(source)
    payload = json.dumps({"schema": "commonground-decision-v2", "case_id": "case-test", "guild_key": GUILD,
                          "revision": 1, "decision": "violation", "kind": "initial"})
    direct_vm.sender = source
    receipt = ledger.record_decision(payload)
    assert ledger.record_decision(payload) == receipt
    with direct_vm.expect_revert("Conflicting decision receipt"):
        ledger.record_decision(payload.replace("violation", "allowed"))
    direct_vm.sender = direct_alice
    with direct_vm.expect_revert("No guild executor permission"):
        ledger.record_enforcement(GUILD, "case-test", 1, "applied", digest("done"))
    direct_vm.sender = source
    item = ledger.record_enforcement(GUILD, "case-test", 1, "applied", digest("done"))
    assert item["provenance"] == "executor_reported_not_discord_proof"
    assert ledger.get_enforcement("case-test", 1) == item
