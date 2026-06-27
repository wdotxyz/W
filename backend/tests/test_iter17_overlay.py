"""Iteration 17 regression — login + admin stats access control."""
import os
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://message-hub-1215.preview.emergentagent.com").rstrip("/")


@pytest.fixture(scope="module")
def peter_token():
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"email": "peter@w.xyz", "password": "PeterW2026!"},
                      timeout=20)
    assert r.status_code == 200, f"peter login failed: {r.status_code} {r.text}"
    data = r.json()
    assert "token" in data
    return data["token"]


@pytest.fixture(scope="module")
def support_token():
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"email": "support@w.xyz", "password": "WSupport2026!"},
                      timeout=20)
    assert r.status_code == 200, f"support login failed: {r.status_code} {r.text}"
    return r.json()["token"]


# ---- auth/login regression ------------------------------------------------
class TestAuthLogin:
    def test_peter_login_200(self, peter_token):
        assert peter_token

    def test_support_login_200(self, support_token):
        assert support_token


# ---- admin stats access ---------------------------------------------------
class TestAdminStats:
    def test_admin_stats_support_200(self, support_token):
        r = requests.get(f"{BASE_URL}/api/admin/stats",
                         headers={"Authorization": f"Bearer {support_token}"},
                         timeout=20)
        assert r.status_code == 200, r.text
        body = r.json()
        for key in ("as_of", "volume", "projection", "pricing", "recommendation", "users", "support"):
            assert key in body, f"missing key {key}"
        assert body["recommendation"]["verdict"] in ("stay", "plan", "migrate")
        assert "monthly_outbound" in body["projection"]
        assert "sendgrid_monthly" in body["pricing"]

    def test_admin_stats_peter_403(self, peter_token):
        r = requests.get(f"{BASE_URL}/api/admin/stats",
                         headers={"Authorization": f"Bearer {peter_token}"},
                         timeout=20)
        assert r.status_code == 403, r.text

    def test_admin_stats_no_auth_401(self):
        r = requests.get(f"{BASE_URL}/api/admin/stats", timeout=20)
        assert r.status_code in (401, 403), r.text
