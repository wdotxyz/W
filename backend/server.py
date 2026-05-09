from fastapi import FastAPI, APIRouter, HTTPException, Depends, WebSocket, WebSocketDisconnect, Header
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os, logging, uuid, random, json, asyncio
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any, Set
from datetime import datetime, timezone, timedelta
import jwt as pyjwt

from emergentintegrations.llm.chat import LlmChat, UserMessage

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

JWT_SECRET = os.environ.get('JWT_SECRET', 'wave-secret')
EMERGENT_LLM_KEY = os.environ.get('EMERGENT_LLM_KEY', '')
AI_USER_ID = "ai-assistant-wave"

app = FastAPI()
api_router = APIRouter(prefix="/api")

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)


# -------------------- Models --------------------
class SendOtpReq(BaseModel):
    phone: str

class VerifyOtpReq(BaseModel):
    phone: str
    otp: str

class ProfileReq(BaseModel):
    name: str
    avatar: Optional[str] = None  # base64 or URL
    about: Optional[str] = "Hey there! I'm using Wave."

class CreateChatReq(BaseModel):
    member_ids: List[str]
    is_group: bool = False
    name: Optional[str] = None
    avatar: Optional[str] = None

class SendMessageReq(BaseModel):
    chat_id: str
    type: str = "text"  # text|image|voice
    content: str  # text or base64 for media
    duration: Optional[int] = None  # for voice notes (seconds)

class AiChatReq(BaseModel):
    message: str
    session_id: Optional[str] = None


def now_iso():
    return datetime.now(timezone.utc).isoformat()


def make_token(user_id: str) -> str:
    payload = {"user_id": user_id, "exp": datetime.now(timezone.utc) + timedelta(days=30)}
    return pyjwt.encode(payload, JWT_SECRET, algorithm="HS256")


async def get_current_user(authorization: str = Header(None)) -> Dict[str, Any]:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, "Missing token")
    token = authorization.split(" ", 1)[1]
    try:
        payload = pyjwt.decode(token, JWT_SECRET, algorithms=["HS256"])
    except Exception:
        raise HTTPException(401, "Invalid token")
    user = await db.users.find_one({"id": payload["user_id"]}, {"_id": 0})
    if not user:
        raise HTTPException(401, "User not found")
    return user


# -------------------- Auth --------------------
@api_router.post("/auth/send-otp")
async def send_otp(req: SendOtpReq):
    otp = f"{random.randint(0, 999999):06d}"
    # DEV MODE: store and return OTP. In production use Twilio.
    await db.otps.update_one(
        {"phone": req.phone},
        {"$set": {"phone": req.phone, "otp": otp, "created_at": now_iso()}},
        upsert=True,
    )
    logger.info(f"[DEV OTP] {req.phone} -> {otp}")
    return {"success": True, "dev_otp": otp, "message": "OTP sent (dev mode)"}


@api_router.post("/auth/verify-otp")
async def verify_otp(req: VerifyOtpReq):
    rec = await db.otps.find_one({"phone": req.phone}, {"_id": 0})
    if not rec or rec.get("otp") != req.otp:
        raise HTTPException(400, "Invalid OTP")
    user = await db.users.find_one({"phone": req.phone}, {"_id": 0})
    is_new = False
    if not user:
        is_new = True
        user = {
            "id": str(uuid.uuid4()),
            "phone": req.phone,
            "name": "",
            "avatar": None,
            "about": "Hey there! I'm using Wave.",
            "created_at": now_iso(),
            "last_seen": now_iso(),
        }
        await db.users.insert_one(user)
        user.pop("_id", None)
    await db.otps.delete_one({"phone": req.phone})
    token = make_token(user["id"])
    return {"token": token, "user": user, "is_new": is_new}


@api_router.post("/auth/profile")
async def update_profile(req: ProfileReq, user=Depends(get_current_user)):
    update = {"name": req.name, "avatar": req.avatar, "about": req.about or user.get("about")}
    await db.users.update_one({"id": user["id"]}, {"$set": update})
    user.update(update)
    return user


@api_router.get("/auth/me")
async def me(user=Depends(get_current_user)):
    return user


# -------------------- Users --------------------
@api_router.get("/users")
async def list_users(user=Depends(get_current_user)):
    users = await db.users.find({"id": {"$ne": user["id"]}}, {"_id": 0}).to_list(500)
    return users


# -------------------- Chats --------------------
async def _serialize_chat(chat: dict, user_id: str) -> dict:
    chat.pop("_id", None)
    # last message
    last = await db.messages.find_one(
        {"chat_id": chat["id"]}, {"_id": 0}, sort=[("created_at", -1)]
    )
    chat["last_message"] = last
    # unread count
    chat["unread"] = await db.messages.count_documents({
        "chat_id": chat["id"],
        "sender_id": {"$ne": user_id},
        "read_by": {"$ne": user_id},
    })
    # other users info
    other_ids = [m for m in chat["member_ids"] if m != user_id]
    others = await db.users.find({"id": {"$in": other_ids}}, {"_id": 0}).to_list(50)
    chat["members"] = others
    if not chat.get("is_group") and others:
        chat["display_name"] = others[0].get("name") or others[0].get("phone")
        chat["display_avatar"] = others[0].get("avatar")
    else:
        chat["display_name"] = chat.get("name", "Group")
        chat["display_avatar"] = chat.get("avatar")
    return chat


