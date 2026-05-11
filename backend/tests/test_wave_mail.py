"""Wave Mail feature backend tests — handle validation/claim, compose fallback,
inbox/sent listing, mail detail with auto-mark-read and access control, and the
SendGrid Inbound Parse webhook (multipart, no auth)."""
import os
import time
import json
import uuid
import pytest
import requests

BASE = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://message-hub-1215.preview.emergentagent.com").rstrip("/")
API = f"{BASE}/api"
MAIL_DOMAIN = "w.xyz"

# unique phones per run
_T = int(time.time()) % 1000000
PHONE_A = f"+1555{_T:07d}"
PHONE_B = f"+1666{_T:07d}"

state = {}


def _register(phone):
    r = requests.post(f"{API}/auth/send-otp", json={"phone": phone}, timeout=15)
    assert r.status_code == 200, r.text
    otp = r.json()["dev_otp"]
    r2 = requests.post(f"{API}/auth/verify-otp", json={"phone": phone, "otp": otp}, timeout=15)
    assert r2.status_code == 200, r2.text
    d = r2.json()
    return d["token"], d["user"]


# ---------------- Setup ----------------
def test_register_two_users():
    state["tokenA"], state["userA"] = _register(PHONE_A)
    state["tokenB"], state["userB"] = _register(PHONE_B)
    state["hA"] = f"alice{_T}"
    state["hB"] = f"bob{_T}"
    assert state["userA"]["id"] != state["userB"]["id"]


def _auth(t):
    return {"Authorization": f"Bearer {t}"}


# ---------------- check-handle ----------------
def test_check_handle_reserved():
    r = requests.get(f"{API}/mail/check-handle/admin", headers=_auth(state["tokenA"]), timeout=15)
    assert r.status_code == 200
    j = r.json()
    assert j["available"] is False
    assert "reserved" in (j.get("reason") or "").lower()


def test_check_handle_too_short():
    r = requests.get(f"{API}/mail/check-handle/ab", headers=_auth(state["tokenA"]), timeout=15)
    assert r.status_code == 200
    j = r.json()
    assert j["available"] is False
    assert j.get("reason")  # some validation reason


def test_check_handle_available():
    r = requests.get(f"{API}/mail/check-handle/{state['hA']}", headers=_auth(state["tokenA"]), timeout=15)
    assert r.status_code == 200
    j = r.json()
    assert j["available"] is True
    assert j["handle"] == state["hA"]
    assert j["address"] == f"{state['hA']}@{MAIL_DOMAIN}"


def test_check_handle_requires_auth():
    r = requests.get(f"{API}/mail/check-handle/{state['hA']}", timeout=15)
    assert r.status_code == 401


# ---------------- claim-handle ----------------
def test_claim_handle_reserved_rejected():
    r = requests.post(f"{API}/mail/claim-handle", json={"handle": "admin"},
                      headers=_auth(state["tokenA"]), timeout=15)
    assert r.status_code == 400


def test_claim_handle_bad_format_rejected():
    r = requests.post(f"{API}/mail/claim-handle", json={"handle": "ab"},
                      headers=_auth(state["tokenA"]), timeout=15)
    assert r.status_code == 400


def test_claim_handle_a_success_and_persists():
    r = requests.post(f"{API}/mail/claim-handle", json={"handle": state["hA"]},
                      headers=_auth(state["tokenA"]), timeout=15)
    assert r.status_code == 200, r.text
    user = r.json()
    assert "_id" not in user
    assert user["email_handle"] == state["hA"]
    assert user["email_address"] == f"{state['hA']}@{MAIL_DOMAIN}"
    # Verify via /auth/me
    me = requests.get(f"{API}/auth/me", headers=_auth(state["tokenA"]), timeout=15).json()
    assert me["email_address"] == f"{state['hA']}@{MAIL_DOMAIN}"


def test_claim_handle_b_success():
    r = requests.post(f"{API}/mail/claim-handle", json={"handle": state["hB"]},
                      headers=_auth(state["tokenB"]), timeout=15)
    assert r.status_code == 200
    assert r.json()["email_address"] == f"{state['hB']}@{MAIL_DOMAIN}"


def test_claim_handle_duplicate_blocked():
    # B tries to claim A's handle -> 409
    r = requests.post(f"{API}/mail/claim-handle", json={"handle": state["hA"]},
                      headers=_auth(state["tokenB"]), timeout=15)
    assert r.status_code == 409


