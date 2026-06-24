"""WebSocket connection manager + auth-aware endpoint handler."""
from typing import Dict, List, Set

from fastapi import WebSocket, WebSocketDisconnect

from core.db import db, logger
from core.security import decode_token, now_iso


class WSManager:
    def __init__(self):
        self.connections: Dict[str, Set[WebSocket]] = {}

    async def connect(self, user_id: str, ws: WebSocket):
        await ws.accept()
        self.connections.setdefault(user_id, set()).add(ws)
        await db.users.update_one({'id': user_id}, {'$set': {'online': True, 'last_seen': now_iso()}})

    def disconnect(self, user_id: str, ws: WebSocket):
        if user_id in self.connections:
            self.connections[user_id].discard(ws)
            if not self.connections[user_id]:
                del self.connections[user_id]

    async def send_to_user(self, user_id: str, payload: dict):
        for ws in list(self.connections.get(user_id, [])):
            try:
                await ws.send_json(payload)
            except Exception:
                pass

    async def broadcast_to_users(self, user_ids: List[str], payload: dict):
        for uid in set(user_ids):
            await self.send_to_user(uid, payload)


# Module-level singleton imported by routers/services
ws_manager = WSManager()


async def websocket_endpoint(ws: WebSocket, token: str = ''):
    user_id = None
    try:
        payload = decode_token(token)
        user_id = payload['user_id']
    except Exception:
        await ws.close(code=1008)
        return
    await ws_manager.connect(user_id, ws)
    try:
        while True:
            data = await ws.receive_json()
            t = data.get('type')
            if t == 'typing':
                chat = await db.chats.find_one({'id': data.get('chat_id')}, {'_id': 0, 'member_ids': 1})
                if chat:
                    await ws_manager.broadcast_to_users(
                        [m for m in chat['member_ids'] if m != user_id],
                        {'type': 'typing', 'chat_id': data['chat_id'], 'user_id': user_id, 'is_typing': data.get('is_typing', False)},
                    )
            elif t == 'ping':
                await ws.send_json({'type': 'pong'})
    except WebSocketDisconnect:
        pass
    except Exception as e:
        logger.exception(f'WS error: {e}')
    finally:
        if user_id:
            ws_manager.disconnect(user_id, ws)
            await db.users.update_one({'id': user_id}, {'$set': {'online': False, 'last_seen': now_iso()}})
