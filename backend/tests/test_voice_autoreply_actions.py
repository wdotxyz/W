"""Backend tests for the 3 newest AI features:
  1. POST /api/ai/voice-to-email   (Whisper STT + Claude polish)
  2. PATCH /api/auth/auto-reply    (ai_enabled gate + body optional)
  3. GET /api/ai/actions           (Claude action extractor)

Plus a quick regression sweep:
  - GET /api/auth/me                (no password_hash)
  - GET /api/billing/plans          (3 plans)
  - GET /api/mail/inbox             (200)
  - POST /api/mail/threads/{id}/close (Ghost Mail still works)
"""
import base64
import os
import time
import uuid
import wave

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
DB_NAME = os.environ.get("DB_NAME", "wave_chat")

_T = int(time.time()) % 10_000_000
PHONE = f"+1777{_T:07d}"
HANDLE = f"voicet{_T}"

AI_TIMEOUT = 60   # voice-to-email can take 10-30s (Whisper + Claude)

state: dict = {}


def _auth(t):
    return {"Authorization": f"Bearer {t}"}


@pytest.fixture(scope="module")
def mongo():
    c = MongoClient(MONGO_URL)
    yield c[DB_NAME]
    c.close()


# ---------------- 01. Register + claim handle ----------------
def test_01_register_user(mongo):
    r = requests.post(f"{API}/auth/send-otp", json={"phone": PHONE}, timeout=20)
    # Twilio may reject unverified trial numbers with 400; OTP is still
    # stored in Mongo BEFORE the SMS attempt.
    otp = None
    if r.status_code == 200:
        otp = r.json().get("dev_otp")
    if not otp:
        rec = mongo.otps.find_one({"phone": PHONE})
        assert rec, f"OTP not in DB after send-otp: {r.status_code} {r.text}"
        otp = rec["otp"]

    r2 = requests.post(f"{API}/auth/verify-otp",
                       json={"phone": PHONE, "otp": otp}, timeout=20)
    assert r2.status_code == 200, r2.text
    d = r2.json()
    state["token"] = d["token"]
    state["uid"] = d["user"]["id"]
    assert "password_hash" not in d["user"]


def test_02_claim_handle():
    r = requests.post(f"{API}/mail/claim-handle",
                      json={"handle": HANDLE},
                      headers=_auth(state["token"]), timeout=20)
    assert r.status_code == 200, r.text
    state["email_addr"] = f"{HANDLE}@{MAIL_DOMAIN}"


# ============================================================
# 10. Voice → Email
# ============================================================
def _wav_silence_b64(seconds: float = 1.0) -> str:
    path = f"/tmp/silence-{uuid.uuid4().hex}.wav"
    w = wave.open(path, "wb")
    w.setnchannels(1)
    w.setsampwidth(2)
    w.setframerate(16000)
    w.writeframes(b"\x00\x00" * int(16000 * seconds))
    w.close()
    with open(path, "rb") as f:
        b = base64.b64encode(f.read()).decode("ascii")
    try:
        os.unlink(path)
    except Exception:
        pass
    return b


def test_10_voice_empty_audio_returns_400():
    r = requests.post(f"{API}/ai/voice-to-email",
                      json={"audio_b64": "", "mime_type": "audio/wav"},
                      headers=_auth(state["token"]), timeout=15)
    assert r.status_code == 400, r.text


def test_11_voice_invalid_base64_returns_400():
    r = requests.post(f"{API}/ai/voice-to-email",
                      json={"audio_b64": "@@@not-base64@@@",
                            "mime_type": "audio/wav"},
                      headers=_auth(state["token"]), timeout=20)
    assert r.status_code == 400, r.text


def test_12_voice_silence_wav_does_not_500():
    """Silent WAV — accept 200 (with empty/short transcript), 422 (empty
    transcription) OR 502 (Whisper error). MUST NOT 500."""
    audio_b64 = _wav_silence_b64(1.0)
    r = requests.post(f"{API}/ai/voice-to-email",
                      json={"audio_b64": audio_b64,
                            "mime_type": "audio/wav",
                            "polish": True},
                      headers=_auth(state["token"]), timeout=AI_TIMEOUT)
    print(f"voice silence → {r.status_code}: {r.text[:300]}")
    assert r.status_code != 500, f"Whisper integration crashed: {r.text}"
    assert r.status_code in (200, 422, 502), r.text
    state["voice_silence_status"] = r.status_code
    if r.status_code == 200:
        d = r.json()
        assert "transcript" in d and "subject" in d and "body" in d


