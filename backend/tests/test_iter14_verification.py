"""
Iteration 14 backend regression tests:
- Sign-in bug fix verification (login still 200 for seeded user)
- Storage cap regression — billing/me returns 10 MB cap
- Billing plans free.perks contains '10 MB storage'
- Mail inbound webhook returns 200 (fix for inverted await check)
- Support contact endpoint regression
"""
import io
import os

import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://message-hub-1215.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

EMAIL = "peter@w.xyz"
PASSWORD = "PeterW2026!"


@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def token(session):
    r = session.post(f"{API}/auth/login", json={"email": EMAIL, "password": PASSWORD})
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    data = r.json()
    assert "token" in data and "user" in data
    return data["token"]


@pytest.fixture(scope="module")
def auth_headers(token):
    return {"Authorization": f"Bearer {token}"}


# ---- AUTH ----
class TestAuth:
    def test_login_success(self, session):
        r = session.post(f"{API}/auth/login", json={"email": EMAIL, "password": PASSWORD})
        assert r.status_code == 200
        data = r.json()
        assert data.get("token")
        assert data["user"].get("email_address") == EMAIL

    def test_login_wrong_password_401(self, session):
        r = session.post(f"{API}/auth/login", json={"email": EMAIL, "password": "WRONG_PWD_xyz"})
        assert r.status_code in (400, 401, 403), f"got {r.status_code} {r.text}"


# ---- BILLING ----
class TestBillingStorage:
    def test_billing_me_storage_cap(self, session, auth_headers):
        r = session.get(f"{API}/billing/me", headers=auth_headers)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data.get("storage_mb") == 10, f"expected storage_mb=10, got {data.get('storage_mb')}"
        assert data.get("storage_limit_bytes") == 10 * 1024 * 1024, \
            f"expected 10485760, got {data.get('storage_limit_bytes')}"

    def test_billing_plans_free_perks_has_10mb(self, session):
        r = session.get(f"{API}/billing/plans")
        assert r.status_code == 200
        data = r.json()
        plans = {p["tier"]: p for p in data["plans"]}
        free_perks = plans["free"]["perks"]
        # the perk should literally contain '10 MB storage'
        assert any("10 MB storage" in p for p in free_perks), \
            f"free.perks missing '10 MB storage': {free_perks}"
        # ensure '1 GB storage' is NOT present in any perk
        assert not any("1 GB storage" in p for p in free_perks), \
            f"free.perks should not contain '1 GB storage': {free_perks}"

    def test_billing_plans_free_has_ghost_mail_info(self, session):
        r = session.get(f"{API}/billing/plans")
        assert r.status_code == 200
        free_perks = [p for p in r.json()["plans"] if p["tier"] == "free"][0]["perks"]
        ghost = [p for p in free_perks if p.startswith("Ghost mail|")]
        assert len(ghost) == 1, f"expected exactly one Ghost mail|info perk: {free_perks}"


# ---- MAIL INBOUND (multipart) ----
class TestMailInbound:
    def test_inbound_no_attachments_returns_200(self):
        # use a plain requests.post (not the JSON session)
        data = {
            "to": "peter@w.xyz",
            "from": "TEST_sender@example.com",
            "subject": "TEST_inbound_no_attach",
            "text": "Hello from inbound test",
            "envelope": '{"to":["peter@w.xyz"],"from":"TEST_sender@example.com"}',
            "attachments": "0",
        }
        r = requests.post(f"{API}/mail/inbound", data=data, timeout=30)
        assert r.status_code == 200, f"inbound failed: {r.status_code} {r.text}"
        body = r.json()
        assert body.get("ok") is True

    def test_inbound_with_attachment_returns_200(self):
        files = {
            "attachment1": ("note.txt", io.BytesIO(b"hello-attachment-bytes"), "text/plain"),
        }
        data = {
            "to": "peter@w.xyz",
            "from": "TEST_sender2@example.com",
            "subject": "TEST_inbound_with_attach",
            "text": "Has attachment",
            "envelope": '{"to":["peter@w.xyz"],"from":"TEST_sender2@example.com"}',
            "attachments": "1",
        }
        r = requests.post(f"{API}/mail/inbound", data=data, files=files, timeout=30)
        assert r.status_code == 200, f"inbound w/ attachment failed: {r.status_code} {r.text}"
        body = r.json()
        assert body.get("ok") is True


# ---- SUPPORT (light regression) ----
class TestSupport:
    def test_support_contact_returns_200(self, session, auth_headers):
        r = session.post(
            f"{API}/support/contact",
            headers=auth_headers,
            json={"subject": "TEST_iter14", "message": "Regression sweep", "category": "general"},
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("ok") is True or body.get("id") or body.get("ticket")


# ---- SETTINGS-tab dependency endpoints (light regression) ----
class TestSettingsDeps:
    def test_auth_me_after_login(self, session, auth_headers):
        r = session.get(f"{API}/auth/me", headers=auth_headers)
        assert r.status_code == 200
        u = r.json()
        assert u.get("email_address") == EMAIL


# Ensure test data does not poison inbox: clean up TEST_ inbound mails
@pytest.fixture(scope="module", autouse=True)
def cleanup_inbound(auth_headers):
    yield
    try:
        s = requests.Session()
        s.headers.update({"Content-Type": "application/json", **auth_headers})
        inbox = s.get(f"{API}/mail/inbox", timeout=15).json()
        if isinstance(inbox, list):
            for m in inbox:
                subj = (m or {}).get("subject", "")
                if subj.startswith("TEST_inbound"):
                    mid = m.get("id")
                    if mid:
                        s.delete(f"{API}/mail/{mid}", timeout=10)
    except Exception:
        pass
