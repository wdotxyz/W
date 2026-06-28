"""Tests for the Profile Setup flow: POST /api/auth/profile + GET /api/auth/me.

Verifies that name, avatar (base64 data URI), and about persist to MongoDB
and are returned through /auth/me.
"""
import base64
import os
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    raise RuntimeError("EXPO_PUBLIC_BACKEND_URL not set")

API = f"{BASE_URL}/api"

PETER_EMAIL = "peter@w.xyz"
PETER_PASSWORD = "PeterW2026!"


def _make_dummy_b64_data_uri(size_bytes: int = 50 * 1024) -> str:
    """Build a small base64 data URI (~50 KB raw -> ~67 KB b64)."""
    raw = b"\x89PNG\r\n\x1a\n" + os.urandom(size_bytes)
    b64 = base64.b64encode(raw).decode()
    return f"data:image/png;base64,{b64}"


@pytest.fixture(scope="module")
def auth_token():
    """Log in Peter and return JWT."""
    r = requests.post(
        f"{API}/auth/login",
        json={"email": PETER_EMAIL, "password": PETER_PASSWORD},
        timeout=15,
    )
    assert r.status_code == 200, f"Login failed: {r.status_code} {r.text}"
    data = r.json()
    assert "token" in data, f"No token in login response: {data}"
    return data["token"]


@pytest.fixture
def auth_headers(auth_token):
    return {"Authorization": f"Bearer {auth_token}", "Content-Type": "application/json"}


# ----- /auth/profile: name + avatar + about -----
class TestProfileUpdate:
    def test_profile_update_with_avatar_and_about(self, auth_headers):
        avatar_uri = _make_dummy_b64_data_uri()
        payload = {
            "name": "Peter Williams",
            "avatar": avatar_uri,
            "about": "Available",
        }
        r = requests.post(f"{API}/auth/profile", headers=auth_headers, json=payload, timeout=20)
        assert r.status_code == 200, f"Profile update failed: {r.status_code} {r.text}"
        data = r.json()
        assert data.get("name") == "Peter Williams"
        assert data.get("avatar") == avatar_uri
        assert data.get("about") == "Available"

        # GET /auth/me should reflect persisted values
        me = requests.get(f"{API}/auth/me", headers=auth_headers, timeout=10)
        assert me.status_code == 200, me.text
        m = me.json()
        assert m.get("name") == "Peter Williams"
        assert m.get("avatar") == avatar_uri, "Avatar data URI did not persist"
        assert m.get("about") == "Available"

    def test_profile_about_whatsapp_style(self, auth_headers):
        payload = {
            "name": "Peter Williams",
            "avatar": None,
            "about": "Hey there! I'm using Wave.",
        }
        r = requests.post(f"{API}/auth/profile", headers=auth_headers, json=payload, timeout=15)
        assert r.status_code == 200, f"{r.status_code} {r.text}"
        assert r.json().get("about") == "Hey there! I'm using Wave."

        me = requests.get(f"{API}/auth/me", headers=auth_headers, timeout=10).json()
        assert me.get("about") == "Hey there! I'm using Wave."

    def test_profile_about_139_char_max(self, auth_headers):
        # 139 chars exactly — the WhatsApp-style cap
        long_about = "a" * 139
        r = requests.post(
            f"{API}/auth/profile",
            headers=auth_headers,
            json={"name": "Peter Williams", "avatar": None, "about": long_about},
            timeout=15,
        )
        assert r.status_code == 200, r.text
        assert r.json().get("about") == long_about
        me = requests.get(f"{API}/auth/me", headers=auth_headers, timeout=10).json()
        assert me.get("about") == long_about

    def test_profile_clear_avatar(self, auth_headers):
        """Sending avatar=null should clear avatar in DB."""
        r = requests.post(
            f"{API}/auth/profile",
            headers=auth_headers,
            json={"name": "Peter Williams", "avatar": None, "about": "Busy"},
            timeout=15,
        )
        assert r.status_code == 200, r.text
        me = requests.get(f"{API}/auth/me", headers=auth_headers, timeout=10).json()
        assert me.get("avatar") is None
        assert me.get("about") == "Busy"

    def test_profile_unauth_rejected(self):
        r = requests.post(
            f"{API}/auth/profile",
            json={"name": "Hacker"},
            timeout=10,
        )
        assert r.status_code in (401, 403), f"Expected 401/403, got {r.status_code}"
