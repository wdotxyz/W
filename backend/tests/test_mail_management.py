"""Backend tests for new mail-management feature set:
- Ghost Mail toggle (free vs Plus/Pro)
- Thread view + ghost-delete on close
- Per-message star / archive / snooze
- Filtered inbox (excludes archived & future-snoozed)
- Regression: /api/auth/me leaks, billing plans, legacy inbox.
"""
import os
import time
import uuid
from datetime import datetime, timedelta, timezone

import pytest
import requests
from pymongo import MongoClient

# ---------------- Config ----------------
BASE = os.environ.get(
    "EXPO_PUBLIC_BACKEND_URL",
    "https://message-hub-1215.preview.emergentagent.com",
).rstrip("/")
API = f"{BASE}/api"
MAIL_DOMAIN = "w.xyz"

MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "test_database")

_T = int(time.time()) % 10_000_000
PHONE = f"+1777{_T:07d}"
HANDLE = f"ghost{_T}"

state = {}


def _auth(t):
    return {"Authorization": f"Bearer {t}"}


@pytest.fixture(scope="module")
def mongo():
    c = MongoClient(MONGO_URL)
    yield c[DB_NAME]
    c.close()


# ---------------- 1. Setup: register + claim handle ----------------
def test_01_register_user(mongo):
    r = requests.post(f"{API}/auth/send-otp", json={"phone": PHONE}, timeout=20)
    # Twilio may be broken in this env (returns 400) but OTP is still written
    # to db.otps BEFORE the SMS attempt — pull it directly.
    if r.status_code != 200:
        rec = mongo.otps.find_one({"phone": PHONE})
        assert rec, f"OTP not in DB after send-otp failed: {r.status_code} {r.text}"
        otp = rec["otp"]
    else:
        otp = r.json().get("dev_otp")
        if not otp:
            rec = mongo.otps.find_one({"phone": PHONE})
            assert rec, "no OTP record in DB"
            otp = rec["otp"]
    r2 = requests.post(
        f"{API}/auth/verify-otp",
        json={"phone": PHONE, "otp": otp, "password": "TestPass123!"},
        timeout=20,
    )
    assert r2.status_code == 200, r2.text
    d = r2.json()
    state["token"] = d["token"]
    state["user"] = d["user"]
    state["uid"] = d["user"]["id"]
    assert "password_hash" not in d["user"], "password_hash leaked in verify-otp"


