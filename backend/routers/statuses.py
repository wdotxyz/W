"""24-hour status updates (Stories)."""
import uuid
from datetime import datetime, timezone, timedelta
from typing import Dict, List

from fastapi import APIRouter, Depends, HTTPException

from core.db import db
from core.security import get_current_user
from models.schemas import StatusReq

router = APIRouter()


@router.post('/statuses')
async def post_status(req: StatusReq, user=Depends(get_current_user)):
    now = datetime.now(timezone.utc)
    rec = {
        'id': str(uuid.uuid4()),
        'user_id': user['id'],
        'user_name': user.get('name') or user.get('phone'),
        'user_avatar': user.get('avatar'),
        'type': req.type,
        'content': req.content,
        'background': req.background or '#0B3B60',
        'created_at': now.isoformat(),
        'expires_at': (now + timedelta(hours=24)).isoformat(),
        'viewed_by': [],
    }
    await db.statuses.insert_one(dict(rec))
    return rec


@router.get('/statuses')
async def list_statuses(user=Depends(get_current_user)):
    now_s = datetime.now(timezone.utc).isoformat()
    cursor = db.statuses.find({'expires_at': {'$gt': now_s}}, {'_id': 0}).sort('created_at', -1)
    items = await cursor.to_list(500)
    mine: List[dict] = []
    grouped: Dict[str, List[dict]] = {}
    for s in items:
        if s['user_id'] == user['id']:
            mine.append(s)
        else:
            grouped.setdefault(s['user_id'], []).append(s)
    contacts = []
    for uid, lst in grouped.items():
        lst.sort(key=lambda x: x['created_at'], reverse=True)
        viewed = all(user['id'] in (s.get('viewed_by') or []) for s in lst)
        contacts.append({
            'user_id': uid,
            'user_name': lst[0]['user_name'],
            'user_avatar': lst[0]['user_avatar'],
            'latest': lst[0],
            'count': len(lst),
            'all_viewed': viewed,
        })
    contacts.sort(key=lambda c: c['latest']['created_at'], reverse=True)
    return {'my_statuses': mine, 'contacts': contacts}


@router.get('/statuses/{user_id}')
async def user_statuses(user_id: str, user=Depends(get_current_user)):
    now_s = datetime.now(timezone.utc).isoformat()
    items = await db.statuses.find({'user_id': user_id, 'expires_at': {'$gt': now_s}}, {'_id': 0}).sort('created_at', 1).to_list(50)
    if user_id != user['id']:
        await db.statuses.update_many(
            {'user_id': user_id, 'expires_at': {'$gt': now_s}, 'viewed_by': {'$ne': user['id']}},
            {'$addToSet': {'viewed_by': user['id']}},
        )
    return items


@router.delete('/statuses/{status_id}')
async def delete_status(status_id: str, user=Depends(get_current_user)):
    r = await db.statuses.delete_one({'id': status_id, 'user_id': user['id']})
    if r.deleted_count == 0:
        raise HTTPException(404, 'Not found')
    return {'ok': True}