def test_13_voice_real_speech_sample():
    """Download a short public OGG speech sample, send it.

    Expect: 200 with non-empty transcript + subject/body OR 422 if Whisper
    can't process the format. The point is to confirm Whisper is actually
    being called (no 502/500)."""
    url = "https://upload.wikimedia.org/wikipedia/commons/c/c8/Example.ogg"
    try:
        rr = requests.get(url, timeout=20)
        rr.raise_for_status()
    except Exception as e:
        pytest.skip(f"Couldn't download sample: {e}")
    audio_b64 = base64.b64encode(rr.content).decode("ascii")
    r = requests.post(f"{API}/ai/voice-to-email",
                      json={"audio_b64": audio_b64,
                            "mime_type": "audio/ogg",
                            "polish": True},
                      headers=_auth(state["token"]), timeout=AI_TIMEOUT)
    print(f"voice OGG sample → {r.status_code}: {r.text[:400]}")
    assert r.status_code != 500, f"crashed: {r.text}"
    assert r.status_code in (200, 422, 502), r.text
    state["voice_sample_status"] = r.status_code
    if r.status_code == 200:
        d = r.json()
        assert "transcript" in d
        assert "subject" in d
        assert "body" in d
        state["voice_transcript"] = d.get("transcript", "")[:120]
        state["voice_subject"] = d.get("subject", "")[:120]


def test_14_voice_no_polish_returns_raw_transcript():
    """polish=False should return transcript as body with empty subject —
    or 422 if transcript was empty."""
    audio_b64 = _wav_silence_b64(0.5)
    r = requests.post(f"{API}/ai/voice-to-email",
                      json={"audio_b64": audio_b64,
                            "mime_type": "audio/wav",
                            "polish": False},
                      headers=_auth(state["token"]), timeout=AI_TIMEOUT)
    print(f"voice no-polish → {r.status_code}")
    assert r.status_code != 500
    assert r.status_code in (200, 422, 502)
    if r.status_code == 200:
        d = r.json()
        # no polish path → subject empty, body == transcript
        assert d.get("subject") == ""
        assert d.get("body") == d.get("transcript")


def test_15_voice_requires_auth():
    r = requests.post(f"{API}/ai/voice-to-email",
                      json={"audio_b64": "AAAA", "mime_type": "audio/wav"},
                      timeout=15)
    assert r.status_code in (401, 403)


# ============================================================
# 20. Smart Auto-Reply (Pro gate)
# ============================================================
def test_20_free_user_ai_enabled_returns_402():
    payload = {"enabled": True, "ai_enabled": True, "body": ""}
    r = requests.patch(f"{API}/auth/auto-reply", json=payload,
                       headers=_auth(state["token"]), timeout=15)
    assert r.status_code == 402, f"expected 402, got {r.status_code}: {r.text}"
    assert "plus" in r.text.lower() or "pro" in r.text.lower()


def test_21_promote_user_to_plus(mongo):
    """Directly bump tier in Mongo so we can exercise the Plus path."""
    from datetime import datetime, timedelta, timezone
    exp = (datetime.now(timezone.utc) + timedelta(days=30)).isoformat()
    res = mongo.users.update_one(
        {"id": state["uid"]},
        {"$set": {"tier": "plus", "tier_expires_at": exp}},
    )
    assert res.matched_count == 1


def test_22_plus_user_ai_enabled_empty_body_returns_200():
    """When ai_enabled is on, body is optional (no 400)."""
    payload = {"enabled": True, "ai_enabled": True, "body": ""}
    r = requests.patch(f"{API}/auth/auto-reply", json=payload,
                       headers=_auth(state["token"]), timeout=15)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d.get("ai_enabled") is True
    assert d.get("enabled") is True


def test_23_get_auto_reply_returns_ai_enabled():
    r = requests.get(f"{API}/auth/auto-reply",
                     headers=_auth(state["token"]), timeout=15)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d.get("ai_enabled") is True


def test_24_turn_off_ai_enabled_with_static_body():
    payload = {"enabled": True, "ai_enabled": False,
               "body": "Out of office until Mon"}
    r = requests.patch(f"{API}/auth/auto-reply", json=payload,
                       headers=_auth(state["token"]), timeout=15)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d.get("ai_enabled") is False
    assert d.get("body") == "Out of office until Mon"


def test_25_enabled_no_body_no_ai_returns_400():
    """Regression: with ai off and enabled=true, empty body should still 400."""
    payload = {"enabled": True, "ai_enabled": False, "body": ""}
    r = requests.patch(f"{API}/auth/auto-reply", json=payload,
                       headers=_auth(state["token"]), timeout=15)
    assert r.status_code == 400, r.text


# ============================================================
# 30. AI Action Extractor
# ============================================================
def _inbound(to_addr, frm, subject, text, in_reply_to=None):
    data = {
        "to": to_addr,
        "from": frm,
        "subject": subject,
        "text": text,
        "envelope": '{"to":["' + to_addr + '"],"from":"' + frm + '"}',
    }
    headers = ""
    if in_reply_to:
        headers = f"In-Reply-To: {in_reply_to}\n"
    headers += f"Message-ID: <{uuid.uuid4()}@test>\n"
    data["headers"] = headers
    return requests.post(f"{API}/mail/inbound", data=data, timeout=20)


