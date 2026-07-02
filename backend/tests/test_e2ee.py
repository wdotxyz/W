"""E2EE (TweetNaCl nacl.box) backend tests.

Covers:
- Key publish/lookup (POST /api/keys/publish, GET /api/keys/peer/{user_id})
- Sending an encrypted message (ciphertext+nonce, empty content) -> stored e2ee=true
- Backward-compat plaintext message -> stored e2ee=false
- GET /chats/{id}/messages returns ciphertext/nonce for E2EE and plaintext for legacy
- AI chat: message with only content still triggers AI response, never marked e2ee
"""
import base64
import os
import time
import uuid

import pytest
import requests
from dotenv import load_dotenv
from nacl.public import PrivateKey, PublicKey, Box
from nacl.utils import random as nacl_random

# Ensure MONGO_URL / DB_NAME are available for the ephemeral-user seeder
load_dotenv('/app/backend/.env')

BASE_URL = os.environ.get('EXPO_PUBLIC_BACKEND_URL', 'https://message-hub-1215.preview.emergentagent.com').rstrip('/')
API = f"{BASE_URL}/api"

PETER_EMAIL = 'peter@w.xyz'
PETER_PW = 'PeterW2026!'


# ---------- helpers ----------------------------------------------------------

def _auth_headers(token: str) -> dict:
    return {'Authorization': f'Bearer {token}', 'Content-Type': 'application/json'}


def _login_peter() -> dict:
    r = requests.post(f"{API}/auth/login", json={'email': PETER_EMAIL, 'password': PETER_PW}, timeout=15)
    assert r.status_code == 200, f"Peter login failed: {r.status_code} {r.text}"
    return r.json()


def _create_ephemeral_user() -> dict:
    """Seed a second W user directly in Mongo (Twilio is live so we cannot
    rely on `dev_otp`). Then login via /api/auth/login to grab a JWT.
    """
    import asyncio
    import bcrypt
    from motor.motor_asyncio import AsyncIOMotorClient

    email = f'test_alice_{uuid.uuid4().hex[:8]}@w.xyz'
    password = 'AliceW2026!'

    async def seed():
        client = AsyncIOMotorClient(os.environ.get('MONGO_URL', 'mongodb://localhost:27017'))
        db = client[os.environ.get('DB_NAME', 'wave_chat')]
        uid = str(uuid.uuid4())
        await db.users.insert_one({
            'id': uid,
            'name': 'TEST Alice',
            'handle': email.split('@')[0],
            'email_address': email,
            'phone': f"+1000{uuid.uuid4().int % 10_000_000:07d}",
            'tier': 'free',
            'password_hash': bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode(),
            'created_at': '2026-01-01T00:00:00+00:00',
        })
        client.close()
        return uid

    uid = asyncio.run(seed())
    r = requests.post(f"{API}/auth/login",
                      json={'email': email, 'password': password}, timeout=15)
    assert r.status_code == 200, f"Alice login failed: {r.status_code} {r.text}"
    data = r.json()
    return {'token': data['token'], 'user': data['user'], 'email': email, 'uid': uid}


def _make_keypair() -> tuple[PrivateKey, str]:
    sk = PrivateKey.generate()
    pk_b64 = base64.b64encode(bytes(sk.public_key)).decode()
    return sk, pk_b64


def _encrypt(plaintext: str, my_sk: PrivateKey, peer_pub_b64: str) -> dict:
    peer_pub = PublicKey(base64.b64decode(peer_pub_b64))
    box = Box(my_sk, peer_pub)
    nonce = nacl_random(24)
    ct = box.encrypt(plaintext.encode(), nonce).ciphertext
    return {
        'ciphertext': base64.b64encode(ct).decode(),
        'nonce': base64.b64encode(nonce).decode(),
        'algo': 'nacl.box.v1',
    }


def _decrypt(ct_b64: str, nonce_b64: str, my_sk: PrivateKey, peer_pub_b64: str) -> str:
    peer_pub = PublicKey(base64.b64decode(peer_pub_b64))
    box = Box(my_sk, peer_pub)
    return box.decrypt(base64.b64decode(ct_b64), base64.b64decode(nonce_b64)).decode()


# ---------- fixtures ---------------------------------------------------------

