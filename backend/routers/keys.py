"""W↔W end-to-end encryption — public-key directory.

Each W user generates a TweetNaCl X25519 keypair on their device the first
time they sign in. The private key never leaves the device (stored in
expo-secure-store / OS keychain). The public key is uploaded here so other
W users can encrypt messages to them.

In v1 we use a single long-lived identity key per user. Forward secrecy
(Signal-style Double Ratchet) is a planned hardening pass.
"""
from datetime import datetime, timezone
from typing import List

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from core.db import db, logger
from core.security import get_current_user, now_iso

router = APIRouter()


class PublishKeyReq(BaseModel):
    public_key: str = Field(..., min_length=10, max_length=200)  # base64 X25519 (~44 chars)
    algo: str = "nacl.box.v1"


class PublicKeyOut(BaseModel):
    user_id: str
    public_key: str
    algo: str
    created_at: str


@router.post('/keys/publish')
async def publish_key(req: PublishKeyReq, user=Depends(get_current_user)):
    """Upload (or replace) the current user's public key."""
    pk = (req.public_key or '').strip()
    if not pk:
        raise HTTPException(400, 'public_key required.')
    doc = {
        'user_id': user['id'],
        'public_key': pk,
        'algo': req.algo or 'nacl.box.v1',
        'created_at': now_iso(),
    }
    await db.user_keys.update_one(
        {'user_id': user['id']},
        {'$set': doc},
        upsert=True,
    )
    logger.info(f'E2EE key published for user {user["id"][:8]}…')
    return {'ok': True}


@router.get('/keys/peer/{user_id}', response_model=PublicKeyOut)
async def get_peer_key(user_id: str, user=Depends(get_current_user)):
    """Fetch a peer's public key so we can encrypt messages to them."""
    doc = await db.user_keys.find_one({'user_id': user_id}, {'_id': 0})
    if not doc:
        raise HTTPException(404, "This user hasn't published an encryption key yet.")
    return doc


class BulkPeerReq(BaseModel):
    user_ids: List[str]


@router.post('/keys/peers')
async def get_peer_keys_bulk(req: BulkPeerReq, user=Depends(get_current_user)):
    """Bulk lookup — used by chat list to flag which chats are E2EE-capable."""
    if not req.user_ids:
        return {'keys': {}}
    docs = await db.user_keys.find(
        {'user_id': {'$in': req.user_ids[:200]}},
        {'_id': 0},
    ).to_list(200)
    return {'keys': {d['user_id']: d for d in docs}}


@router.get('/keys/me')
async def my_key(user=Depends(get_current_user)):
    """Return the current user's published public key (or 404 if not yet set up)."""
    doc = await db.user_keys.find_one({'user_id': user['id']}, {'_id': 0})
    if not doc:
        raise HTTPException(404, 'No key published yet.')
    return doc
