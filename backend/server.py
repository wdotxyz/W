"""W backend entry point. Wires routers and lifecycle events."""
import os
import uuid

import bcrypt
from fastapi import APIRouter, FastAPI
from starlette.middleware.cors import CORSMiddleware

from core.config import AI_USER_ID, MAIL_DOMAIN
from core.db import db, logger, mongo_client
from core.security import now_iso
from core.ws import websocket_endpoint
from routers import admin, auth, billing, calls, chats, keys, mail, statuses, support, ai as ai_router

app = FastAPI()
api_router = APIRouter(prefix='/api')

# Mount sub-routers under /api
api_router.include_router(auth.router)
api_router.include_router(chats.router)
api_router.include_router(mail.router)
api_router.include_router(billing.router)
api_router.include_router(calls.router)
api_router.include_router(statuses.router)
api_router.include_router(ai_router.router)
api_router.include_router(support.router)
api_router.include_router(admin.router)
api_router.include_router(keys.router)


@api_router.get('/')
async def root():
    return {'app': 'W', 'status': 'ok'}


app.include_router(api_router)

# WebSocket endpoint (must be on the app, not the prefixed router for compatibility)
app.add_api_websocket_route('/api/ws', websocket_endpoint)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=['*'],
    allow_methods=['*'],
    allow_headers=['*'],
)


@app.on_event('startup')
async def on_startup():
    # Seed AI user
    existing = await db.users.find_one({'id': AI_USER_ID})
    if not existing:
        await db.users.insert_one({
            'id': AI_USER_ID,
            'phone': '+0000000000',
            'name': 'W AI',
            'avatar': 'https://static.prod-images.emergentagent.com/jobs/0a6fb986-57f6-4143-b026-cc3c8d533f4c/images/d2f56f77cf3edfad4a9352fce5f4beb25e8482a5ae9b951ace5b84f1d947d0f9.png',
            'about': 'Your AI-native assistant. Ask me anything!',
            'created_at': now_iso(),
            'last_seen': now_iso(),
            'is_ai': True,
            'online': True,
        })

    # Seed Support team account (support@w.xyz)
    support_addr = f'support@{MAIL_DOMAIN}'
    support_user = await db.users.find_one({'email_address': support_addr})
    if not support_user:
        seed_pw = os.environ.get('SUPPORT_SEED_PASSWORD') or 'WSupport2026!'
        await db.users.insert_one({
            'id': str(uuid.uuid4()),
            'phone': '+0000000001',  # placeholder, not used for sign-in
            'name': 'W Support',
            'handle': 'support',
            'email_handle': 'support',
            'email_address': support_addr,
            'fallback_address': support_addr,
            'tier': 'pro',  # team account gets pro-level capabilities
            'password_hash': bcrypt.hashpw(seed_pw.encode(), bcrypt.gensalt()).decode(),
            'about': "We're here to help. Email us anytime at support@w.xyz.",
            'ghost_mail_enabled': False,  # support inbox must keep history
            'created_at': now_iso(),
            'last_seen': now_iso(),
            'is_support': True,
        })
        logger.info(f'Seeded W Support team account: {support_addr}')

    # Indexes
    await db.users.create_index('id', unique=True)
    await db.users.create_index('phone', unique=True)
    await db.chats.create_index('id', unique=True)
    await db.chats.create_index('member_ids')
    await db.messages.create_index([('chat_id', 1), ('created_at', 1)])
    await db.emails.create_index([('owner_id', 1), ('folder', 1), ('created_at', -1)])
    await db.emails.create_index('to_addrs')
    await db.users.create_index('email_handle', sparse=True, unique=True)
    await db.emails.create_index('thread_id', sparse=True)
    await db.emails.create_index('message_id', sparse=True)
    await db.statuses.create_index([('user_id', 1), ('created_at', -1)])
    await db.statuses.create_index('expires_at')
    await db.emails.create_index('scheduled_at', sparse=True)
    # Start the scheduled-send sweeper
    import asyncio
    asyncio.create_task(_scheduled_send_loop())
    # Start the Ghost Mail sweeper — deletes emails older than 24h unless saved
    asyncio.create_task(_ghost_mail_sweep_loop())
    logger.info('W backend started.')


async def _ghost_mail_sweep_loop() -> None:
    """Background sweeper: every 5 minutes, delete any email older than 24
    hours that the user has NOT explicitly saved (starred). Applies to both
    incoming and outgoing mail. Archived and snoozed emails are exempt.

    This is the new "Ghost Mail" behaviour: mail vanishes automatically after
    24h unless the user hits Save.
    """
    import asyncio
    from datetime import datetime, timedelta, timezone
    while True:
        try:
            cutoff = (datetime.now(timezone.utc) - timedelta(hours=24)).isoformat()
            now_s = datetime.now(timezone.utc).isoformat()
            # Find eligible victims: created > 24h ago, not saved, not archived, not currently snoozed
            q = {
                'created_at': {'$lte': cutoff},
                'starred': {'$ne': True},
                'archived': {'$ne': True},
                '$or': [
                    {'snoozed_until': {'$exists': False}},
                    {'snoozed_until': None},
                    {'snoozed_until': {'$lte': now_s}},
                ],
            }
            victims = await db.emails.find(q, {'_id': 0, 'id': 1, 'owner_id': 1}).to_list(1000)
            if victims:
                ids = [v['id'] for v in victims]
                await db.emails.delete_many({'id': {'$in': ids}})
                # Group by owner so we can notify each user's open sessions.
                from collections import defaultdict
                by_owner = defaultdict(list)
                for v in victims:
                    if v.get('owner_id'):
                        by_owner[v['owner_id']].append(v['id'])
                for owner_id, del_ids in by_owner.items():
                    try:
                        await ws_manager.send_to_user(owner_id, {'type': 'mail_deleted', 'ids': del_ids, 'reason': 'ghost_mail_24h'})
                    except Exception:
                        pass
                logger.info(f'Ghost Mail sweep: deleted {len(ids)} emails older than 24h')
        except Exception as e:
            logger.warning(f'ghost-mail sweep failed: {type(e).__name__}: {str(e)[:120]}')
        await asyncio.sleep(300)  # 5 minutes


async def _scheduled_send_loop() -> None:
    """Background sweeper: every few seconds, find emails whose scheduled_at
    is due and dispatch them via SendGrid."""
    import asyncio
    from routers.mail import _send_record_now
    from core.security import _utcnow
    while True:
        try:
            now = _utcnow().isoformat()
            due_cursor = db.emails.find({'folder': 'scheduled', 'scheduled_at': {'$lte': now}}, {'_id': 0})
            due = await due_cursor.to_list(50)
            for rec in due:
                user = await db.users.find_one({'id': rec.get('owner_id')})
                if not user:
                    continue
                # Move to sent first so a crash doesn't double-send
                await db.emails.update_one(
                    {'id': rec['id']},
                    {'$set': {'folder': 'sent', 'delivery_status': 'queued'}, '$unset': {'scheduled_at': ''}},
                )
                await _send_record_now(rec, user)
                await db.emails.update_one(
                    {'id': rec['id']},
                    {'$set': {'delivery_status': rec.get('delivery_status'), 'delivery_error': rec.get('delivery_error')}},
                )
        except Exception as e:
            logger.warning(f'scheduled-send sweep failed: {type(e).__name__}: {str(e)[:120]}')
        await asyncio.sleep(5)


@app.on_event('shutdown')
async def shutdown_db_client():
    mongo_client.close()
