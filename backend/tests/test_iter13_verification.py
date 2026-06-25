"""Iteration 13 verification: Ghost mail perk + regressions."""
import os
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL") or os.environ.get("EXPO_BACKEND_URL")
assert BASE_URL, "EXPO_PUBLIC_BACKEND_URL not set"
BASE_URL = BASE_URL.rstrip("/")

EXPECTED_GHOST_MAIL = (
    "Ghost mail|For privacy reasons, all incoming and outgoing emails are deleted as soon as "
    "you close it out. Unless they are starred, that is."
)

EXPECTED_FREE_PERKS = [
    "Premium @w.xyz address",
    "1 GB storage",
    "Custom Email Addresses Using Your Own Domains",
    EXPECTED_GHOST_MAIL,
]

EXPECTED_PLUS_PERKS = [
    "Everything in Essentials",
    "50 GB storage",
    "5-Character @w.xyz handles available (Optional)",
    "Verified blue check",
    "AI Assistant",
    "Priority Support",
]

EXPECTED_PRO_PERKS = [
    "Everything in Plus",
    "100 GB storage",
    "4 & 5-Character @w.xyz handles available (Optional)",
]


@pytest.fixture(scope="module")
def s():
    sess = requests.Session()
    sess.headers.update({"Content-Type": "application/json"})
    return sess


# --- Billing plans -----------------------------------------------------------
class TestBillingPlans:
    def test_plans_status_200(self, s):
        r = s.get(f"{BASE_URL}/api/billing/plans", timeout=20)
        assert r.status_code == 200
        body = r.json()
        assert "plans" in body and len(body["plans"]) == 3

    def test_free_perks_exact_with_ghost_mail(self, s):
        r = s.get(f"{BASE_URL}/api/billing/plans", timeout=20)
        plans = {p["tier"]: p for p in r.json()["plans"]}
        free = plans["free"]
        assert free["label"] == "Essentials"
        assert free["perks"] == EXPECTED_FREE_PERKS, (
            f"Mismatch.\nGot: {free['perks']}\nWant: {EXPECTED_FREE_PERKS}"
        )
        # Spot-check the ghost mail entry specifically
        assert EXPECTED_GHOST_MAIL in free["perks"]
        ghost = free["perks"][3]
        assert ghost.startswith("Ghost mail|")
        label, info = ghost.split("|", 1)
        assert label == "Ghost mail"
        assert info == (
            "For privacy reasons, all incoming and outgoing emails are deleted as soon as "
            "you close it out. Unless they are starred, that is."
        )

    def test_plus_perks_unchanged(self, s):
        r = s.get(f"{BASE_URL}/api/billing/plans", timeout=20)
        plans = {p["tier"]: p for p in r.json()["plans"]}
        assert plans["plus"]["perks"] == EXPECTED_PLUS_PERKS
        # No info markers
        for perk in plans["plus"]["perks"]:
            assert "|" not in perk

    def test_pro_perks_unchanged(self, s):
        r = s.get(f"{BASE_URL}/api/billing/plans", timeout=20)
        plans = {p["tier"]: p for p in r.json()["plans"]}
        assert plans["pro"]["perks"] == EXPECTED_PRO_PERKS
        for perk in plans["pro"]["perks"]:
            assert "|" not in perk

    def test_only_ghost_mail_has_info_marker(self, s):
        """Regression: only Ghost mail row in free plan should have a |info marker."""
        r = s.get(f"{BASE_URL}/api/billing/plans", timeout=20)
        plans = r.json()["plans"]
        info_perks = []
        for p in plans:
            for perk in p["perks"]:
                if "|" in perk:
                    info_perks.append((p["tier"], perk))
        assert len(info_perks) == 1
        assert info_perks[0][0] == "free"
        assert info_perks[0][1].startswith("Ghost mail|")


# --- Auth regression ---------------------------------------------------------
class TestAuthRegression:
    def test_login_peter_still_200(self, s):
        r = s.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": "peter@w.xyz", "password": "PeterW2026!"},
            timeout=20,
        )
        assert r.status_code == 200, f"Login failed: {r.status_code} {r.text}"
        body = r.json()
        assert "token" in body and isinstance(body["token"], str) and len(body["token"]) > 10
        assert "user" in body
        assert body["user"].get("email_address") == "peter@w.xyz"
