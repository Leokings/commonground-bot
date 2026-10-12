# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }
"""Per-community governance. Discord registration is a trusted bridge."""
import json
import re
from datetime import datetime, timezone
from genlayer import *

ZERO = Address("0x0000000000000000000000000000000000000000")

def _now() -> int:
    return int(datetime.now(timezone.utc).timestamp())

def _text(value: str, maximum: int) -> str:
    if not isinstance(value, str) or not value.strip() or len(value.encode("utf-8")) > maximum:
        raise gl.vm.UserError("[EXPECTED] Invalid text length")
    return value

def _key(value: str) -> str:
    value = _text(value, 96)
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._:-]*", value):
        raise gl.vm.UserError("[EXPECTED] Invalid key")
    return value

def _json(value: str) -> str:
    _text(value, 4000)
    try:
        parsed = json.loads(value)
    except Exception:
        raise gl.vm.UserError("[EXPECTED] Invalid JSON")
    if not isinstance(parsed, dict):
        raise gl.vm.UserError("[EXPECTED] Expected JSON object")
    return json.dumps(parsed, sort_keys=True, separators=(",", ":"))

class CommunityRegistry(gl.Contract):
    owner: Address
    registrar: Address
    guilds: TreeMap[str, str]
    rules: TreeMap[str, str]
    versions: TreeMap[str, u256]
    starter_pack: str

    def __init__(self, registrar: Address, starter_pack_json: str):
        if registrar == ZERO:
            raise gl.vm.UserError("[EXPECTED] Zero registrar")
        self.owner = gl.message.sender_address
        self.registrar = registrar
        if len(starter_pack_json.encode("utf-8")) > 32000:
            raise gl.vm.UserError("[EXPECTED] Starter pack too large")
        try:
            pack = json.loads(starter_pack_json)
        except Exception:
            raise gl.vm.UserError("[EXPECTED] Invalid starter pack")
        if not isinstance(pack, list) or len(pack) < 1 or len(pack) > 8:
            raise gl.vm.UserError("[EXPECTED] Invalid starter pack size")
        ids = set()
        for item in pack:
            if not isinstance(item, dict) or not all(key in item for key in (
                "ruleId", "name", "text", "mode", "detectorJson", "exceptionsJson", "scopeJson", "action", "appealAllowed"
            )):
                raise gl.vm.UserError("[EXPECTED] Invalid starter rule schema")
            rid = _key(item["ruleId"])
            if rid in ids or len(rid) > 48:
                raise gl.vm.UserError("[EXPECTED] Duplicate or invalid starter rule ID")
            ids.add(rid)
            _text(item["name"], 120)
            _text(item["text"], 4000)
            if item["mode"] not in ("automatic", "hybrid", "contextual") or item["action"] not in (
                "warn", "delete", "delete_and_warn", "delete_and_strike", "log_only"
            ) or type(item["appealAllowed"]) is not bool:
                raise gl.vm.UserError("[EXPECTED] Invalid starter rule mode, action or appeal setting")
            for key in ("detectorJson", "exceptionsJson", "scopeJson"):
                _json(item[key])
        self.starter_pack = json.dumps(pack, sort_keys=True)

    def _guild(self, guild_key: str) -> dict:
        raw = self.guilds.get(_key(guild_key), "")
        if not raw:
            raise gl.vm.UserError("[EXPECTED] Guild is not registered")
        return json.loads(raw)

    def _save(self, guild: dict) -> None:
        self.guilds[guild["guild_key"]] = json.dumps(guild, sort_keys=True)

    def _can_edit(self, guild: dict) -> None:
        sender = str(gl.message.sender_address).lower()
        if sender == guild["admin"].lower():
            return
        if (sender == guild["policy_editor"].lower()
                and _now() < guild["policy_until"]):
            return
        raise gl.vm.UserError("[EXPECTED] No active guild policy permission")

    @gl.public.view
    def get_owner(self) -> str:
        return str(self.owner)

    @gl.public.view
    def get_guild(self, guild_key: str) -> dict:
        return self._guild(guild_key)

    @gl.public.view
    def can_relay_case(self, guild_key: str, account: Address) -> bool:
        guild = self._guild(guild_key)
        return str(account).lower() in (guild["admin"].lower(), guild["case_relayer"].lower())

    @gl.public.write
    def register_guild(self, guild_key: str, display_name: str, admin: Address) -> dict:
        if gl.message.sender_address not in (self.owner, self.registrar):
            raise gl.vm.UserError("[EXPECTED] Only the registrar may register a guild")
        key = _key(guild_key)
        if self.guilds.get(key, "") or admin == ZERO:
            raise gl.vm.UserError("[EXPECTED] Guild exists or admin is zero")
        guild = {"guild_key": key, "display_name": _text(display_name, 120),
                 "admin": str(admin), "case_relayer": str(self.registrar),
                 "policy_editor": str(ZERO), "policy_until": 0,
                 "constitution_version": 0, "rule_ids": [], "active": True}
        self._save(guild)
        for item in json.loads(self.starter_pack):
            self._put_rule(key, item["ruleId"], 0, item["name"], item["text"],
                           item["mode"], item["detectorJson"], item["exceptionsJson"],
                           item["scopeJson"], item["action"], item["appealAllowed"], True, True)
        return self._guild(key)

    @gl.public.write
    def set_roles(self, guild_key: str, case_relayer: Address,
                  policy_editor: Address, policy_until: int) -> dict:
        guild = self._guild(guild_key)
        if str(gl.message.sender_address).lower() != guild["admin"].lower():
            raise gl.vm.UserError("[EXPECTED] Only the guild admin may delegate")
        if policy_until < 0 or policy_until > _now() + 7 * 86400:
            raise gl.vm.UserError("[EXPECTED] Policy delegation exceeds seven days")
        if case_relayer == ZERO:
            raise gl.vm.UserError("[EXPECTED] Case relayer cannot be zero")
        if (policy_editor == ZERO) != (policy_until == 0):
            raise gl.vm.UserError("[EXPECTED] Clear editor and expiry together")
        if policy_editor != ZERO and policy_until <= _now():
            raise gl.vm.UserError("[EXPECTED] Delegation already expired")
        guild.update({"case_relayer": str(case_relayer), "policy_editor": str(policy_editor),
                      "policy_until": policy_until})
        self._save(guild)
        return guild

    @gl.public.write
    def transfer_guild_admin(self, guild_key: str, new_admin: Address) -> None:
        guild = self._guild(guild_key)
        if str(gl.message.sender_address).lower() != guild["admin"].lower() or new_admin == ZERO:
            raise gl.vm.UserError("[EXPECTED] Unauthorized admin transfer")
        guild.update({"admin": str(new_admin), "policy_editor": str(ZERO), "policy_until": 0})
        self._save(guild)

    @gl.public.view
    def get_rule(self, guild_key: str, rule_id: str, version: int) -> dict:
        self._guild(guild_key)
        stem = guild_key + "::" + _key(rule_id)
        selected = version if version > 0 else int(self.versions.get(stem, u256(0)))
        raw = self.rules.get(stem + "::" + str(selected), "")
        if not raw:
            raise gl.vm.UserError("[EXPECTED] Rule does not exist")
        return json.loads(raw)

    @gl.public.view
    def list_rules(self, guild_key: str) -> list:
        guild = self._guild(guild_key)
        return [self.get_rule(guild_key, rule_id, 0) for rule_id in guild["rule_ids"]]

    def _put_rule(self, guild_key: str, rule_id: str, expected_version: int,
                  name: str, text: str, mode: str, detector_json: str,
                  exceptions_json: str, scope_json: str, action: str,
                  appeal_allowed: bool, active: bool, bootstrap: bool = False) -> dict:
        guild = self._guild(guild_key)
        if not bootstrap:
            self._can_edit(guild)
        rid = _key(rule_id)
        if len(rid) > 48:
            raise gl.vm.UserError("[EXPECTED] Rule ID too long")
        stem = guild_key + "::" + rid
        current = int(self.versions.get(stem, u256(0)))
        if current != expected_version:
            raise gl.vm.UserError("[EXPECTED] Stale rule version")
        if current == 0 and len(guild["rule_ids"]) >= 200:
            raise gl.vm.UserError("[EXPECTED] Rule limit reached")
        if mode not in ("automatic", "hybrid", "contextual") or action not in (
                "warn", "delete", "delete_and_warn", "delete_and_strike", "log_only"):
            raise gl.vm.UserError("[EXPECTED] Invalid mode or action")
        version = current + 1
        epoch = datetime.now(timezone.utc).isoformat()
        rule = {"guild_key": guild_key, "rule_id": rid, "version": version,
                "constitution_version": guild["constitution_version"] + 1,
                "name": _text(name, 120), "text": _text(text, 4000), "mode": mode,
                "detector_json": _json(detector_json), "exceptions_json": _json(exceptions_json),
                "scope_json": _json(scope_json), "action": action,
                "appeal_allowed": appeal_allowed, "active": active,
                "created_at": epoch, "updated_at": epoch}
        self.rules[stem + "::" + str(version)] = json.dumps(rule, sort_keys=True)
        self.versions[stem] = u256(version)
        if current == 0:
            guild["rule_ids"].append(rid)
        guild["constitution_version"] += 1
        self._save(guild)
        return rule

    @gl.public.write
    def add_rule(self, guild_key: str, rule_id: str, name: str, text: str,
                 mode: str, detector_json: str, exceptions_json: str,
                 scope_json: str, action: str, appeal_allowed: bool) -> dict:
        return self._put_rule(guild_key, rule_id, 0, name, text, mode, detector_json,
                              exceptions_json, scope_json, action, appeal_allowed, True)

    @gl.public.write
    def update_rule(self, guild_key: str, rule_id: str, name: str, text: str,
                    mode: str, detector_json: str, exceptions_json: str,
                    scope_json: str, action: str, appeal_allowed: bool,
                    expected_version: int) -> dict:
        return self._put_rule(guild_key, rule_id, expected_version, name, text, mode,
                              detector_json, exceptions_json, scope_json, action, appeal_allowed, True)

    @gl.public.write
    def disable_rule(self, guild_key: str, rule_id: str, expected_version: int) -> dict:
        rule = self.get_rule(guild_key, rule_id, 0)
        return self._put_rule(guild_key, rule_id, expected_version, rule["name"],
                              rule["text"], rule["mode"], rule["detector_json"],
                              rule["exceptions_json"], rule["scope_json"], rule["action"],
                              rule["appeal_allowed"], False)
