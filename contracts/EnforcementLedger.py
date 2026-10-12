# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }
"""Authentic court decisions; separately labelled executor-reported actions."""
import hashlib
import json
import re
from genlayer import *

ZERO = Address("0x0000000000000000000000000000000000000000")

class EnforcementLedger(gl.Contract):
    owner: Address
    registry: Address
    source: Address
    decisions: TreeMap[str, str]
    counts: TreeMap[str, u256]
    indexes: TreeMap[str, str]
    executions: TreeMap[str, str]

    def __init__(self, registry: Address):
        if registry == ZERO:
            raise gl.vm.UserError("[EXPECTED] Zero registry")
        self.owner = gl.message.sender_address
        self.registry = registry
        self.source = ZERO

    @gl.public.write
    def bind_source(self, source: Address) -> None:
        if gl.message.sender_address != self.owner or self.source != ZERO or source == ZERO:
            raise gl.vm.UserError("[EXPECTED] Source binding is owner-only and one-time")
        companions = gl.get_contract_at(source).view().get_contracts()
        if (Address(companions["ledger"]) != gl.message.contract_address
                or Address(companions["registry"]) != self.registry):
            raise gl.vm.UserError("[EXPECTED] Companion mismatch")
        self.source = source

    @gl.public.view
    def get_source(self) -> str:
        return str(self.source)

    @gl.public.write
    def record_decision(self, payload: str) -> str:
        if self.source == ZERO or gl.message.sender_address != self.source:
            raise gl.vm.UserError("[EXPECTED] Only bound court may record a decision")
        if len(payload) > 4000:
            raise gl.vm.UserError("[EXPECTED] Receipt too large")
        try:
            item = json.loads(payload)
        except Exception:
            raise gl.vm.UserError("[EXPECTED] Invalid receipt JSON")
        if (not isinstance(item, dict) or item.get("schema") != "commonground-decision-v2"
                or item.get("decision") not in ("allowed", "violation", "needs_context")
                or type(item.get("revision")) is not int or item["revision"] < 1):
            raise gl.vm.UserError("[EXPECTED] Invalid decision receipt")
        key = item["case_id"] + "::" + str(item["revision"])
        canonical = json.dumps(item, sort_keys=True, separators=(",", ":"))
        digest = hashlib.sha256(canonical.encode()).hexdigest()
        old = self.decisions.get(key, "")
        if old:
            if json.loads(old)["receipt_id"] != digest:
                raise gl.vm.UserError("[EXPECTED] Conflicting decision receipt")
            return digest
        item["receipt_id"] = digest
        item["source_contract"] = str(self.source)
        self.decisions[key] = json.dumps(item, sort_keys=True)
        guild = item["guild_key"]
        count = int(self.counts.get(guild, u256(0)))
        self.indexes[guild + "::" + str(count)] = key
        self.counts[guild] = u256(count + 1)
        return digest

    @gl.public.view
    def get_decision(self, case_id: str, revision: int) -> dict:
        raw = self.decisions.get(case_id + "::" + str(revision), "")
        return json.loads(raw) if raw else {}

    @gl.public.view
    def list_decisions(self, guild_key: str, offset: int, limit: int) -> list:
        if offset < 0 or limit < 1 or limit > 20:
            raise gl.vm.UserError("[EXPECTED] Invalid page bounds")
        count = int(self.counts.get(guild_key, u256(0)))
        result = []
        for index in range(max(0, count - offset - limit), max(0, count - offset)):
            result.append(json.loads(self.decisions[self.indexes[guild_key + "::" + str(index)]]))
        result.reverse()
        return result

    @gl.public.write
    def record_enforcement(self, guild_key: str, case_id: str, revision: int,
                           outcome: str, detail_digest: str) -> dict:
        if self.source == ZERO:
            raise gl.vm.UserError("[EXPECTED] Court is not bound")
        if not gl.get_contract_at(self.registry).view().can_relay_case(guild_key, gl.message.sender_address):
            raise gl.vm.UserError("[EXPECTED] No guild executor permission")
        if outcome not in ("applied", "already_applied", "partial", "withheld_changed", "unavailable", "failed", "unknown", "no_action"):
            raise gl.vm.UserError("[EXPECTED] Invalid executor outcome")
        if not re.fullmatch(r"sha256:[0-9a-f]{64}", detail_digest):
            raise gl.vm.UserError("[EXPECTED] Invalid detail digest")
        case = gl.get_contract_at(self.source).view().get_case(case_id)
        if case["guild_key"] != guild_key or case["decision_revision"] != revision or revision < 1:
            raise gl.vm.UserError("[EXPECTED] Case or revision mismatch")
        if outcome in ("applied", "partial") and not gl.get_contract_at(self.source).view().get_enforcement(case_id)["eligible"]:
            raise gl.vm.UserError("[EXPECTED] Action is not eligible")
        key = case_id + "::" + str(revision)
        old = self.executions.get(key, "")
        if old:
            previous = json.loads(old)
            if previous["outcome"] == outcome and previous["detail_digest"] == detail_digest:
                return previous
            raise gl.vm.UserError("[EXPECTED] Executor receipt already recorded")
        item = {"case_id": case_id, "guild_key": guild_key, "revision": revision,
                "outcome": outcome, "detail_digest": detail_digest,
                "executor": str(gl.message.sender_address), "provenance": "executor_reported_not_discord_proof"}
        self.executions[key] = json.dumps(item, sort_keys=True)
        return item

    @gl.public.view
    def get_enforcement(self, case_id: str, revision: int) -> dict:
        raw = self.executions.get(case_id + "::" + str(revision), "")
        return json.loads(raw) if raw else {}
