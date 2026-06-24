"""Backend regression tests covering:
- /api/auth/login happy path (peter@w.xyz / PeterW2026!)
- /api/auth/login negative cases (wrong password, unknown user)
- /api/auth/me with token from login
- /api/support/contact ticket creation (regression)
"""
import os
import pytest
import requests

BASE_URL = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/")
EMAIL = "peter@w.xyz"
PASSWORD = "PeterW2026!"


@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def login_payload(session):
    """Reset failed_logins via successful login first."""
    r = session.post(f"{BASE_URL}/api/auth/login", json={"email": EMAIL, "password": PASSWORD})
    assert r.status_code == 200, f"Initial login failed: {r.status_code} {r.text}"
    return r.json()


# ---------- Auth login: happy path ----------
class TestAuthLogin:
    def test_login_success_full_email(self, session, login_payload):
        data = login_payload
        assert "token" in data and isinstance(data["token"], str) and len(data["token"]) > 10
        assert "user" in data and isinstance(data["user"], dict)
        assert data["user"].get("email_address") == EMAIL
        assert "password_hash" not in data["user"]

    def test_login_wrong_password_returns_401(self, session):
        r = session.post(f"{BASE_URL}/api/auth/login", json={"email": EMAIL, "password": "WrongPass123!"})
        # Note: 429 if locked from previous failures, treat as expected after-many-failures
        assert r.status_code in (401, 429), f"Expected 401, got {r.status_code} {r.text}"

    def test_login_unknown_user_returns_401(self, session):
        r = session.post(f"{BASE_URL}/api/auth/login",
                         json={"email": "nonexistent@w.xyz", "password": "AnyPass123!"})
        assert r.status_code == 401

    def test_login_handle_only_returns_401_at_backend(self, session):
        # The backend itself rejects emails without '@'. The frontend appends '@w.xyz'.
        r = session.post(f"{BASE_URL}/api/auth/login", json={"email": "peter", "password": PASSWORD})
        assert r.status_code == 401


# ---------- /api/auth/me ----------
class TestAuthMe:
    def test_me_with_valid_token(self, session, login_payload):
        token = login_payload["token"]
        r = session.get(f"{BASE_URL}/api/auth/me", headers={"Authorization": f"Bearer {token}"})
        assert r.status_code == 200
        user = r.json()
        assert user.get("email_address") == EMAIL
        assert "password_hash" not in user

    def test_me_without_token(self, session):
        # Open new session to avoid header pollution
        s = requests.Session()
        r = s.get(f"{BASE_URL}/api/auth/me")
        assert r.status_code in (401, 403)


# ---------- /api/support/contact regression ----------
class TestSupportTicket:
    def test_create_support_ticket(self, session, login_payload):
        token = login_payload["token"]
        payload = {
            "subject": "TEST_signin_bugfix iteration",
            "message": "TEST_ regression check after signin auto-append fix",
            "category": "general",
        }
        r = session.post(
            f"{BASE_URL}/api/support/contact",
            json=payload,
            headers={"Authorization": f"Bearer {token}"},
        )
        assert r.status_code == 200, f"{r.status_code} {r.text}"
        data = r.json()
        assert "ticket_id" in data and isinstance(data["ticket_id"], str)