@api_router.get("/chats")
async def list_chats(user=Depends(get_current_user)):
    chats = await db.chats.find({"member_ids": user["id"]}, {"_id": 0}).to_list(200)
    out = [await _serialize_chat(c, user["id"]) for c in chats]
    out.sort(key=lambda c: (c.get("last_message") or {}).get("created_at") or c.get("created_at"), reverse=True)
    return out


@api_router.post("/chats")
async def create_chat(req: CreateChatReq, user=Depends(get_current_user)):
    member_ids = list(set(req.member_ids + [user["id"]]))
    if not req.is_group and len(member_ids) == 2:
        existing = await db.chats.find_one(
            {"is_group": False, "member_ids": {"$all": member_ids, "$size": 2}}, {"_id": 0}
        )
        if existing:
            return await _serialize_chat(existing, user["id"])
    chat = {
        "id": str(uuid.uuid4()),
        "is_group": req.is_group,
        "name": req.name,
        "avatar": req.avatar,
        "member_ids": member_ids,
        "created_by": user["id"],
        "created_at": now_iso(),
    }
    await db.chats.insert_one(dict(chat))
    return await _serialize_chat(chat, user["id"])


@api_router.get("/chats/{chat_id}/messages")
async def get_messages(chat_id: str, user=Depends(get_current_user)):
    chat = await db.chats.find_one({"id": chat_id, "member_ids": user["id"]}, {"_id": 0})
    if not chat:
        raise HTTPException(404, "Chat not found")
    msgs = await db.messages.find({"chat_id": chat_id}, {"_id": 0}).sort("created_at", 1).to_list(1000)
    # mark all unread as read
    await db.messages.update_many(
        {"chat_id": chat_id, "sender_id": {"$ne": user["id"]}, "read_by": {"$ne": user["id"]}},
        {"$addToSet": {"read_by": user["id"]}},
    )
    return msgs


@api_router.post("/chats/{chat_id}/messages")
async def send_message(chat_id: str, req: SendMessageReq, user=Depends(get_current_user)):
    chat = await db.chats.find_one({"id": chat_id, "member_ids": user["id"]}, {"_id": 0})
    if not chat:
        raise HTTPException(404, "Chat not found")
    msg = {
        "id": str(uuid.uuid4()),
        "chat_id": chat_id,
        "sender_id": user["id"],
        "sender_name": user.get("name") or user.get("phone"),
        "type": req.type,
        "content": req.content,
        "duration": req.duration,
        "read_by": [user["id"]],
        "created_at": now_iso(),
    }
    await db.messages.insert_one(dict(msg))

    # Broadcast via WS to chat members
    await ws_manager.broadcast_to_users(
        [m for m in chat["member_ids"]],
        {"type": "new_message", "chat_id": chat_id, "message": msg},
    )

    # If chat includes AI Assistant, generate AI reply
    if AI_USER_ID in chat["member_ids"] and user["id"] != AI_USER_ID and req.type == "text":
        asyncio.create_task(_handle_ai_reply(chat_id, chat["member_ids"], req.content))

    return msg


# -------------------- AI Assistant --------------------
async def _handle_ai_reply(chat_id: str, member_ids: List[str], user_text: str):
    try:
        await ws_manager.broadcast_to_users(
            member_ids, {"type": "typing", "chat_id": chat_id, "user_id": AI_USER_ID, "is_typing": True}
        )
        # Build short history (last 12 msgs)
        prior = await db.messages.find({"chat_id": chat_id}, {"_id": 0}).sort("created_at", -1).to_list(12)
        prior.reverse()
        chat = LlmChat(
            api_key=EMERGENT_LLM_KEY,
            session_id=f"chat-{chat_id}",
            system_message=(
                "You are Wave AI, a friendly and helpful AI assistant inside the Wave messaging app. "
                "Reply concisely (1-3 short paragraphs), be warm, helpful, and conversational. Use plain text."
            ),
        ).with_model("anthropic", "claude-sonnet-4-5-20250929")

        # Re-feed prior context as user message stream is via lib; just send latest with light context
        context = "\n".join(
            f"{'User' if m['sender_id'] != AI_USER_ID else 'You'}: {m['content']}"
            for m in prior[:-1] if m.get("type") == "text"
        )
        prompt = (context + "\n\nUser: " + user_text) if context else user_text

        reply_text = await chat.send_message(UserMessage(text=prompt))

        ai_msg = {
            "id": str(uuid.uuid4()),
            "chat_id": chat_id,
            "sender_id": AI_USER_ID,
            "sender_name": "Wave AI",
            "type": "text",
            "content": str(reply_text).strip(),
            "duration": None,
            "read_by": [AI_USER_ID],
            "created_at": now_iso(),
        }
        await db.messages.insert_one(dict(ai_msg))
        await ws_manager.broadcast_to_users(
            member_ids, {"type": "typing", "chat_id": chat_id, "user_id": AI_USER_ID, "is_typing": False}
        )
        await ws_manager.broadcast_to_users(
            member_ids, {"type": "new_message", "chat_id": chat_id, "message": ai_msg}
        )
    except Exception as e:
        logger.exception(f"AI reply failed: {e}")
        err_msg = {
            "id": str(uuid.uuid4()),
            "chat_id": chat_id,
            "sender_id": AI_USER_ID,
            "sender_name": "Wave AI",
            "type": "text",
            "content": "Sorry, I couldn't process that right now. Please try again.",
            "duration": None,
            "read_by": [AI_USER_ID],
            "created_at": now_iso(),
        }
        await db.messages.insert_one(dict(err_msg))
        await ws_manager.broadcast_to_users(
            member_ids, {"type": "new_message", "chat_id": chat_id, "message": err_msg}
        )


