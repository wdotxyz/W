"""End-to-end tests for the new W backend features:

1. Recovery Email (set/verify/delete)
2. Recovery Email errors (invalid email, wrong OTP, verify-before-set)
3. forgot-password + reset-password via recovery email
4. Auto-reply (Out of Office) GET/PATCH + validation
5. Inbound webhook (multipart) stores email; no 500
6. Per-message signature toggle (include_signature true/false)
7. Regression: /auth/me has no password_hash, /billing/plans returns 3 tiers,
   /ai/start-chat works.
"""
import os
import time
import pytest
import requests
from pymongo import MongoClient

BASE = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "http://localhost:8001").rstrip("/")
API = f"{BASE}/api"

# Direct DB access — used to read OTPs the backend stored before SMS/SendGrid.
def _env(k):
    try:
        for line in open("/app/backend/.env"):
            if line.startswith(f"{k}="):
                return line.split("=", 1)[1].strip().strip('"').strip()
    except Exception:
        return None

_MONGO_URL = os.environ.get("MONGO_URL") or _env("MONGO_URL")
_DB_NAME = os.environ.get("DB_NAME") or _env("DB_NAME")
_mongo = MongoClient(_MONGO_URL)
_db = _mongo[_DB_NAME]


def _h(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


_TS = int(time.time())
_SUFFIX = _TS % 10000
PHONE_A = f"+12028670{_SUFFIX:04d}"
HANDLE_A = f"recv{_TS % 100000:05d}"  # 9 chars -> free tier
PASSWORD_A = "Secret123!"
NEW_PASSWORD = "NewSecure9!"
RECOVERY_EMAIL = f"test+recover{_TS}@example.com"

state: dict = {}


def _get_otp_for_phone(phone: str) -> str:
    r = requests.post(f"{API}/auth/send-otp", json={"phone": phone}, timeout=15)
    if r.status_code == 200 and "dev_otp" in r.json():
        return r.json()["dev_otp"]
    rec = _db.otps.find_one({"phone": phone})
    assert rec, f"send-otp failed and no OTP in DB: {r.status_code} {r.text}"
    return rec["otp"]


# ---------- Bootstrap: create user, claim handle ----------
class TestBootstrap:
    def test_signup_and_claim_handle(self):
        otp = _get_otp_for_phone(PHONE_A)
        r = requests.post(
            f"{API}/auth/verify-otp",
            json={"phone": PHONE_A, "otp": otp, "password": PASSWORD_A},
            timeout=15,
        )
        assert r.status_code == 200, r.text
        j = r.json()
        assert "password_hash" not in j["user"], j["user"]
        state["token"] = j["token"]
        state["uid"] = j["user"]["id"]

        r2 = requests.post(
            f"{API}/mail/claim-handle",
            json={"handle": HANDLE_A},
            headers=_h(state["token"]),
            timeout=15,
        )
        assert r2.status_code == 200, r2.text
        u = r2.json()
        assert u["email_address"] == f"{HANDLE_A}@w.xyz"
        state["email"] = u["email_address"]
        # User dict from claim-handle must not leak password_hash
        assert "password_hash" not in u, u


# ---------- 1. Recovery Email happy path ----------
class TestRecoveryEmailHappy:
    def test_set_recovery_email(self):
        r = requests.post(
            f"{API}/auth/recovery-email/set",
            json={"email": RECOVERY_EMAIL},
            headers=_h(state["token"]),
            timeout=20,
        )
        assert r.status_code == 200, r.text
        j = r.json()
        assert "sent" in j and "recovery_email_pending" in j
        assert j["recovery_email_pending"] == RECOVERY_EMAIL
        state["recovery_send_response"] = j
        # Either SendGrid sent (sent=True) or dev_otp returned (sent=False)
        if j.get("sent") is True:
            # SendGrid attempted; OTP must be read from DB
            doc = _db.users.find_one({"id": state["uid"]})
            assert doc and doc.get("recovery_email_otp"), "OTP not stored after send"
            state["recovery_otp"] = doc["recovery_email_otp"]
        else:
            assert "dev_otp" in j, j
            assert len(j["dev_otp"]) == 6 and j["dev_otp"].isdigit()
            state["recovery_otp"] = j["dev_otp"]

    def test_verify_recovery_email(self):
        r = requests.post(
            f"{API}/auth/recovery-email/verify",
            json={"otp": state["recovery_otp"]},
            headers=_h(state["token"]),
            timeout=15,
        )
        assert r.status_code == 200, r.text
        j = r.json()
        assert j["verified"] is True
        assert j["recovery_email"] == RECOVERY_EMAIL

    def test_me_has_recovery_email_no_password_hash(self):
        r = requests.get(f"{API}/auth/me", headers=_h(state["token"]), timeout=15)
        assert r.status_code == 200, r.text
        u = r.json()
        assert u.get("recovery_email") == RECOVERY_EMAIL
        assert u.get("recovery_email_verified") is True
        # Critical: password_hash must not leak
        assert "password_hash" not in u, list(u.keys())
        # Also pending/otp internal fields shouldn't leak
        assert "recovery_email_otp" not in u
        assert "password_reset_otp" not in u

    def test_delete_recovery_email(self):
        r = requests.delete(f"{API}/auth/recovery-email", headers=_h(state["token"]), timeout=15)
        assert r.status_code == 200, r.text
        j = r.json()
        assert j.get("recovery_email") is None
        # Verify via /me
        r2 = requests.get(f"{API}/auth/me", headers=_h(state["token"]), timeout=15)
        u = r2.json()
        assert "recovery_email" not in u or u.get("recovery_email") in (None, "")
        assert not u.get("recovery_email_verified")


# ---------- 2. Recovery Email errors ----------
class TestRecoveryEmailErrors:
    def test_invalid_email_format_400(self):
        r = requests.post(
            f"{API}/auth/recovery-email/set",
            json={"email": "notanemail"},
            headers=_h(state["token"]),
            timeout=10,
        )
        assert r.status_code == 400, r.text

    def test_verify_without_pending_400(self):
        # Recovery email was just deleted, so no pending; expect 400.
        r = requests.post(
            f"{API}/auth/recovery-email/verify",
            json={"otp": "123456"},
            headers=_h(state["token"]),
            timeout=10,
        )
        assert r.status_code == 400, r.text
        assert "No recovery email pending" in r.text or "pending" in r.text.lower()

    def test_wrong_otp_401(self):
        # First set a new pending
        r = requests.post(
            f"{API}/auth/recovery-email/set",
            json={"email": f"wrong+{_TS}@example.com"},
            headers=_h(state["token"]),
            timeout=20,
        )
        assert r.status_code == 200
        r2 = requests.post(
            f"{API}/auth/recovery-email/verify",
            json={"otp": "000000"},
            headers=_h(state["token"]),
            timeout=10,
        )
        # 000000 may collide with real OTP (~1/1M); accept 401 (expected) or 200 (collision)
        assert r2.status_code in (401, 200), r2.text
        if r2.status_code == 200:
            # collision — re-delete to leave clean state
            requests.delete(f"{API}/auth/recovery-email", headers=_h(state["token"]), timeout=10)


# ---------- 3. forgot-password + reset-password via recovery email ----------
class TestForgotResetViaRecovery:
    def test_setup_verified_recovery(self):
        # Set + verify a fresh recovery email
        r = requests.post(
            f"{API}/auth/recovery-email/set",
            json={"email": RECOVERY_EMAIL},
            headers=_h(state["token"]),
            timeout=20,
        )
        assert r.status_code == 200, r.text
        j = r.json()
        otp = j.get("dev_otp")
        if not otp:
            doc = _db.users.find_one({"id": state["uid"]})
            otp = doc.get("recovery_email_otp")
        assert otp, "no OTP available to verify recovery"
        rv = requests.post(
            f"{API}/auth/recovery-email/verify",
            json={"otp": otp},
            headers=_h(state["token"]),
            timeout=15,
        )
        assert rv.status_code == 200, rv.text

    def test_forgot_password_uses_recovery_email(self):
        r = requests.post(
            f"{API}/auth/forgot-password",
            json={"email": state["email"]},
            timeout=20,
        )
        assert r.status_code == 200, r.text
        j = r.json()
        assert j.get("success") is True
        # Accept either sent_via=recovery_email OR dev_otp (no provider)
        assert j.get("sent_via") in ("recovery_email", "dev", "sms") or "dev_otp" in j, j
        # Must NOT leak password_reset_otp in response (except via dev_otp field)
        assert "password_reset_otp" not in j
        state["forgot_response"] = j

    def test_reset_password_with_otp_from_db(self):
        # Read the OTP from db.users.password_reset_otp (stored by backend)
        doc = _db.users.find_one({"id": state["uid"]})
        otp = doc.get("password_reset_otp") or state["forgot_response"].get("dev_otp")
        assert otp, "no password_reset_otp in db"
        r = requests.post(
            f"{API}/auth/reset-password",
            json={"email": state["email"], "otp": otp, "new_password": NEW_PASSWORD},
            timeout=15,
        )
        assert r.status_code == 200, r.text
        j = r.json()
        assert "token" in j and "user" in j
        assert "password_hash" not in j["user"]
        assert "password_reset_otp" not in j["user"]
        state["token"] = j["token"]  # use new token going forward

    def test_login_with_new_password(self):
        r = requests.post(
            f"{API}/auth/login",
            json={"email": state["email"], "password": NEW_PASSWORD},
            timeout=15,
        )
        assert r.status_code == 200, r.text
        j = r.json()
        assert "token" in j
        assert "password_hash" not in j["user"]
        state["token"] = j["token"]


# ---------- 4. Auto-reply ----------
class TestAutoReply:
    def test_patch_enabled_no_body_400(self):
        r = requests.patch(
            f"{API}/auth/auto-reply",
            json={"enabled": True, "body": ""},
            headers=_h(state["token"]),
            timeout=10,
        )
        assert r.status_code == 400, r.text

    def test_patch_valid_returns_settings(self):
        r = requests.patch(
            f"{API}/auth/auto-reply",
            json={"enabled": True, "subject": "OOO", "body": "Away until Mon"},
            headers=_h(state["token"]),
            timeout=10,
        )
        assert r.status_code == 200, r.text
        j = r.json()
        assert j["enabled"] is True
        assert j["subject"] == "OOO"
        assert j["body"] == "Away until Mon"

    def test_get_auto_reply_returns_saved(self):
        r = requests.get(f"{API}/auth/auto-reply", headers=_h(state["token"]), timeout=10)
        assert r.status_code == 200, r.text
        j = r.json()
        assert j["enabled"] is True
        assert j["subject"] == "OOO"
        assert j["body"] == "Away until Mon"


# ---------- 5. Inbound webhook stores email + maybe auto-reply ----------
class TestInbound:
    def test_inbound_stores_email_no_500(self):
        # SendGrid Inbound Parse — multipart form, no auth
        data = {
            "to": state["email"],
            "from": "stranger@gmail.com",
            "subject": f"Hello {_TS}",
            "text": "Test inbound body",
            "html": "",
            "envelope": f'{{"to":["{state["email"]}"], "from":"stranger@gmail.com"}}',
            "headers": f"Message-ID: <inbound-{_TS}@gmail.com>\n",
            "attachments": "0",
        }
        r = requests.post(f"{API}/mail/inbound", data=data, timeout=20)
        assert r.status_code == 200, r.text
        j = r.json()
        assert j.get("stored") == 1, j

        # Confirm it landed in the user's inbox
        r2 = requests.get(f"{API}/mail/inbox", headers=_h(state["token"]), timeout=15)
        assert r2.status_code == 200
        inbox = r2.json()
        assert any(m.get("subject") == f"Hello {_TS}" for m in inbox), \
            f"Subject not found in inbox; got {[m.get('subject') for m in inbox]}"


# ---------- 6. Per-message signature toggle ----------
class TestSignatureToggle:
    def test_set_signature(self):
        r = requests.patch(
            f"{API}/auth/signature",
            json={"signature": "Best, Sam"},
            headers=_h(state["token"]),
            timeout=10,
        )
        assert r.status_code == 200, r.text
        assert r.json().get("signature") == "Best, Sam"

    def test_compose_with_signature_true(self):
        r = requests.post(
            f"{API}/mail/compose",
            json={
                "to": ["someone@example.com"],
                "subject": "Sig test true",
                "body": "Hello there",
                "include_signature": True,
            },
            headers=_h(state["token"]),
            timeout=20,
        )
        assert r.status_code == 200, r.text
        m = r.json()
        # Must contain the signature delimiter "-- \n" followed by signature
        assert "-- \nBest, Sam" in m["body"], f"body did not include signature: {m['body']!r}"

    def test_compose_with_signature_false(self):
        r = requests.post(
            f"{API}/mail/compose",
            json={
                "to": ["someone@example.com"],
                "subject": "Sig test false",
                "body": "Hello there",
                "include_signature": False,
            },
            headers=_h(state["token"]),
            timeout=20,
        )
        assert r.status_code == 200, r.text
        m = r.json()
        assert "Best, Sam" not in m["body"], f"signature leaked when include_signature=False: {m['body']!r}"
        assert "-- " not in m["body"], f"signature delimiter present: {m['body']!r}"


# ---------- 7. Regression checks ----------
class TestRegression:
    def test_auth_me_no_password_hash(self):
        r = requests.get(f"{API}/auth/me", headers=_h(state["token"]), timeout=10)
        assert r.status_code == 200
        u = r.json()
        assert "password_hash" not in u, list(u.keys())

    def test_billing_plans_three(self):
        r = requests.get(f"{API}/billing/plans", timeout=10)
        assert r.status_code == 200
        plans = r.json().get("plans", [])
        tiers = sorted(p["tier"] for p in plans)
        assert tiers == ["free", "plus", "pro"], tiers

    def test_ai_start_chat(self):
        r = requests.post(f"{API}/ai/start-chat", headers=_h(state["token"]), timeout=15)
        assert r.status_code == 200, r.text
        c = r.json()
        assert "ai-assistant-wave" in c["member_ids"]
        assert "_id" not in c


# ---------- Cleanup ----------
@pytest.fixture(scope="session", autouse=True)
def _cleanup():
    yield
    tok = state.get("token")
    if tok:
        try:
            requests.delete(f"{API}/auth/me", headers=_h(tok), timeout=15)
        except Exception:
            pass
