"""Support contact form (/api/support/contact, /api/support/my-tickets) tests."""
import os
import time
import requests
import pytest
from pymongo import MongoClient

BASE = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://message-hub-1215.preview.emergentagent.com").rstrip("/")
API = f"{BASE}/api"
MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "wave_chat")

PHONE = f"+1777{int(time.time()) % 10000000:07d}"

state = {}
_mongo_client = MongoClient(MONGO_URL)
_db = _mongo_client[DB_NAME]


def _register(phone):
    r = requests.post(f"{API}/auth/send-otp", json={"phone": phone}, timeout=15)
    # Twilio trial may reject unverified 'To' numbers (400). OTP is still
    # stored in Mongo BEFORE the SMS attempt -> fallback by reading it.
    otp = None
    if r.status_code == 200:
        otp = r.json().get("dev_otp")
    if not otp:
        rec = _db.otps.find_one({"phone": phone})
        assert rec, f"OTP missing in DB; send-otp said: {r.status_code} {r.text}"
        otp = rec["otp"]
    r2 = requests.post(f"{API}/auth/verify-otp", json={"phone": phone, "otp": otp}, timeout=15)
    assert r2.status_code == 200, r2.text
    d = r2.json()
    return d["token"], d["user"]


# ---------- sanity ----------
def test_00_register_test_user():
    state["token"], state["user"] = _register(PHONE)
    assert "id" in state["user"]


def test_01_auth_me_works():
    r = requests.get(f"{API}/auth/me", headers={"Authorization": f"Bearer {state['token']}"}, timeout=15)
    assert r.status_code == 200, r.text
    assert r.json()["id"] == state["user"]["id"]


# ---------- /api/support/contact ----------
def test_10_support_contact_unauthenticated_rejected():
    r = requests.post(f"{API}/support/contact", json={
        "subject": "Hello",
        "message": "This is a long enough message for the support form.",
        "category": "general",
    }, timeout=15)
    assert r.status_code in (401, 403), f"expected 401/403, got {r.status_code}: {r.text}"


def test_11_support_contact_valid_creates_ticket():
    h = {"Authorization": f"Bearer {state['token']}"}
    payload = {
        "subject": "TEST_Cannot send mail",
        "message": "When I tap Send on the compose screen nothing happens. Please help.",
        "category": "bug",
    }
    r = requests.post(f"{API}/support/contact", json=payload, headers=h, timeout=15)
    assert r.status_code == 200, r.text
    j = r.json()
    assert j.get("ok") is True
    assert "ticket_id" in j and isinstance(j["ticket_id"], str) and len(j["ticket_id"]) > 0
    assert isinstance(j.get("message"), str) and len(j["message"]) > 0
    state["ticket_id"] = j["ticket_id"]


def test_12_support_contact_empty_subject_returns_400():
    h = {"Authorization": f"Bearer {state['token']}"}
    r = requests.post(f"{API}/support/contact", json={
        "subject": "",
        "message": "This is a long enough message for the support form.",
        "category": "general",
    }, headers=h, timeout=15)
    assert r.status_code == 400, f"expected 400, got {r.status_code}: {r.text}"


def test_13_support_contact_short_subject_returns_400():
    h = {"Authorization": f"Bearer {state['token']}"}
    r = requests.post(f"{API}/support/contact", json={
        "subject": "Hi",  # 2 chars, < 3
        "message": "This is a long enough message for the support form.",
        "category": "general",
    }, headers=h, timeout=15)
    assert r.status_code == 400


def test_14_support_contact_short_message_returns_400():
    h = {"Authorization": f"Bearer {state['token']}"}
    r = requests.post(f"{API}/support/contact", json={
        "subject": "Valid subject",
        "message": "too short",  # 9 chars
        "category": "general",
    }, headers=h, timeout=15)
    assert r.status_code == 400, f"expected 400, got {r.status_code}: {r.text}"


def test_15_support_contact_oversized_subject_returns_400():
    h = {"Authorization": f"Bearer {state['token']}"}
    r = requests.post(f"{API}/support/contact", json={
        "subject": "x" * 201,
        "message": "This is a long enough message for the support form.",
        "category": "general",
    }, headers=h, timeout=15)
    assert r.status_code == 400


# ---------- /api/support/my-tickets ----------
def test_20_my_tickets_returns_created_ticket():
    h = {"Authorization": f"Bearer {state['token']}"}
    r = requests.get(f"{API}/support/my-tickets", headers=h, timeout=15)
    assert r.status_code == 200, r.text
    j = r.json()
    assert "tickets" in j and isinstance(j["tickets"], list)
    ids = [t.get("id") for t in j["tickets"]]
    assert state.get("ticket_id") in ids, f"created ticket not in list: {ids}"
    # verify _id is excluded (no mongo ObjectId leak)
    for t in j["tickets"]:
        assert "_id" not in t
        assert t.get("user_id") == state["user"]["id"]
        # required fields
        for key in ("id", "subject", "message", "category", "status", "created_at"):
            assert key in t, f"missing {key} in ticket: {t}"
    # Find our ticket and validate field values
    our = next(t for t in j["tickets"] if t["id"] == state["ticket_id"])
    assert our["subject"] == "TEST_Cannot send mail"
    assert our["category"] == "bug"
    assert our["status"] == "open"


def test_21_my_tickets_unauthenticated_rejected():
    r = requests.get(f"{API}/support/my-tickets", timeout=15)
    assert r.status_code in (401, 403)


def test_22_other_user_does_not_see_tickets():
    # Register a second user and confirm tickets are scoped per user
    phone2 = f"+1888{int(time.time()) % 10000000:07d}"
    token2, _ = _register(phone2)
    r = requests.get(f"{API}/support/my-tickets", headers={"Authorization": f"Bearer {token2}"}, timeout=15)
    assert r.status_code == 200
    ids = [t.get("id") for t in r.json().get("tickets", [])]
    assert state["ticket_id"] not in ids


# ---------- cleanup ----------
def test_99_cleanup():
    # Best-effort cleanup via mongo
    try:
        from motor.motor_asyncio import AsyncIOMotorClient
        import asyncio
        async def _wipe():
            mongo_url = os.environ.get("MONGO_URL")
            if not mongo_url:
                return
            db_name = os.environ.get("DB_NAME", "test_database")
            client = AsyncIOMotorClient(mongo_url)
            db = client[db_name]
            await db.support_tickets.delete_many({"user_id": state["user"]["id"]})
            await db.users.delete_many({"id": state["user"]["id"]})
            await db.otps.delete_many({"phone": PHONE})
            client.close()
        asyncio.get_event_loop().run_until_complete(_wipe())
    except Exception as e:
        print(f"cleanup skipped: {e}")