@pytest.fixture(scope='module')
def peter():
    data = _login_peter()
    sk, pk_b64 = _make_keypair()
    r = requests.post(f"{API}/keys/publish",
                      headers=_auth_headers(data['token']),
                      json={'public_key': pk_b64, 'algo': 'nacl.box.v1'},
                      timeout=15)
    assert r.status_code == 200, r.text
    return {**data, 'sk': sk, 'pub_b64': pk_b64}


@pytest.fixture(scope='module')
def alice():
    data = _create_ephemeral_user()
    sk, pk_b64 = _make_keypair()
    r = requests.post(f"{API}/keys/publish",
                      headers=_auth_headers(data['token']),
                      json={'public_key': pk_b64, 'algo': 'nacl.box.v1'},
                      timeout=15)
    assert r.status_code == 200, r.text
    yield {**data, 'sk': sk, 'pub_b64': pk_b64}
    # Cleanup — remove the test user, her key, and any chat/messages she was in
    import asyncio
    from motor.motor_asyncio import AsyncIOMotorClient
    async def cleanup():
        client = AsyncIOMotorClient(os.environ.get('MONGO_URL'))
        dbc = client[os.environ.get('DB_NAME')]
        uid = data['uid']
        await dbc.users.delete_one({'id': uid})
        await dbc.user_keys.delete_one({'user_id': uid})
        chats = await dbc.chats.find({'member_ids': uid}, {'id': 1}).to_list(50)
        for c in chats:
            await dbc.messages.delete_many({'chat_id': c['id']})
            await dbc.chats.delete_one({'id': c['id']})
        client.close()
    asyncio.run(cleanup())


@pytest.fixture(scope='module')
def chat(peter, alice):
    """Create/find a 1-on-1 chat between Peter and Alice using /chats (member_ids)."""
    r = requests.post(f"{API}/chats",
                      headers=_auth_headers(peter['token']),
                      json={'member_ids': [alice['user']['id']], 'is_group': False},
                      timeout=15)
    assert r.status_code == 200, r.text
    return r.json()


# ---------- key directory tests ---------------------------------------------

class TestKeyDirectory:
    def test_publish_idempotent(self, peter):
        # Republishing the same key must succeed and remain stable
        r = requests.post(f"{API}/keys/publish",
                          headers=_auth_headers(peter['token']),
                          json={'public_key': peter['pub_b64'], 'algo': 'nacl.box.v1'},
                          timeout=15)
        assert r.status_code == 200
        assert r.json().get('ok') is True

    def test_get_my_key(self, peter):
        r = requests.get(f"{API}/keys/me", headers=_auth_headers(peter['token']), timeout=15)
        assert r.status_code == 200
        j = r.json()
        assert j['public_key'] == peter['pub_b64']
        assert j['user_id'] == peter['user']['id']
        assert j['algo'] == 'nacl.box.v1'

    def test_get_peer_key(self, peter, alice):
        r = requests.get(f"{API}/keys/peer/{alice['user']['id']}",
                         headers=_auth_headers(peter['token']), timeout=15)
        assert r.status_code == 200
        assert r.json()['public_key'] == alice['pub_b64']

    def test_get_peer_key_missing(self, peter):
        r = requests.get(f"{API}/keys/peer/nonexistent-user-id-xyz",
                         headers=_auth_headers(peter['token']), timeout=15)
        assert r.status_code == 404

    def test_publish_requires_auth(self):
        r = requests.post(f"{API}/keys/publish", json={'public_key': 'x' * 44}, timeout=15)
        assert r.status_code in (401, 403)


# ---------- E2EE message tests ----------------------------------------------

