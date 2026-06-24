"""Chats, messages, and the AI assistant entry point."""
import asyncio
import uuid
from typing import List

from fastapi import APIRouter, Depends, HTTPException

from core.config import AI_USER_ID
from core.db import db
from core.security import get_current_user, now_iso
from core.ws import ws_manager
from models.schemas import CreateChatReq, SendMessageReq
from services.ai import _handle_ai_reply
from services.helpers import (
    _approx_b64_bytes, _check_and_bump_storage, _serialize_chat, _user_tier,
)

router = APIRouter()


@router.get('/chats')
async def list_chats(user=Depends(get_current_user)):
    chats = await db.chats.find({'member_ids': user['id']}, {'_id': 0}).to_list(200)
    out = [await _serialize_chat(c, user['id']) for c in chats]
    out.sort(key=lambda c: (c.get('last_message') or {}).get('created_at') or c.get('created_at'), reverse=True)
    return out


@router.post('/chats')
async def create_chat(req: CreateChatReq, user=Depends(get_current_user)):
    member_ids = list(set(req.member_ids + [user['id']]))
    if not req.is_group and len(member_ids) == 2:
        existing = await db.chats.find_one(
            {'is_group': False, 'member_ids': {'$all': member_ids, '$size': 2}}, {'_id': 0}
        )
        if existing:
            return await _serialize_chat(existing, user['id'])
    chat = {
        'id': str(uuid.uuid4()),
        'is_group': req.is_group,
        'name': req.name,
        'avatar': req.avatar,
        'member_ids': member_ids,
        'created_by': user['id'],
        'created_at': now_iso(),
    }
    await db.chats.insert_one(dict(chat))
    return await _serialize_chat(chat, user['id'])


@router.get('/chats/{chat_id}/messages')
async def get_messages(chat_id: str, user=Depends(get_current_user)):
    chat = await db.chats.find_one({'id': chat_id, 'member_ids': user['id']}, {'_id': 0})
    if not chat:
        raise HTTPException(404, 'Chat not found')
    msgs = await db.messages.find({'chat_id': chat_id}, {'_id': 0}).sort('created_at', 1).to_list(1000)
    await db.messages.update_many(
        {'chat_id': chat_id, 'sender_id': {'$ne': user['id']}, 'read_by': {'$ne': user['id']}},
        {'$addToSet': {'read_by': user['id']}},
    )
    return msgs


@router.post('/chats/{chat_id}/messages')
async def send_message(chat_id: str, req: SendMessageReq, user=Depends(get_current_user)):
    chat = await db.chats.find_one({'id': chat_id, 'member_ids': user['id']}, {'_id': 0})
    if not chat:
        raise HTTPException(404, 'Chat not found')
    if req.type in ('image', 'voice', 'file') and req.content:
        await _check_and_bump_storage(user, _approx_b64_bytes(req.content))
    msg = {
        'id': str(uuid.uuid4()),
        'chat_id': chat_id,
        'sender_id': user['id'],
        'sender_name': user.get('name') or user.get('phone'),
        'sender_tier': _user_tier(user),
        'type': req.type,
        'content': req.content,
        'duration': req.duration,
        'read_by': [user['id']],
        'created_at': now_iso(),
    }
    await db.messages.insert_one(dict(msg))

    await ws_manager.broadcast_to_users(
        [m for m in chat['member_ids']],
        {'type': 'new_message', 'chat_id': chat_id, 'message': msg},
    )

    if AI_USER_ID in chat['member_ids'] and user['id'] != AI_USER_ID and req.type == 'text':
        asyncio.create_task(_handle_ai_reply(chat_id, chat['member_ids'], req.content))

    return msg


@router.post('/ai/start-chat')
async def start_ai_chat(user=Depends(get_current_user)):
    member_ids = sorted([user['id'], AI_USER_ID])
    existing = await db.chats.find_one(
        {'is_group': False, 'member_ids': {'$all': member_ids, '$size': 2}}, {'_id': 0}
    )
    if existing:
        return await _serialize_chat(existing, user['id'])
    chat = {
        'id': str(uuid.uuid4()),
        'is_group': False,
        'name': 'W AI',
        'avatar': None,
        'member_ids': member_ids,
        'created_by': user['id'],
        'created_at': now_iso(),
        'is_ai': True,
    }
    await db.chats.insert_one(dict(chat))
    return await _serialize_chat(chat, user['id'])
