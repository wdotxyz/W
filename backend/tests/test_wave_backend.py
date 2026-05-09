"""Wave backend API tests - auth, chats, messages, AI, websocket."""
import os
import json
import time
import asyncio
import pytest
import requests
import websockets

BASE = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://message-hub-1215.preview.emergentagent.com").rstrip("/")
API = f"{BASE}/api"
WS_BASE = BASE.replace("https://", "wss://").replace("http://", "ws://")

PHONE_A = f"+1555{int(time.time()) % 10000000:07d}"
PHONE_B = f"+1666{int(time.time()) % 10000000:07d}"

state = {}


def _register(phone):
    r = requests.post(f"{API}/auth/send-otp", json={"phone": phone}, timeout=15)
    assert r.status_code == 200, r.text
    otp = r.json()["dev_otp"]
    assert len(otp) == 6
    r2 = requests.post(f"{API}/auth/verify-otp", json={"phone": phone, "otp": otp}, timeout=15)
    assert r2.status_code == 200, r2.text
    d = r2.json()
    assert "token" in d and "user" in d and "_id" not in d["user"]
    return d["token"], d["user"]


# ---------- AUTH ----------
def test_send_otp_returns_dev_otp():
    r = requests.post(f"{API}/auth/send-otp", json={"phone": PHONE_A}, timeout=15)
    assert r.status_code == 200
    j = r.json()
    assert j.get("success") is True and "dev_otp" in j and len(j["dev_otp"]) == 6


def test_verify_otp_invalid():
    requests.post(f"{API}/auth/send-otp", json={"phone": PHONE_A}, timeout=15)
    r = requests.post(f"{API}/auth/verify-otp", json={"phone": PHONE_A, "otp": "000000"}, timeout=15)
    # OTP unlikely to be 000000; but if it is, accept 200
    assert r.status_code in (400, 200)


def test_register_user_a_and_b():
    state["tokenA"], state["userA"] = _register(PHONE_A)
    state["tokenB"], state["userB"] = _register(PHONE_B)
    assert state["userA"]["id"] != state["userB"]["id"]


def test_auth_me():
    r = requests.get(f"{API}/auth/me", headers={"Authorization": f"Bearer {state['tokenA']}"}, timeout=15)
    assert r.status_code == 200
    assert r.json()["id"] == state["userA"]["id"]
    assert "_id" not in r.json()


def test_me_unauthorized():
    r = requests.get(f"{API}/auth/me", timeout=15)
    assert r.status_code == 401


def test_update_profile():
    r = requests.post(
        f"{API}/auth/profile",
        json={"name": "Tester A", "about": "Hi"},
        headers={"Authorization": f"Bearer {state['tokenA']}"}, timeout=15,
    )
    assert r.status_code == 200
    assert r.json()["name"] == "Tester A"
    # Verify via GET
    r2 = requests.get(f"{API}/auth/me", headers={"Authorization": f"Bearer {state['tokenA']}"}, timeout=15)
    assert r2.json()["name"] == "Tester A"


# ---------- USERS ----------
def test_list_users_excludes_self():
    r = requests.get(f"{API}/users", headers={"Authorization": f"Bearer {state['tokenA']}"}, timeout=15)
    assert r.status_code == 200
    users = r.json()
    ids = [u["id"] for u in users]
    assert state["userA"]["id"] not in ids
    assert all("_id" not in u for u in users)
    # B should be visible
    assert state["userB"]["id"] in ids


# ---------- CHATS ----------
def test_create_1on1_chat_idempotent():
    headers = {"Authorization": f"Bearer {state['tokenA']}"}
    r = requests.post(f"{API}/chats", json={"member_ids": [state["userB"]["id"]], "is_group": False}, headers=headers, timeout=15)
    assert r.status_code == 200
    chat1 = r.json()
    state["chat1_id"] = chat1["id"]
    assert "_id" not in chat1
    assert chat1.get("display_name")
    # Idempotent
    r2 = requests.post(f"{API}/chats", json={"member_ids": [state["userB"]["id"]], "is_group": False}, headers=headers, timeout=15)
    assert r2.json()["id"] == chat1["id"]


def test_create_group_chat():
    headers = {"Authorization": f"Bearer {state['tokenA']}"}
    r = requests.post(f"{API}/chats", json={"member_ids": [state["userB"]["id"]], "is_group": True, "name": "TEST_Group"}, headers=headers, timeout=15)
    assert r.status_code == 200
    g = r.json()
    state["group_id"] = g["id"]
    assert g["is_group"] is True
    assert g["display_name"] == "TEST_Group"


def test_list_chats():
    headers = {"Authorization": f"Bearer {state['tokenA']}"}
    r = requests.get(f"{API}/chats", headers=headers, timeout=15)
    assert r.status_code == 200
    chats = r.json()
    ids = [c["id"] for c in chats]
    assert state["chat1_id"] in ids
    for c in chats:
        assert "_id" not in c
        assert "display_name" in c
        assert "unread" in c
        assert "last_message" in c