@api_router.post("/ai/start-chat")
async def start_ai_chat(user=Depends(get_current_user)):
    """Create or fetch the user's 1-1 chat with Wave AI."""
    member_ids = sorted([user["id"], AI_USER_ID])
    existing = await db.chats.find_one(
        {"is_group": False, "member_ids": {"$all": member_ids, "$size": 2}}, {"_id": 0}
    )
    if existing:
        return await _serialize_chat(existing, user["id"])
    chat = {
        "id": str(uuid.uuid4()),
        "is_group": False,
        "name": "Wave AI",
        "avatar": None,
        "member_ids": member_ids,
        "created_by": user["id"],
        "created_at": now_iso(),
        "is_ai": True,
    }
    await db.chats.insert_one(dict(chat))
    return await _serialize_chat(chat, user["id"])


# -------------------- WebSocket --------------------
class WSManager:
    def __init__(self):
        self.connections: Dict[str, Set[WebSocket]] = {}

    async def connect(self, user_id: str, ws: WebSocket):
        await ws.accept()
        self.connections.setdefault(user_id, set()).add(ws)
        await db.users.update_one({"id": user_id}, {"$set": {"online": True, "last_seen": now_iso()}})

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


ws_manager = WSManager()


@app.websocket("/api/ws")
async def websocket_endpoint(ws: WebSocket, token: str = ""):
    user_id = None
    try:
        payload = pyjwt.decode(token, JWT_SECRET, algorithms=["HS256"])
        user_id = payload["user_id"]
    except Exception:
        await ws.close(code=1008)
        return
    await ws_manager.connect(user_id, ws)
    try:
        while True:
            data = await ws.receive_json()
            t = data.get("type")
            if t == "typing":
                chat = await db.chats.find_one({"id": data.get("chat_id")}, {"_id": 0, "member_ids": 1})
                if chat:
                    await ws_manager.broadcast_to_users(
                        [m for m in chat["member_ids"] if m != user_id],
                        {"type": "typing", "chat_id": data["chat_id"], "user_id": user_id, "is_typing": data.get("is_typing", False)},
                    )
            elif t == "ping":
                await ws.send_json({"type": "pong"})
    except WebSocketDisconnect:
        pass
    except Exception as e:
        logger.exception(f"WS error: {e}")
    finally:
        if user_id:
            ws_manager.disconnect(user_id, ws)
            await db.users.update_one({"id": user_id}, {"$set": {"online": False, "last_seen": now_iso()}})


# -------------------- Health --------------------
@api_router.get("/")
async def root():
    return {"app": "Wave", "status": "ok"}


# -------------------- Startup --------------------
@app.on_event("startup")
async def on_startup():
    # Seed AI user
    existing = await db.users.find_one({"id": AI_USER_ID})
    if not existing:
        await db.users.insert_one({
            "id": AI_USER_ID,
            "phone": "+0000000000",
            "name": "Wave AI",
            "avatar": "https://static.prod-images.emergentagent.com/jobs/0a6fb986-57f6-4143-b026-cc3c8d533f4c/images/d2f56f77cf3edfad4a9352fce5f4beb25e8482a5ae9b951ace5b84f1d947d0f9.png",
            "about": "Your AI-native assistant. Ask me anything!",
            "created_at": now_iso(),
            "last_seen": now_iso(),
            "is_ai": True,
            "online": True,
        })
    # Indexes
    await db.users.create_index("id", unique=True)
    await db.users.create_index("phone", unique=True)
    await db.chats.create_index("id", unique=True)
    await db.chats.create_index("member_ids")
    await db.messages.create_index([("chat_id", 1), ("created_at", 1)])
    logger.info("Wave backend started.")


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()


app.include_router(api_router)
app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)
