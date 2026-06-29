"""Chats, messages, and the AI assistant entry point."""
import asyncio
import uuid
from typing import List

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from core.config import AI_USER_ID
from core.db import db, logger
from core.security import get_current_user, now_iso
from core.ws import ws_manager
from models.schemas import CreateChatReq, SendMessageReq
from services.ai import _handle_ai_reply
from services.helpers import (
    _approx_b64_bytes, _check_and_bump_storage, _serialize_chat, _user_tier,
)
from services.sendgrid_mail import send_system_email

router = APIRouter()


class InviteToChatReq(BaseModel):
    to: str  # recipient — either a W handle (peter@w.xyz) or any external email


@router.get('/chats/contacts')
async def list_contacts(user=Depends(get_current_user)):
    """W users you have ever chatted with (your real contacts).

    Excludes the AI assistant and the current user. The legacy /users endpoint
    leaked every seeded test user, which made New Chat noisy. This one only
    surfaces relationships that already exist.
    """
    chats = await db.chats.find(
        {'member_ids': user['id'], 'is_group': {'$ne': True}},
        {'_id': 0, 'member_ids': 1},
    ).to_list(500)
    peer_ids = set()
    for c in chats:
        for mid in c.get('member_ids', []):
            if mid != user['id'] and mid != AI_USER_ID:
                peer_ids.add(mid)
    if not peer_ids:
        return []
    users = await db.users.find(
        {'id': {'$in': list(peer_ids)}, 'deactivated': {'$ne': True}},
        {'_id': 0, 'id': 1, 'name': 1, 'email_address': 1, 'email': 1, 'avatar': 1, 'about': 1, 'is_ai': 1, 'tier': 1, 'is_support': 1},
    ).to_list(500)
    return users


@router.post('/chats/invite')
async def invite_to_chat(req: InviteToChatReq, user=Depends(get_current_user)):
    """Start a chat with a recipient.

    If the recipient is already a W user (matched by their W handle or
    recovery email), open or create the 1-on-1 chat directly.
    Otherwise, send an email invitation with a magic signup link and tell
    the client we invited them.
    """
    addr = (req.to or '').strip().lower()
    if not addr or '@' not in addr:
        raise HTTPException(400, 'Provide a valid email address or W handle.')

    # Look up the recipient as a W user (handle OR linked recovery email)
    recipient = await db.users.find_one({
        '$or': [
            {'email_address': addr},
            {'email': addr},
            {'recovery_email': addr},
        ],
        'deactivated': {'$ne': True},
    }, {'_id': 0})

    if recipient and recipient.get('id') != user['id']:
        # Open or create the 1-on-1 chat
        member_ids = sorted({user['id'], recipient['id']})
        existing = await db.chats.find_one(
            {'is_group': False, 'member_ids': {'$all': member_ids, '$size': 2}},
            {'_id': 0},
        )
        if existing:
            chat = await _serialize_chat(existing, user['id'])
        else:
            new_chat = {
                'id': str(uuid.uuid4()),
                'is_group': False,
                'name': None,
                'avatar': None,
                'member_ids': member_ids,
                'created_by': user['id'],
                'created_at': now_iso(),
            }
            await db.chats.insert_one(dict(new_chat))
            chat = await _serialize_chat(new_chat, user['id'])
        return {'status': 'chat_ready', 'invited': False, 'chat': chat}

    # Recipient isn't a W user yet → email them an invite
    invited_at = now_iso()
    await db.invitations.insert_one({
        'id': str(uuid.uuid4()),
        'from_user_id': user['id'],
        'to_email': addr,
        'created_at': invited_at,
    })

    inviter_name = user.get('name') or user.get('email_address') or 'A friend'
    inviter_handle = user.get('email_address') or ''
    signup_url = f'https://joinw.xyz/signup?invited_by={inviter_handle}'
    subject = f'{inviter_name} invited you to chat on W'
    html = (
        f'<p>Hi there,</p>'
        f'<p><strong>{inviter_name}</strong> wants to chat with you on '
        f'<a href="https://joinw.xyz">W</a> — an AI-native webmail &amp; messaging app.</p>'
        f'<p>Create your free <code>@w.xyz</code> handle here:</p>'
        f'<p><a href="{signup_url}" style="display:inline-block;padding:12px 22px;background:#0A7A90;color:#fff;border-radius:10px;text-decoration:none;font-weight:700">Join W & chat back</a></p>'
        f'<p style="color:#5B7083;font-size:12px;margin-top:24px">If you weren&apos;t expecting this invite, just ignore it.</p>'
    )
    text = (
        f"{inviter_name} wants to chat with you on W.\n\n"
        f"Create your free @w.xyz handle: {signup_url}\n\n"
        f"If you weren't expecting this invite, just ignore it."
    )
    try:
        sent = await send_system_email(addr, subject, html, text)
    except Exception:
        logger.exception('chat invite email failed')
        sent = False
    if not sent:
        # Don't surface SendGrid hiccups as a hard error — the invitation row
        # is recorded and the inviter can retry. Tell them what happened.
        return {'status': 'invite_logged', 'invited': True, 'email': addr, 'delivery': 'queued'}
    return {'status': 'invited', 'invited': True, 'email': addr, 'delivery': 'sent'}


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
