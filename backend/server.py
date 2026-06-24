"""W backend entry point. Wires routers and lifecycle events."""
from fastapi import APIRouter, FastAPI
from starlette.middleware.cors import CORSMiddleware

from core.config import AI_USER_ID
from core.db import db, logger, mongo_client
from core.security import now_iso
from core.ws import websocket_endpoint
from routers import auth, billing, calls, chats, mail, statuses, ai as ai_router

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
