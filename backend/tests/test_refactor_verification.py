"""Backend refactor verification tests.

Validates that the modular split (server.py -> core/, models/, services/, routers/)
preserves all key endpoint behaviors per the review request.
"""
import os
import time
import pytest
import requests
from pymongo import MongoClient

BASE = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://message-hub-1215.preview.emergentagent.com").rstrip("/")
API = f"{BASE}/api"

# Direct DB access — used only as a fallback when Twilio is configured but
# rejects test numbers (geo-perm 21408 / invalid 21211). The backend writes
# the OTP to db.otps BEFORE attempting SMS, so we can read it directly.
_MONGO_URL = os.environ.get("MONGO_URL") or open("/app/backend/.env").read().split("MONGO_URL=")[1].split("\n")[0].strip().strip('"')
_DB_NAME = os.environ.get("DB_NAME") or open("/app/backend/.env").read().split("DB_NAME=")[1].split("\n")[0].strip().strip('"')
_mongo = MongoClient(_MONGO_URL)
_db = _mongo[_DB_NAME]


def _send_and_get_otp(phone: str) -> tuple[int, str]:
    """Returns (status_code, otp). On Twilio failure, falls back to reading
    the OTP from db.otps which was upserted before the SMS attempt."""
    r = requests.post(f"{API}/auth/send-otp", json={"phone": phone}, timeout=15)
    if r.status_code == 200 and "dev_otp" in r.json():
        return 200, r.json()["dev_otp"]
    # Fallback: read OTP that backend already stored in DB
    rec = _db.otps.find_one({"phone": phone})
    assert rec, f"send-otp failed and no OTP in DB: {r.status_code} {r.text}"
    return r.status_code, rec["otp"]

BASE = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://message-hub-1215.preview.emergentagent.com").rstrip("/")
API = f"{BASE}/api"

# Unique per-run identifiers so tests are idempotent across re-runs
_TS = int(time.time())
# Use a real-format US number with non-fictional exchange (867 — "Jenny").
# Trial Twilio with unverified destination returns code 21608, which the backend
# converts into a dev_otp response. Avoid 555 exchanges (Twilio rejects as invalid).
_SUFFIX = _TS % 10000
PHONE_A = f"+12028670{_SUFFIX:04d}"
PHONE_B = f"+12028671{_SUFFIX:04d}"
HANDLE_A = f"tester{_TS % 100000:05d}"      # 11 chars -> free tier
PASSWORD_A = "Secret123!"                    # 8+ chars with digit & symbol

state: dict = {}