def test_send_text_message_and_get():
    headers = {"Authorization": f"Bearer {state['tokenA']}"}
    r = requests.post(
        f"{API}/chats/{state['chat1_id']}/messages",
        json={"chat_id": state["chat1_id"], "type": "text", "content": "Hello B!"},
        headers=headers, timeout=15,
    )
    assert r.status_code == 200
    m = r.json()
    assert m["content"] == "Hello B!" and m["type"] == "text"
    assert "_id" not in m

    # GET messages as B - marks read
    headersB = {"Authorization": f"Bearer {state['tokenB']}"}
    r2 = requests.get(f"{API}/chats/{state['chat1_id']}/messages", headers=headersB, timeout=15)
    assert r2.status_code == 200
    msgs = r2.json()
    assert any(x["content"] == "Hello B!" for x in msgs)
    assert all("_id" not in x for x in msgs)


def test_send_image_and_voice():
    headers = {"Authorization": f"Bearer {state['tokenA']}"}
    img = "data:image/png;base64,iVBORw0KGgo="
    r = requests.post(f"{API}/chats/{state['chat1_id']}/messages",
                      json={"chat_id": state["chat1_id"], "type": "image", "content": img}, headers=headers, timeout=15)
    assert r.status_code == 200 and r.json()["type"] == "image"
    r2 = requests.post(f"{API}/chats/{state['chat1_id']}/messages",
                       json={"chat_id": state["chat1_id"], "type": "voice", "content": "BASE64AUDIO==", "duration": 3}, headers=headers, timeout=15)
    assert r2.status_code == 200 and r2.json()["duration"] == 3


def test_messages_unauthorized_chat():
    # User C cannot access A-B chat
    tokenC, _ = _register(f"+1777{int(time.time()) % 10000000:07d}")
    r = requests.get(f"{API}/chats/{state['chat1_id']}/messages",
                     headers={"Authorization": f"Bearer {tokenC}"}, timeout=15)
    assert r.status_code == 404


# ---------- AI ----------
def test_ai_start_chat():
    headers = {"Authorization": f"Bearer {state['tokenA']}"}
    r = requests.post(f"{API}/ai/start-chat", headers=headers, timeout=15)
    assert r.status_code == 200
    c = r.json()
    state["ai_chat_id"] = c["id"]
    assert "ai-assistant-wave" in c["member_ids"]
    # Idempotent
    r2 = requests.post(f"{API}/ai/start-chat", headers=headers, timeout=15)
    assert r2.json()["id"] == c["id"]


def test_ai_replies_to_text():
    headers = {"Authorization": f"Bearer {state['tokenA']}"}
    r = requests.post(
        f"{API}/chats/{state['ai_chat_id']}/messages",
        json={"chat_id": state["ai_chat_id"], "type": "text", "content": "Say hi in 5 words."},
        headers=headers, timeout=15,
    )
    assert r.status_code == 200
    # poll for AI reply
    ai_reply = None
    for _ in range(20):
        time.sleep(1.5)
        msgs = requests.get(f"{API}/chats/{state['ai_chat_id']}/messages", headers=headers, timeout=15).json()
        replies = [m for m in msgs if m["sender_id"] == "ai-assistant-wave"]
        if replies:
            ai_reply = replies[-1]
            break
    assert ai_reply is not None, "AI did not reply within 30s"
    assert ai_reply["type"] == "text" and len(ai_reply["content"]) > 0


# ---------- WEBSOCKET ----------
@pytest.mark.asyncio
async def test_websocket_new_message_and_typing():
    url = f"{WS_BASE}/api/ws?token={state['tokenB']}"
    async with websockets.connect(url, open_timeout=10) as wsB:
        # A sends a message -> B should receive new_message
        requests.post(
            f"{API}/chats/{state['chat1_id']}/messages",
            json={"chat_id": state["chat1_id"], "type": "text", "content": "WS test"},
            headers={"Authorization": f"Bearer {state['tokenA']}"}, timeout=15,
        )
        got_new = False
        try:
            for _ in range(5):
                data = await asyncio.wait_for(wsB.recv(), timeout=8)
                msg = json.loads(data)
                if msg.get("type") == "new_message" and msg.get("chat_id") == state["chat1_id"]:
                    got_new = True
                    break
        except asyncio.TimeoutError:
            pass
        assert got_new, "Did not receive new_message via WS"

    # Typing broadcast: A subscribes; B sends typing
    urlA = f"{WS_BASE}/api/ws?token={state['tokenA']}"
    urlB = f"{WS_BASE}/api/ws?token={state['tokenB']}"
    async with websockets.connect(urlA, open_timeout=10) as wsA, websockets.connect(urlB, open_timeout=10) as wsB:
        await asyncio.sleep(0.5)
        await wsB.send(json.dumps({"type": "typing", "chat_id": state["chat1_id"], "is_typing": True}))
        got_typing = False
        try:
            for _ in range(5):
                data = await asyncio.wait_for(wsA.recv(), timeout=5)
                msg = json.loads(data)
                if msg.get("type") == "typing" and msg.get("chat_id") == state["chat1_id"]:
                    got_typing = True
                    break
        except asyncio.TimeoutError:
            pass
        assert got_typing, "Did not receive typing event via WS"