def test_02_claim_handle():
    r = requests.post(
        f"{API}/mail/claim-handle",
        json={"handle": HANDLE},
        headers=_auth(state["token"]),
        timeout=20,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["email_address"] == f"{HANDLE}@{MAIL_DOMAIN}"
    assert "password_hash" not in body, "password_hash leaked in claim-handle"
    state["address"] = body["email_address"]


# ---------------- 2. Send 3 inbound emails (same thread) ----------------
def _send_inbound(subject, text, message_id, in_reply_to=None):
    headers_blob = f"Message-ID: {message_id}\n"
    if in_reply_to:
        headers_blob += f"In-Reply-To: {in_reply_to}\n"
    envelope = '{"to": ["%s"], "from": "sender@example.com"}' % state["address"]
    files = {
        "to": (None, state["address"]),
        "from": (None, "Sender <sender@example.com>"),
        "subject": (None, subject),
        "text": (None, text),
        "html": (None, f"<p>{text}</p>"),
        "envelope": (None, envelope),
        "attachments": (None, "0"),
        "headers": (None, headers_blob),
    }
    r = requests.post(f"{API}/mail/inbound", files=files, timeout=20)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body.get("stored", 0) >= 1


def test_03_send_inbound_thread():
    msg1 = f"<test1-{_T}@w.xyz>"
    msg2 = f"<test2-{_T}@w.xyz>"
    msg3 = f"<test3-{_T}@w.xyz>"
    _send_inbound("Hello", "first message", msg1)
    _send_inbound("Re: Hello", "second message", msg2, in_reply_to=msg1)
    _send_inbound("Re: Hello", "third message", msg3, in_reply_to=msg1)
    state["root_msg_id"] = msg1


def test_04_inbox_returns_3():
    r = requests.get(f"{API}/mail/inbox", headers=_auth(state["token"]), timeout=20)
    assert r.status_code == 200, r.text
    items = r.json()
    mine = [m for m in items if state["address"] in [a.lower() for a in m.get("to_addrs", [])]]
    assert len(mine) == 3, f"expected 3 inbox emails, got {len(mine)}"
    # All same thread
    tids = {m["thread_id"] for m in mine}
    assert len(tids) == 1, f"expected single thread, got {tids}"
    state["thread_id"] = tids.pop()
    # collect ids
    state["mail_ids"] = [m["id"] for m in mine]


# ---------------- 3. Archive / Snooze filters ----------------
def test_05_archive_one_excludes_from_inbox():
    target = state["mail_ids"][0]
    r = requests.patch(f"{API}/mail/{target}/archive", headers=_auth(state["token"]), timeout=20)
    assert r.status_code == 200, r.text
    assert r.json() == {"archived": True}
    # Inbox shows 2
    r2 = requests.get(f"{API}/mail/inbox", headers=_auth(state["token"]), timeout=20)
    mine = [m for m in r2.json() if state["address"] in [a.lower() for a in m.get("to_addrs", [])]]
    assert len(mine) == 2, f"expected 2 after archive, got {len(mine)}"
    # Archived list shows 1
    r3 = requests.get(f"{API}/mail/archived", headers=_auth(state["token"]), timeout=20)
    archived = [m for m in r3.json() if state["address"] in [a.lower() for a in m.get("to_addrs", [])]]
    assert len(archived) == 1, f"expected 1 archived, got {len(archived)}"
    state["archived_id"] = target


def test_06_snooze_one_excludes_from_inbox():
    target = state["mail_ids"][1]
    future = (datetime.now(timezone.utc) + timedelta(hours=1)).isoformat()
    r = requests.patch(
        f"{API}/mail/{target}/snooze",
        json={"until": future},
        headers=_auth(state["token"]),
        timeout=20,
    )
    assert r.status_code == 200, r.text
    assert r.json().get("snoozed_until") is not None
    # Inbox now shows 1
    r2 = requests.get(f"{API}/mail/inbox", headers=_auth(state["token"]), timeout=20)
    mine = [m for m in r2.json() if state["address"] in [a.lower() for a in m.get("to_addrs", [])]]
    assert len(mine) == 1, f"expected 1 after snooze, got {len(mine)}"
    # Snoozed list shows 1
    r3 = requests.get(f"{API}/mail/snoozed", headers=_auth(state["token"]), timeout=20)
    snoozed = [m for m in r3.json() if state["address"] in [a.lower() for a in m.get("to_addrs", [])]]
    assert len(snoozed) == 1, f"expected 1 snoozed, got {len(snoozed)}"
    state["snoozed_id"] = target


def test_07_snooze_past_date_rejected():
    target = state["mail_ids"][2]
    past = (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat()
    r = requests.patch(
        f"{API}/mail/{target}/snooze",
        json={"until": past},
        headers=_auth(state["token"]),
        timeout=20,
    )
    assert r.status_code == 400, f"past snooze should 400, got {r.status_code}: {r.text}"


# ---------------- 4. Thread view + Ghost close ----------------
def test_08_thread_view_marks_opened():
    r = requests.get(
        f"{API}/mail/thread/{state['thread_id']}",
        headers=_auth(state["token"]),
        timeout=20,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["thread_id"] == state["thread_id"]
    assert body["ghost_mail_enabled"] is True
    assert isinstance(body["messages"], list)
    assert len(body["messages"]) == 3
    inbox_msgs = [m for m in body["messages"] if m.get("folder") == "inbox"]
    archived_id = state["mail_ids"][0]
    snoozed_id = state["mail_ids"][1]
    target_id = state["mail_ids"][2]
    by_id = {m["id"]: m for m in inbox_msgs}
    # New behaviour (post-fix): get_thread MUST NOT stamp opened_at / read on
    # archived or currently-snoozed messages — otherwise close_thread would
    # nuke them on the next call.
    assert by_id[archived_id].get("opened_at") in (None, ""), (
        f"archived msg should NOT have opened_at: {by_id[archived_id].get('opened_at')}"
    )
    assert by_id[snoozed_id].get("opened_at") in (None, ""), (
        f"snoozed msg should NOT have opened_at: {by_id[snoozed_id].get('opened_at')}"
    )
    # The plain inbox message MUST be marked read + opened_at
    assert by_id[target_id].get("read") is True, "plain msg should be marked read"
    assert by_id[target_id].get("opened_at"), "plain msg should have opened_at"


def test_09_close_thread_ghost_deletes_unstarred_opened():
    """After fix: close_thread should ONLY ghost-delete the non-archived,
    non-snoozed, opened, non-starred inbox messages. We have:
      - mail_ids[0] = archived  → must survive
      - mail_ids[1] = snoozed (+1h) → must survive
      - mail_ids[2] = plain inbox, opened → must be deleted
    Expect deleted == 1 and ids == [mail_ids[2]].
    """
    archived_id = state["mail_ids"][0]
    snoozed_id = state["mail_ids"][1]
    target_id = state["mail_ids"][2]
    r = requests.post(
        f"{API}/mail/thread/{state['thread_id']}/close",
        headers=_auth(state["token"]),
        timeout=20,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["ghost_mail"] is True
    assert body["deleted"] == 1, f"expected exactly 1 deletion (C only), got {body['deleted']}: {body}"
    deleted_ids = body.get("ids", [])
    assert deleted_ids == [target_id], f"expected only C deleted, got {deleted_ids}"
    state["deleted_ids"] = deleted_ids

    # C must 404
    rc = requests.get(f"{API}/mail/{target_id}", headers=_auth(state["token"]), timeout=20)
    assert rc.status_code == 404, f"C ({target_id}) should be gone, got {rc.status_code}: {rc.text}"

    # A (archived) must still exist
    ra = requests.get(f"{API}/mail/{archived_id}", headers=_auth(state["token"]), timeout=20)
    assert ra.status_code == 200, f"archived A ({archived_id}) was wrongly deleted: {ra.status_code} {ra.text}"
    assert ra.json().get("archived") is True, "A should still be flagged archived"

    # B (snoozed) must still exist
    rb = requests.get(f"{API}/mail/{snoozed_id}", headers=_auth(state["token"]), timeout=20)
    assert rb.status_code == 200, f"snoozed B ({snoozed_id}) was wrongly deleted: {rb.status_code} {rb.text}"
    assert rb.json().get("snoozed_until"), "B should still have snoozed_until set"

    # /mail/archived contains A
    ra2 = requests.get(f"{API}/mail/archived", headers=_auth(state["token"]), timeout=20)
    assert ra2.status_code == 200
    arch_ids = [m["id"] for m in ra2.json()]
    assert archived_id in arch_ids, f"A missing from /mail/archived: {arch_ids}"

    # /mail/snoozed contains B
    rs = requests.get(f"{API}/mail/snoozed", headers=_auth(state["token"]), timeout=20)
    assert rs.status_code == 200
    snz_ids = [m["id"] for m in rs.json()]
    assert snoozed_id in snz_ids, f"B missing from /mail/snoozed: {snz_ids}"


# ---------------- 5. Star saves thread from ghost ----------------
def test_10_new_thread_starred_survives_close():
    new_msg_id = f"<keep-{_T}@w.xyz>"
    _send_inbound("Keep me", "important", new_msg_id)
    # Find the new email
    r = requests.get(f"{API}/mail/inbox", headers=_auth(state["token"]), timeout=20)
    mine = [m for m in r.json() if m.get("subject") == "Keep me"]
    assert len(mine) == 1
    keep = mine[0]
    tid = keep["thread_id"]
    state["keep_id"] = keep["id"]
    state["keep_thread"] = tid

    # Open thread
    r2 = requests.get(f"{API}/mail/thread/{tid}", headers=_auth(state["token"]), timeout=20)
    assert r2.status_code == 200, r2.text

    # Star thread
    r3 = requests.post(f"{API}/mail/thread/{tid}/star", headers=_auth(state["token"]), timeout=20)
    assert r3.status_code == 200, r3.text
    assert r3.json()["starred"] is True

    # Close - should NOT delete because starred
    r4 = requests.post(f"{API}/mail/thread/{tid}/close", headers=_auth(state["token"]), timeout=20)
    assert r4.status_code == 200, r4.text
    body = r4.json()
    assert body["deleted"] == 0, f"starred thread should not delete: {body}"
    assert body["ghost_mail"] is True

    # Still accessible
    r5 = requests.get(f"{API}/mail/{state['keep_id']}", headers=_auth(state["token"]), timeout=20)
    assert r5.status_code == 200, "starred email should remain"

    # Shows in starred list
    r6 = requests.get(f"{API}/mail/starred", headers=_auth(state["token"]), timeout=20)
    ids = [m["id"] for m in r6.json()]
    assert state["keep_id"] in ids, "should appear in /mail/starred"


# ---------------- 6. Ghost Mail premium toggle ----------------
def test_11_free_user_get_ghost_mail():
    r = requests.get(f"{API}/auth/ghost-mail", headers=_auth(state["token"]), timeout=20)
    assert r.status_code == 200, r.text
    b = r.json()
    assert b["enabled"] is True, "default should be True"
    assert b["can_disable"] is False, "free user cannot disable"
    assert b["tier"] == "free"


def test_12_free_user_disable_ghost_is_402():
    r = requests.patch(
        f"{API}/auth/ghost-mail",
        json={"enabled": False},
        headers=_auth(state["token"]),
        timeout=20,
    )
    assert r.status_code == 402, f"expected 402, got {r.status_code}: {r.text}"


def test_13_free_user_enable_ghost_is_200():
    r = requests.patch(
        f"{API}/auth/ghost-mail",
        json={"enabled": True},
        headers=_auth(state["token"]),
        timeout=20,
    )
    assert r.status_code == 200, r.text
    assert r.json()["enabled"] is True


def test_14_plus_user_disable_works(mongo):
    # Upgrade user to plus
    expires = (datetime.now(timezone.utc) + timedelta(days=30)).isoformat()
    mongo.users.update_one(
        {"id": state["uid"]},
        {"$set": {"tier": "plus", "tier_expires_at": expires}},
    )
    r = requests.patch(
        f"{API}/auth/ghost-mail",
        json={"enabled": False},
        headers=_auth(state["token"]),
        timeout=20,
    )
    assert r.status_code == 200, r.text
    assert r.json() == {"enabled": False}
    # GET /auth/me reflects
    r2 = requests.get(f"{API}/auth/me", headers=_auth(state["token"]), timeout=20)
    assert r2.status_code == 200
    me = r2.json()
    assert me.get("ghost_mail_enabled") is False
    assert "password_hash" not in me, "password_hash leaked in /auth/me"


def test_15_close_thread_with_ghost_off_does_not_delete():
    new_msg_id = f"<premium-{_T}@w.xyz>"
    _send_inbound("Premium subject", "content", new_msg_id)
    r = requests.get(f"{API}/mail/inbox", headers=_auth(state["token"]), timeout=20)
    mine = [m for m in r.json() if m.get("subject") == "Premium subject"]
    assert len(mine) == 1
    target = mine[0]
    tid = target["thread_id"]
    mid = target["id"]
    # Open thread
    requests.get(f"{API}/mail/thread/{tid}", headers=_auth(state["token"]), timeout=20)
    # Close
    r2 = requests.post(f"{API}/mail/thread/{tid}/close", headers=_auth(state["token"]), timeout=20)
    assert r2.status_code == 200
    body = r2.json()
    assert body == {"deleted": 0, "ghost_mail": False}, f"unexpected: {body}"
    # Still exists
    r3 = requests.get(f"{API}/mail/{mid}", headers=_auth(state["token"]), timeout=20)
    assert r3.status_code == 200


# ---------------- 7. Per-message star toggle ----------------
def test_16_per_message_star_toggle():
    # Use the kept (already-starred) mail and toggle it
    mid = state["keep_id"]
    r = requests.patch(f"{API}/mail/{mid}/star", headers=_auth(state["token"]), timeout=20)
    assert r.status_code == 200, r.text
    val1 = r.json()["starred"]
    r2 = requests.patch(f"{API}/mail/{mid}/star", headers=_auth(state["token"]), timeout=20)
    assert r2.status_code == 200
    val2 = r2.json()["starred"]
    assert val1 != val2, f"toggle did not flip: {val1} -> {val2}"


# ---------------- 8. Regression ----------------
def test_17_auth_me_no_password_hash():
    r = requests.get(f"{API}/auth/me", headers=_auth(state["token"]), timeout=20)
    assert r.status_code == 200
    me = r.json()
    assert "password_hash" not in me
    assert "password_reset_otp" not in me, "password_reset_otp leak"


def test_18_billing_plans():
    r = requests.get(f"{API}/billing/plans", timeout=20)
    assert r.status_code == 200, r.text
    plans = r.json()
    # plans may be a list or dict; the previous tests assumed 3
    if isinstance(plans, list):
        assert len(plans) == 3, f"expected 3 plans, got {len(plans)}"
    elif isinstance(plans, dict):
        # could be {"plans": [...]} 
        inner = plans.get("plans") or plans.get("tiers")
        if inner is not None:
            assert len(inner) == 3, f"expected 3 plans, got {len(inner)}"


def test_19_inbox_no_legacy_break(mongo):
    """Insert a legacy email without 'archived' or 'snoozed_until' fields and
    confirm /mail/inbox still returns it (regression for the new $or filter)."""
    legacy = {
        "id": str(uuid.uuid4()),
        "owner_id": state["uid"],
        "folder": "inbox",
        "from_addr": "legacy@example.com",
        "from_name": "Legacy",
        "to_addrs": [state["address"]],
        "subject": "TEST_LEGACY",
        "body": "old",
        "read": False,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    mongo.emails.insert_one(dict(legacy))
    try:
        r = requests.get(f"{API}/mail/inbox", headers=_auth(state["token"]), timeout=20)
        assert r.status_code == 200
        ids = [m["id"] for m in r.json()]
        assert legacy["id"] in ids, "legacy email missing from inbox (filter broke it)"
    finally:
        mongo.emails.delete_one({"id": legacy["id"]})


# ---------------- Cleanup ----------------
def test_99_cleanup(mongo):
    """Delete the test user + their emails."""
    if "uid" in state:
        mongo.emails.delete_many({"owner_id": state["uid"]})
        if "address" in state:
            mongo.emails.delete_many({"to_addrs": state["address"]})
        mongo.users.delete_one({"id": state["uid"]})
        mongo.otps.delete_many({"phone": PHONE})
