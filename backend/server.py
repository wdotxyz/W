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
from routers import admin, auth, billing, calls, chats, mail, statuses, support, ai as ai_router

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
    logger.info('W backend started.')


@app.on_event('shutdown')
async def shutdown_db_client():
    mongo_client.close()