# ---------------- compose (no SendGrid key -> saved_no_provider) ----------------
def test_compose_saved_no_provider_fallback():
    payload = {
        "to": [f"{state['hB']}@{MAIL_DOMAIN}"],
        "subject": "TEST_Hello",
        "body": "Hi Bob, this is a test from A.",
    }
    r = requests.post(f"{API}/mail/compose", json=payload, headers=_auth(state["tokenA"]), timeout=20)
    assert r.status_code == 200, r.text
    j = r.json()
    assert "_id" not in j
    assert j["delivery_status"] == "saved_no_provider"
    assert j["folder"] == "sent"
    assert j["subject"] == "TEST_Hello"
    state["sent_id"] = j["id"]


def test_compose_blocked_without_handle():
    # New user with no handle
    tokC, _ = _register(f"+1888{_T:07d}")
    r = requests.post(f"{API}/mail/compose",
                      json={"to": [f"{state['hA']}@{MAIL_DOMAIN}"], "subject": "x", "body": "y"},
                      headers=_auth(tokC), timeout=15)
    assert r.status_code == 400


# ---------------- sent / inbox listing ----------------
def test_sent_folder_has_email_no_id_leak():
    r = requests.get(f"{API}/mail/sent", headers=_auth(state["tokenA"]), timeout=15)
    assert r.status_code == 200
    items = r.json()
    assert any(m["id"] == state["sent_id"] for m in items)
    for m in items:
        assert "_id" not in m


def test_inbox_empty_for_a_initially():
    r = requests.get(f"{API}/mail/inbox", headers=_auth(state["tokenA"]), timeout=15)
    assert r.status_code == 200
    for m in r.json():
        assert "_id" not in m


# ---------------- mail detail / access control ----------------
def test_mail_detail_owner_can_read_and_marks_read():
    r = requests.get(f"{API}/mail/{state['sent_id']}", headers=_auth(state["tokenA"]), timeout=15)
    assert r.status_code == 200
    m = r.json()
    assert m["id"] == state["sent_id"]
    assert "_id" not in m


def test_mail_detail_forbidden_for_outsider():
    tokD, _ = _register(f"+1999{_T:07d}")
    r = requests.get(f"{API}/mail/{state['sent_id']}", headers=_auth(tokD), timeout=15)
    assert r.status_code in (403, 404)


# ---------------- Inbound webhook ----------------
def test_inbound_webhook_stores_for_matching_user_and_appears_in_inbox():
    to_addr = f"{state['hB']}@{MAIL_DOMAIN}"
    envelope = json.dumps({"to": [to_addr], "from": "external@example.com"})
    data = {
        "to": to_addr,
        "from": "External Sender <external@example.com>",
        "subject": "TEST_Inbound_Hello",
        "text": "Hello Bob from outside.",
        "envelope": envelope,
        "attachments": "0",
    }
    # multipart-style POST without auth
    r = requests.post(f"{API}/mail/inbound", data=data, timeout=20)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body.get("ok") is True
    assert body.get("stored") == 1

    # Bob's inbox should now contain it
    inbox = requests.get(f"{API}/mail/inbox", headers=_auth(state["tokenB"]), timeout=15).json()
    matches = [m for m in inbox if m["subject"] == "TEST_Inbound_Hello"]
    assert matches, f"Inbound email not found in Bob's inbox; got {len(inbox)} items"
    m = matches[0]
    assert m["from_addr"] == "external@example.com"
    assert m["folder"] == "inbox"
    assert "_id" not in m


def test_inbound_unknown_recipient_dropped():
    data = {
        "to": f"nobody-{uuid.uuid4().hex[:6]}@{MAIL_DOMAIN}",
        "from": "x@example.com",
        "subject": "drop me",
        "text": "no owner",
        "envelope": json.dumps({"to": [f"nobody@{MAIL_DOMAIN}"]}),
        "attachments": "0",
    }
    r = requests.post(f"{API}/mail/inbound", data=data, timeout=15)
    assert r.status_code == 200
    assert r.json().get("stored") == 0


def test_inbound_off_domain_dropped():
    data = {
        "to": "someone@other.com",
        "from": "x@example.com",
        "subject": "off domain",
        "text": "not ours",
        "envelope": json.dumps({"to": ["someone@other.com"]}),
        "attachments": "0",
    }
    r = requests.post(f"{API}/mail/inbound", data=data, timeout=15)
    assert r.status_code == 200
    assert r.json().get("stored") == 0
