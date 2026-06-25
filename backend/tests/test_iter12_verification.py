"""Iteration 12 verification tests.

Covers:
1. GET /api/billing/plans returns the exact perk lists for free/plus/pro
2. POST /api/auth/login still works for peter@w.xyz / PeterW2026!
3. POST /api/support/contact still returns 200
"""
import os
import pytest
import requests

BASE_URL = (
    os.environ.get("EXPO_BACKEND_URL")
    or os.environ.get("EXPO_PUBLIC_BACKEND_URL")
    or "https://message-hub-1215.preview.emergentagent.com"
).rstrip("/")
EMAIL = "peter@w.xyz"
PASSWORD = "PeterW2026!"


@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def token(session):
    r = session.post(f"{BASE_URL}/api/auth/login", json={"email": EMAIL, "password": PASSWORD}, timeout=20)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    return r.json()["token"]


# ----- billing plans -----
class TestBillingPlans:
    def test_billing_plans_payload(self, session):
        r = session.get(f"{BASE_URL}/api/billing/plans", timeout=20)
        assert r.status_code == 200, r.text
        data = r.json()
        plans = {p["tier"]: p for p in data["plans"]}

        # Free / Essentials
        free = plans["free"]
        assert free["label"] == "Essentials", f"free.label was {free['label']!r}"
        assert free["perks"] == [
            "Premium @w.xyz address",
            "1 GB storage",
            "Custom Email Addresses Using Your Own Domains",
            "Ghost mail (Privacy Enforced Emails that Disappear Instantly)",
        ], f"free.perks mismatch: {free['perks']}"

        # Plus
        plus = plans["plus"]
        assert plus["label"] == "Plus", f"plus.label was {plus['label']!r}"
        assert plus["perks"] == [
            "Everything in Essentials",
            "50 GB storage",
            "5-Character @w.xyz handles available (Optional)",
            "Verified blue check",
            "AI Assistant",
            "Priority Support",
        ], f"plus.perks mismatch: {plus['perks']}"

        # Pro
        pro = plans["pro"]
        assert pro["label"] == "Pro", f"pro.label was {pro['label']!r}"
        assert pro["perks"] == [
            "Everything in Plus",
            "100 GB storage",
            "4 & 5-Character @w.xyz handles available (Optional)",
        ], f"pro.perks mismatch: {pro['perks']}"


# ----- auth regression -----
class TestAuthLogin:
    def test_login_peter(self, session):
        r = session.post(f"{BASE_URL}/api/auth/login", json={"email": EMAIL, "password": PASSWORD}, timeout=20)
        assert r.status_code == 200, f"unexpected status {r.status_code}: {r.text}"
        body = r.json()
        assert "token" in body and body["token"], "missing token"
        assert body["user"]["email_address"] == EMAIL


# ----- support contact regression -----
class TestSupport:
    def test_support_contact_ok(self, session, token):
        s = requests.Session()
        s.headers.update({"Content-Type": "application/json", "Authorization": f"Bearer {token}"})
        payload = {
            "subject": "TEST_iter12 placeholder fix",
            "message": "TEST_iter12 — verifying support/contact still returns 200 after billing copy refresh.",
            "category": "general",
        }
        r = s.post(f"{BASE_URL}/api/support/contact", json=payload, timeout=20)
        assert r.status_code == 200, f"support/contact returned {r.status_code}: {r.text}"
        body = r.json()
        assert body.get("ok") is True