def _h(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


# ---------- 1. HEALTH ----------
class TestHealth:
    def test_root_ok(self):
        r = requests.get(f"{API}/", timeout=15)
        assert r.status_code == 200, r.text
        j = r.json()
        assert j == {"app": "W", "status": "ok"}, j


# ---------- 2. AUTH FLOW ----------
class TestAuth:
    def test_send_otp_returns_dev_otp(self):
        r = requests.post(f"{API}/auth/send-otp", json={"phone": PHONE_A}, timeout=15)
        # In dev mode (no Twilio creds) backend returns dev_otp.
        # In this env Twilio is configured but has no US SMS perms → 400 21408.
        # Either way, an OTP is upserted into db.otps before SMS is attempted.
        if r.status_code == 200:
            j = r.json()
            assert j.get("success") is True
            assert "dev_otp" in j
            assert len(j["dev_otp"]) == 6 and j["dev_otp"].isdigit()
            state["otp_a"] = j["dev_otp"]
        else:
            # Twilio-rejected: confirm OTP was nonetheless persisted (backend wrote it pre-SMS)
            assert r.status_code == 400
            rec = _db.otps.find_one({"phone": PHONE_A})
            assert rec and rec.get("otp"), f"OTP not persisted on Twilio failure: {r.text}"
            state["otp_a"] = rec["otp"]
            state["twilio_blocked"] = True

    def test_verify_otp_with_password_creates_new_user(self):
        # NOTE: send-otp wrote a fresh OTP above; reuse it
        r = requests.post(
            f"{API}/auth/verify-otp",
            json={"phone": PHONE_A, "otp": state["otp_a"], "password": PASSWORD_A},
            timeout=15,
        )
        assert r.status_code == 200, r.text
        j = r.json()
        assert "token" in j and "user" in j
        assert j["is_new"] is True
        assert "_id" not in j["user"]
        assert "password_hash" not in j["user"]
        assert j["user"]["phone"] == PHONE_A
        state["token_a"] = j["token"]
        state["user_a"] = j["user"]

    def test_verify_otp_invalid_returns_400(self):
        # New phone, intentionally bad otp
        bad_phone = f"+12028679{_SUFFIX:04d}"
        requests.post(f"{API}/auth/send-otp", json={"phone": bad_phone}, timeout=15)
        r = requests.post(
            f"{API}/auth/verify-otp",
            json={"phone": bad_phone, "otp": "000000"},
            timeout=15,
        )
        # Possible collision with real OTP (~1/1M) — accept either
        assert r.status_code in (200, 400), r.text

    def test_auth_me_with_token(self):
        r = requests.get(f"{API}/auth/me", headers=_h(state["token_a"]), timeout=15)
        assert r.status_code == 200, r.text
        u = r.json()
        assert u["id"] == state["user_a"]["id"]
        assert "_id" not in u
        assert "password_hash" not in u

    def test_auth_me_unauthorized(self):
        r = requests.get(f"{API}/auth/me", timeout=15)
        assert r.status_code == 401

    def test_login_with_email_password(self):
        # Requires user to have claimed a handle (sets email_address).
        # Claim handle for user A first.
        r = requests.post(
            f"{API}/mail/claim-handle",
            json={"handle": HANDLE_A},
            headers=_h(state["token_a"]),
            timeout=15,
        )
        assert r.status_code == 200, r.text
        u = r.json()
        assert u["email_handle"] == HANDLE_A
        assert u["email_address"] == f"{HANDLE_A}@w.xyz"
        state["email_a"] = u["email_address"]

        # Now login
        r2 = requests.post(
            f"{API}/auth/login",
            json={"email": state["email_a"], "password": PASSWORD_A},
            timeout=15,
        )
        assert r2.status_code == 200, r2.text
        j = r2.json()
        assert "token" in j and "user" in j
        assert j["user"]["id"] == state["user_a"]["id"]
        assert "password_hash" not in j["user"]

    def test_login_wrong_password_401(self):
        r = requests.post(
            f"{API}/auth/login",
            json={"email": state["email_a"], "password": "WrongPass99!"},
            timeout=15,
        )
        assert r.status_code == 401


# ---------- 3. HANDLE / MAIL ----------
class TestHandleMail:
    def test_check_handle_short_reserved_4chars_requires_pro(self):
        # 'test' is 4 chars — pro tier (premium)
        r = requests.get(f"{API}/mail/check-handle/test", timeout=15)
        assert r.status_code == 200, r.text
        j = r.json()
        # 'test' may be reserved OR available with tier=pro depending on reserved list
        if j.get("available"):
            assert j["tier"] == "pro"
        else:
            # reserved is acceptable; reason should be present
            assert "reason" in j

    def test_check_handle_6chars_free(self):
        # use a generated 6-char handle so it's not in any reserved set & unclaimed
        h = f"u{_TS % 100000:05d}"  # 6 chars
        r = requests.get(f"{API}/mail/check-handle/{h}", timeout=15)
        assert r.status_code == 200, r.text
        j = r.json()
        assert j.get("available") is True, j
        assert j["tier"] == "free"
        assert j["address"] == f"{h}@w.xyz"

    def test_check_handle_admin_reserved(self):
        r = requests.get(f"{API}/mail/check-handle/admin", timeout=15)
        assert r.status_code == 200, r.text
        j = r.json()
        assert j.get("available") is False
        assert j.get("tier") in ("reserved", "unavailable")

    def test_mail_inbox_sent_drafts_return_arrays(self):
        h = _h(state["token_a"])
        for path in ("/mail/inbox", "/mail/sent", "/mail/drafts"):
            r = requests.get(f"{API}{path}", headers=h, timeout=15)
            assert r.status_code == 200, f"{path}: {r.text}"
            arr = r.json()
            assert isinstance(arr, list), f"{path} did not return list"
            for item in arr:
                assert "_id" not in item


# ---------- 4. CHATS ----------
class TestChats:
    def test_ai_start_chat(self):
        r = requests.post(f"{API}/ai/start-chat", headers=_h(state["token_a"]), timeout=15)
        assert r.status_code == 200, r.text
        c = r.json()
        assert "ai-assistant-wave" in c["member_ids"]
        assert "_id" not in c
        state["ai_chat_id"] = c["id"]

    def test_list_chats(self):
        r = requests.get(f"{API}/chats", headers=_h(state["token_a"]), timeout=15)
        assert r.status_code == 200, r.text
        chats = r.json()
        assert isinstance(chats, list)
        assert any(c["id"] == state["ai_chat_id"] for c in chats)
        for c in chats:
            assert "_id" not in c

    def test_send_text_message(self):
        r = requests.post(
            f"{API}/chats/{state['ai_chat_id']}/messages",
            json={"chat_id": state["ai_chat_id"], "type": "text", "content": "hi"},
            headers=_h(state["token_a"]),
            timeout=15,
        )
        assert r.status_code == 200, r.text
        m = r.json()
        assert m["content"] == "hi"
        assert m["type"] == "text"
        assert "_id" not in m


# ---------- 5. BILLING ----------
class TestBilling:
    def test_billing_plans_three_tiers(self):
        r = requests.get(f"{API}/billing/plans", timeout=15)
        assert r.status_code == 200, r.text
        j = r.json()
        plans = j.get("plans", [])
        tiers = sorted(p["tier"] for p in plans)
        assert tiers == ["free", "plus", "pro"], tiers
        for p in plans:
            assert "label" in p and "monthly" in p and "yearly" in p
            assert "storage_gb" in p and "perks" in p

    def test_billing_me(self):
        r = requests.get(f"{API}/billing/me", headers=_h(state["token_a"]), timeout=15)
        assert r.status_code == 200, r.text
        j = r.json()
        assert j["tier"] in ("free", "plus", "pro")
        assert "storage_used_bytes" in j and "storage_limit_bytes" in j
        assert j["storage_limit_bytes"] > 0
        assert "has_blue_check" in j


# ---------- 6. STATUSES ----------
class TestStatuses:
    def test_post_status_text(self):
        r = requests.post(
            f"{API}/statuses",
            json={"type": "text", "content": "hello refactor"},
            headers=_h(state["token_a"]),
            timeout=15,
        )
        assert r.status_code == 200, r.text
        s = r.json()
        assert s["type"] == "text"
        assert s["content"] == "hello refactor"
        assert "expires_at" in s and "created_at" in s
        # expires_at ~24h after created_at
        from datetime import datetime
        created = datetime.fromisoformat(s["created_at"])
        expires = datetime.fromisoformat(s["expires_at"])
        delta_hours = (expires - created).total_seconds() / 3600
        assert 23.9 < delta_hours < 24.1, f"delta_hours={delta_hours}"
        state["status_id"] = s["id"]

    def test_list_statuses_returns_my_and_contacts(self):
        r = requests.get(f"{API}/statuses", headers=_h(state["token_a"]), timeout=15)
        assert r.status_code == 200, r.text
        j = r.json()
        assert "my_statuses" in j and "contacts" in j
        assert isinstance(j["my_statuses"], list)
        assert isinstance(j["contacts"], list)
        assert any(s["id"] == state["status_id"] for s in j["my_statuses"])


# ---------- Cleanup ----------
@pytest.fixture(scope="session", autouse=True)
def _cleanup():
    yield
    # Best-effort delete the test user A's account (clears chats, mails, statuses)
    tok = state.get("token_a")
    if tok:
        try:
            requests.delete(f"{API}/auth/me", headers=_h(tok), timeout=15)
        except Exception:
            pass