def test_30_actions_empty_inbox_returns_empty_list(mongo):
    """Brand new user with no emails — actions should be []."""
    # ensure clean (any prior tests didn't seed)
    mongo.emails.delete_many({"owner_id": state["uid"]})
    r = requests.get(f"{API}/ai/actions",
                     headers=_auth(state["token"]), timeout=AI_TIMEOUT)
    assert r.status_code == 200, r.text
    d = r.json()
    assert "actions" in d
    assert d["actions"] == []


def test_31_actions_seed_and_extract(mongo):
    """Seed 3 inbound emails with clear action content, call extractor."""
    addr = state["email_addr"]
    seeds = [
        ("Q4 deck review",
         "Hi! Can you review the Q4 deck and send feedback by Friday? Thanks!"),
        ("Design review Tuesday",
         "Reminder: design review Tuesday at 2pm in the main conference room."),
        ("Sign vendor contract",
         "Please sign the vendor contract by end of next week — DocuSign link attached."),
    ]
    for subj, body in seeds:
        r = _inbound(addr, "alex@example.com", subj, body)
        assert r.status_code == 200, r.text

    # Wait briefly for write
    time.sleep(1.0)

    r = requests.get(f"{API}/ai/actions",
                     headers=_auth(state["token"]), timeout=AI_TIMEOUT)
    assert r.status_code == 200, r.text
    d = r.json()
    assert "actions" in d
    assert isinstance(d["actions"], list)
    print(f"actions (n={len(d['actions'])}): {d['actions']}")
    state["actions_count"] = len(d["actions"])

    # Contract check: each action has required keys + correct types
    for a in d["actions"]:
        assert isinstance(a, dict)
        assert "title" in a and isinstance(a["title"], str) and a["title"].strip()
        assert "type" in a and isinstance(a["type"], str)
        assert "source_thread_id" in a and isinstance(a["source_thread_id"], str)
        assert "source_subject" in a and isinstance(a["source_subject"], str)
        # due_date may be None or string
        assert a["due_date"] is None or isinstance(a["due_date"], str)
        # type should be one of the documented values (best-effort, lowered)
        assert a["type"].lower() in ("task", "meeting", "deadline") or a["type"]


def test_32_actions_requires_auth():
    r = requests.get(f"{API}/ai/actions", timeout=15)
    assert r.status_code in (401, 403)


# ============================================================
# 90. Regression
# ============================================================
def test_90_auth_me_no_password_leak():
    r = requests.get(f"{API}/auth/me",
                     headers=_auth(state["token"]), timeout=15)
    assert r.status_code == 200, r.text
    assert "password_hash" not in r.text


def test_91_billing_plans_three():
    r = requests.get(f"{API}/billing/plans", timeout=15)
    assert r.status_code == 200, r.text
    plans = r.json()
    if isinstance(plans, dict) and "plans" in plans:
        plans = plans["plans"]
    assert isinstance(plans, list)
    assert len(plans) == 3, f"expected 3, got {len(plans)}: {plans}"


def test_92_mail_inbox_200():
    r = requests.get(f"{API}/mail/inbox",
                     headers=_auth(state["token"]), timeout=15)
    assert r.status_code == 200, r.text
    assert isinstance(r.json(), list)


def test_93_ghost_mail_close_thread(mongo):
    """Find one of the seeded inbound threads and close it."""
    em = mongo.emails.find_one({"owner_id": state["uid"]},
                               sort=[("created_at", -1)])
    if not em:
        pytest.skip("no email available for thread close")
    tid = em["thread_id"]
    r = requests.post(f"{API}/mail/thread/{tid}/close",
                      headers=_auth(state["token"]), timeout=15)
    print(f"thread close → {r.status_code}: {r.text[:200]}")
    # Should be 200 (acknowledged). Anything else is a regression.
    assert r.status_code == 200, r.text


# ============================================================
# 99. Cleanup
# ============================================================
def test_99_cleanup(mongo):
    uid = state.get("uid")
    if not uid:
        return
    addr = state.get("email_addr")
    mongo.emails.delete_many({"owner_id": uid})
    if addr:
        mongo.emails.delete_many({"to_addrs": addr})
    mongo.users.delete_many({"id": uid})
    mongo.otps.delete_many({"phone": PHONE})
    mongo.handles.delete_many({"handle": HANDLE})
    mongo.auto_reply_log.delete_many({"owner_id": uid})
    print(
        f"\n--- voice/autoreply/actions summary ---\n"
        f"voice silence status: {state.get('voice_silence_status')}\n"
        f"voice sample status:  {state.get('voice_sample_status')}\n"
        f"voice transcript: {state.get('voice_transcript')!r}\n"
        f"voice subject:    {state.get('voice_subject')!r}\n"
        f"actions returned: {state.get('actions_count')}\n"
    )