class TestE2EEMessages:
    def test_send_e2ee_message_no_plaintext_stored(self, peter, alice, chat):
        payload = _encrypt("hello alice — this is a secret", peter['sk'], alice['pub_b64'])
        body = {
            'chat_id': chat['id'],
            'type': 'text',
            'content': '',
            **payload,
        }
        r = requests.post(f"{API}/chats/{chat['id']}/messages",
                          headers=_auth_headers(peter['token']),
                          json=body, timeout=15)
        assert r.status_code == 200, r.text
        msg = r.json()
        assert msg['e2ee'] is True
        assert msg['content'] == '', f"E2EE msg should have empty plaintext, got: {msg['content']!r}"
        assert msg['ciphertext'] == payload['ciphertext']
        assert msg['nonce'] == payload['nonce']
        assert msg['algo'] == 'nacl.box.v1'

    def test_alice_can_decrypt(self, peter, alice, chat):
        # Peter sends
        secret = "top-secret-42"
        payload = _encrypt(secret, peter['sk'], alice['pub_b64'])
        r = requests.post(f"{API}/chats/{chat['id']}/messages",
                          headers=_auth_headers(peter['token']),
                          json={'chat_id': chat['id'], 'type': 'text', 'content': '', **payload},
                          timeout=15)
        assert r.status_code == 200
        # Alice fetches messages
        r2 = requests.get(f"{API}/chats/{chat['id']}/messages",
                          headers=_auth_headers(alice['token']), timeout=15)
        assert r2.status_code == 200
        msgs = r2.json()
        target = next((m for m in msgs if m.get('ciphertext') == payload['ciphertext']), None)
        assert target is not None, "Sent E2EE message not returned to Alice"
        assert target['content'] == ''
        assert target['e2ee'] is True
        # Decrypt using Alice's SK + Peter's public key
        recovered = _decrypt(target['ciphertext'], target['nonce'], alice['sk'], peter['pub_b64'])
        assert recovered == secret

    def test_legacy_plaintext_still_works(self, peter, chat):
        r = requests.post(f"{API}/chats/{chat['id']}/messages",
                          headers=_auth_headers(peter['token']),
                          json={'chat_id': chat['id'], 'type': 'text', 'content': 'legacy hi'},
                          timeout=15)
        assert r.status_code == 200, r.text
        msg = r.json()
        assert msg['e2ee'] is False
        assert msg['content'] == 'legacy hi'
        assert msg.get('ciphertext') in (None, '')
        assert msg.get('nonce') in (None, '')

    def test_get_messages_returns_both_kinds(self, peter, chat):
        r = requests.get(f"{API}/chats/{chat['id']}/messages",
                         headers=_auth_headers(peter['token']), timeout=15)
        assert r.status_code == 200
        msgs = r.json()
        assert any(m.get('e2ee') is True and m.get('ciphertext') for m in msgs), \
            "Expected at least one E2EE message with ciphertext"
        assert any(m.get('e2ee') is False and m.get('content') for m in msgs), \
            "Expected at least one legacy plaintext message"

    def test_e2ee_flag_false_when_only_ciphertext_no_nonce(self, peter, alice, chat):
        # Missing nonce -> should NOT be treated as encrypted (defensive check)
        r = requests.post(f"{API}/chats/{chat['id']}/messages",
                          headers=_auth_headers(peter['token']),
                          json={'chat_id': chat['id'], 'type': 'text', 'content': 'fallback',
                                'ciphertext': 'onlycipher', 'algo': 'nacl.box.v1'},
                          timeout=15)
        assert r.status_code == 200
        msg = r.json()
        assert msg['e2ee'] is False


# ---------- AI chat still works ---------------------------------------------

class TestAIChatUnaffected:
    def test_ai_chat_plaintext_reply(self, peter):
        r = requests.post(f"{API}/ai/start-chat", headers=_auth_headers(peter['token']), timeout=15)
        assert r.status_code == 200
        ai_chat = r.json()
        r2 = requests.post(f"{API}/chats/{ai_chat['id']}/messages",
                           headers=_auth_headers(peter['token']),
                           json={'chat_id': ai_chat['id'], 'type': 'text',
                                 'content': f'ping-{uuid.uuid4().hex[:6]}'},
                           timeout=15)
        assert r2.status_code == 200
        msg = r2.json()
        assert msg['e2ee'] is False, "AI chat messages must never be E2EE"
        assert msg['content']  # sender content preserved
        # Wait a bit for the AI reply
        time.sleep(6)
        r3 = requests.get(f"{API}/chats/{ai_chat['id']}/messages",
                          headers=_auth_headers(peter['token']), timeout=20)
        assert r3.status_code == 200
        msgs = r3.json()
        ai_msgs = [m for m in msgs if m.get('sender_id') == 'ai-assistant-wave']
        assert ai_msgs, "AI did not reply within timeout"
        assert all(not m.get('e2ee') for m in ai_msgs), "AI replies must not be E2EE"
