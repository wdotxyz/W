"""Daily.co voice/video call endpoints."""
import uuid
from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException

from core.config import DAILY_SUBDOMAIN, DAILY_CALL_TTL
from core.db import db
from core.security import _parse_dt, _utcnow, get_current_user, now_iso
from core.ws import ws_manager
from models.schemas import JoinCallReq, StartCallReq
from services.calls import _daily_request

router = APIRouter()


@router.post('/calls/start')
async def calls_start(req: StartCallReq, user=Depends(get_current_user)):
    """Create a Daily room + owner token, save call record, broadcast incoming-call event."""
    chat = await db.chats.find_one({'id': req.chat_id, 'member_ids': user['id']}, {'_id': 0})
    if not chat:
        raise HTTPException(404, 'Chat not found')
    now = _utcnow()
    exp_unix = int((now + timedelta(seconds=DAILY_CALL_TTL)).timestamp())
    room_name = f"chat-{req.chat_id[:8]}-{uuid.uuid4().hex[:8]}"
    await _daily_request('POST', '/rooms', {
        'name': room_name,
        'privacy': 'private',
        'properties': {
            'exp': exp_unix,
            'eject_at_room_exp': True,
            'max_participants': 2,
            'start_video_off': req.call_type == 'audio',
            'start_audio_off': False,
        },
    })
    owner = await _daily_request('POST', '/meeting-tokens', {
        'properties': {'room_name': room_name, 'exp': exp_unix, 'is_owner': True,
                       'user_name': user.get('name') or 'Caller', 'user_id': user['id']},
    })
    room_url = f"https://{DAILY_SUBDOMAIN}.daily.co/{room_name}"
    await db.calls.insert_one({
        'id': str(uuid.uuid4()), 'chat_id': req.chat_id, 'room_name': room_name, 'room_url': room_url,
        'owner_user_id': user['id'], 'call_type': req.call_type,
        'created_at': now_iso(), 'expires_at': (now + timedelta(seconds=DAILY_CALL_TTL)).isoformat(),
        'ended_at': None,
    })
    callee_ids = [m for m in (chat.get('member_ids') or []) if m != user['id'] and m != 'ai-assistant-wave']
    payload = {
        'type': 'incoming_call', 'chat_id': req.chat_id, 'room_url': room_url,
        'call_type': req.call_type, 'from_user_id': user['id'],
        'from_name': user.get('name') or user.get('phone') or 'Someone',
        'from_avatar': user.get('avatar'),
    }
    for cid in callee_ids:
        try:
            await ws_manager.broadcast_to_users([cid], payload)
        except Exception:
            pass
    return {'room_url': room_url, 'owner_token': owner['token'], 'expires_at': payload.get('expires_at')}


@router.post('/calls/join')
async def calls_join(req: JoinCallReq, user=Depends(get_current_user)):
    room_name = req.room_url.rstrip('/').split('/')[-1]
    doc = await db.calls.find_one({'room_name': room_name}, {'_id': 0})
    if not doc:
        raise HTTPException(404, 'Call not found')
    chat = await db.chats.find_one({'id': doc['chat_id'], 'member_ids': user['id']}, {'_id': 0})
    if not chat:
        raise HTTPException(403, 'Not a member of this chat')
    exp = _parse_dt(doc.get('expires_at'))
    if exp and exp < _utcnow():
        raise HTTPException(410, 'Call expired')
    token = await _daily_request('POST', '/meeting-tokens', {
        'properties': {'room_name': room_name, 'exp': int(exp.timestamp()) if exp else None,
                       'is_owner': False, 'user_name': user.get('name') or 'Guest', 'user_id': user['id']},
    })
    return {'room_url': doc['room_url'], 'participant_token': token['token']}


@router.post('/calls/end')
async def calls_end(req: JoinCallReq, user=Depends(get_current_user)):
    room_name = req.room_url.rstrip('/').split('/')[-1]
    doc = await db.calls.find_one({'room_name': room_name}, {'_id': 0})
    if not doc:
        return {'ok': True}
    if doc['owner_user_id'] != user['id']:
        return {'ok': True, 'owner_only': True}
    try:
        await _daily_request('DELETE', f'/rooms/{room_name}')
    except Exception:
        pass
    await db.calls.update_one({'room_name': room_name}, {'$set': {'ended_at': now_iso()}})
    return {'ok': True, 'deleted': True}
