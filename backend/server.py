from fastapi import FastAPI, APIRouter, HTTPException, Depends, WebSocket, WebSocketDisconnect, Header, Request, Form, UploadFile, File
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os, logging, uuid, random, json, asyncio, re, base64
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
MAIL_DOMAIN = os.environ.get('MAIL_DOMAIN', 'w.xyz')
SENDGRID_API_KEY = os.environ.get('SENDGRID_API_KEY', '')
MAIL_FROM_DEFAULT = os.environ.get('MAIL_FROM_DEFAULT', f'noreply@{MAIL_DOMAIN}')
RESERVED_HANDLES = {
    "admin", "administrator", "root", "support", "help", "info", "contact",
    "noreply", "no-reply", "postmaster", "abuse", "hostmaster", "webmaster",
    "mail", "email", "ceo", "legal", "billing", "sales", "security", "team",
    "wave", "waveai", "ai",
}
HANDLE_RE = re.compile(r"^[a-z0-9][a-z0-9._-]{1,30}[a-z0-9]$")

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


class NotifSettingsReq(BaseModel):
    message_sounds: Optional[bool] = None
    group_sounds: Optional[bool] = None
    show_preview: Optional[bool] = None
    vibration: Optional[bool] = None
    mute_all: Optional[bool] = None

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


@api_router.patch("/auth/notification-settings")
async def update_notif_settings(req: NotifSettingsReq, user=Depends(get_current_user)):
    update = {f"notif.{k}": v for k, v in req.dict().items() if v is not None}
    if update:
        await db.users.update_one({"id": user["id"]}, {"$set": update})
    fresh = await db.users.find_one({"id": user["id"]}, {"_id": 0})
    return fresh.get("notif", {}) if fresh else {}


class SignatureReq(BaseModel):
    signature: str = ""


@api_router.patch("/auth/signature")
async def update_signature(req: SignatureReq, user=Depends(get_current_user)):
    sig = (req.signature or "")[:1000]
    await db.users.update_one({"id": user["id"]}, {"$set": {"signature": sig}})
    return {"signature": sig}


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
                "You are W AI, a friendly and helpful AI assistant inside the W messaging app. "
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
            "sender_name": "W AI",
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
            "sender_name": "W AI",
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
        "name": "W AI",
        "avatar": None,
        "member_ids": member_ids,
        "created_by": user["id"],
        "created_at": now_iso(),
        "is_ai": True,
    }
    await db.chats.insert_one(dict(chat))
    return await _serialize_chat(chat, user["id"])


# -------------------- Wave Mail --------------------
class ClaimHandleReq(BaseModel):
    handle: str

class ComposeMailReq(BaseModel):
    to: List[str]
    subject: str = ""
    body: str = ""
    attachments: Optional[List[Dict[str, Any]]] = None  # [{filename, content_b64, type}]
    draft_id: Optional[str] = None
    in_reply_to: Optional[str] = None
    thread_id: Optional[str] = None


class DraftReq(BaseModel):
    id: Optional[str] = None
    to: List[str] = []
    subject: str = ""
    body: str = ""
    attachments: Optional[List[Dict[str, Any]]] = None


def _validate_handle(h: str) -> str:
    h = (h or "").strip().lower()
    if not HANDLE_RE.match(h):
        raise HTTPException(400, "Handle must be 3-32 chars, letters/numbers/._- only.")
    if h in RESERVED_HANDLES:
        raise HTTPException(400, "That handle is reserved.")
    return h


@api_router.get("/mail/check-handle/{handle}")
async def check_handle(handle: str, user=Depends(get_current_user)):
    try:
        h = _validate_handle(handle)
    except HTTPException as e:
        return {"available": False, "reason": e.detail}
    exists = await db.users.find_one({"email_handle": h, "id": {"$ne": user["id"]}}, {"_id": 0, "id": 1})
    return {"available": not exists, "handle": h, "address": f"{h}@{MAIL_DOMAIN}"}


@api_router.post("/mail/claim-handle")
async def claim_handle(req: ClaimHandleReq, user=Depends(get_current_user)):
    h = _validate_handle(req.handle)
    exists = await db.users.find_one({"email_handle": h, "id": {"$ne": user["id"]}}, {"_id": 0, "id": 1})
    if exists:
        raise HTTPException(409, "Handle already taken.")
    await db.users.update_one({"id": user["id"]}, {"$set": {"email_handle": h, "email_address": f"{h}@{MAIL_DOMAIN}"}})
    fresh = await db.users.find_one({"id": user["id"]}, {"_id": 0})
    return fresh


@api_router.get("/mail/inbox")
async def mail_inbox(user=Depends(get_current_user)):
    addr = user.get("email_address")
    if not addr:
        return []
    msgs = await db.emails.find({"to_addrs": addr.lower(), "folder": "inbox"}, {"_id": 0}).sort("created_at", -1).to_list(500)
    return msgs


@api_router.get("/mail/sent")
async def mail_sent(user=Depends(get_current_user)):
    msgs = await db.emails.find({"owner_id": user["id"], "folder": "sent"}, {"_id": 0}).sort("created_at", -1).to_list(500)
    return msgs


@api_router.get("/mail/drafts")
async def mail_drafts(user=Depends(get_current_user)):
    msgs = await db.emails.find({"owner_id": user["id"], "folder": "drafts"}, {"_id": 0}).sort("created_at", -1).to_list(500)
    return msgs


@api_router.get("/mail/search")
async def mail_search(q: str, user=Depends(get_current_user)):
    q = (q or "").strip()
    if not q:
        return []
    addr = (user.get("email_address") or "").lower()
    pattern = re.escape(q)
    query = {
        "$and": [
            {"$or": [
                {"owner_id": user["id"]},
                {"to_addrs": addr},
            ]},
            {"$or": [
                {"subject": {"$regex": pattern, "$options": "i"}},
                {"body": {"$regex": pattern, "$options": "i"}},
                {"from_addr": {"$regex": pattern, "$options": "i"}},
                {"from_name": {"$regex": pattern, "$options": "i"}},
                {"to_addrs": {"$regex": pattern, "$options": "i"}},
            ]},
        ]
    }
    msgs = await db.emails.find(query, {"_id": 0}).sort("created_at", -1).to_list(200)
    return msgs


@api_router.post("/mail/drafts")
async def save_draft(req: DraftReq, user=Depends(get_current_user)):
    if not user.get("email_address"):
        raise HTTPException(400, "Set up your @w.xyz handle first.")
    now = now_iso()
    if req.id:
        existing = await db.emails.find_one({"id": req.id, "owner_id": user["id"], "folder": "drafts"}, {"_id": 0})
        if not existing:
            raise HTTPException(404, "Draft not found")
        update = {
            "to_addrs": [a.strip().lower() for a in (req.to or []) if a.strip()],
            "subject": req.subject or "",
            "body": req.body or "",
            "attachments": req.attachments or [],
            "updated_at": now,
        }
        await db.emails.update_one({"id": req.id}, {"$set": update})
        fresh = await db.emails.find_one({"id": req.id}, {"_id": 0})
        return fresh
    record = {
        "id": str(uuid.uuid4()),
        "owner_id": user["id"],
        "folder": "drafts",
        "from_addr": user["email_address"],
        "from_name": user.get("name") or user["email_address"],
        "to_addrs": [a.strip().lower() for a in (req.to or []) if a.strip()],
        "subject": req.subject or "",
        "body": req.body or "",
        "attachments": req.attachments or [],
        "read": True,
        "created_at": now,
        "updated_at": now,
        "delivery_status": "draft",
    }
    await db.emails.insert_one(dict(record))
    return record


@api_router.delete("/mail/{mail_id}")
async def mail_delete(mail_id: str, user=Depends(get_current_user)):
    m = await db.emails.find_one({"id": mail_id}, {"_id": 0})
    if not m or m.get("owner_id") != user["id"]:
        raise HTTPException(404, "Not found")
    await db.emails.delete_one({"id": mail_id})
    return {"ok": True}


@api_router.get("/mail/{mail_id}")
async def mail_detail(mail_id: str, user=Depends(get_current_user)):
    m = await db.emails.find_one({"id": mail_id}, {"_id": 0})
    if not m:
        raise HTTPException(404, "Not found")
    addr = (user.get("email_address") or "").lower()
    if m.get("owner_id") != user["id"] and addr not in [a.lower() for a in (m.get("to_addrs") or [])]:
        raise HTTPException(403, "Forbidden")
    if not m.get("read") and m.get("folder") == "inbox" and addr in [a.lower() for a in (m.get("to_addrs") or [])]:
        await db.emails.update_one({"id": mail_id}, {"$set": {"read": True}})
        m["read"] = True
    return m


@api_router.patch("/mail/{mail_id}/read")
async def mail_mark_read(mail_id: str, user=Depends(get_current_user)):
    await db.emails.update_one({"id": mail_id}, {"$set": {"read": True}})
    return {"ok": True}


@api_router.post("/mail/compose")
async def mail_compose(req: ComposeMailReq, user=Depends(get_current_user)):
    if not user.get("email_address"):
        raise HTTPException(400, "Set up your @w.xyz handle first.")
    if not req.to or not req.subject and not req.body:
        raise HTTPException(400, "Recipient and subject/body required.")

    from_addr = user["email_address"]
    mail_id = str(uuid.uuid4())
    message_id = f"<{mail_id}@{MAIL_DOMAIN}>"
    # Determine thread_id: continue parent's thread, or start new from message_id
    thread_id = req.thread_id
    if req.in_reply_to and not thread_id:
        parent = await db.emails.find_one({"message_id": req.in_reply_to}, {"_id": 0, "thread_id": 1})
        thread_id = (parent or {}).get("thread_id") or req.in_reply_to
    if not thread_id:
        thread_id = message_id

    # Append signature
    body_out = req.body or ""
    sig = (user.get("signature") or "").strip()
    if sig and "-- " not in body_out:
        body_out = f"{body_out}\n\n-- \n{sig}"

    record = {
        "id": mail_id,
        "owner_id": user["id"],
        "folder": "sent",
        "from_addr": from_addr,
        "from_name": user.get("name") or from_addr,
        "to_addrs": [a.strip().lower() for a in req.to if a.strip()],
        "subject": req.subject or "(no subject)",
        "body": body_out,
        "body_html": "",
        "attachments": req.attachments or [],
        "read": True,
        "created_at": now_iso(),
        "delivery_status": "queued",
        "delivery_error": None,
        "message_id": message_id,
        "in_reply_to": req.in_reply_to,
        "thread_id": thread_id,
    }

    if SENDGRID_API_KEY:
        try:
            from sendgrid import SendGridAPIClient
            from sendgrid.helpers.mail import Mail, Email, To, Content, Attachment, FileContent, FileName, FileType, Disposition
            msg = Mail(
                from_email=Email(from_addr, user.get("name") or from_addr),
                subject=req.subject or "(no subject)",
                plain_text_content=Content("text/plain", body_out or " "),
            )
            for addr in record["to_addrs"]:
                msg.add_to(To(addr))
            for a in (req.attachments or []):
                if a.get("content_b64") and a.get("filename"):
                    att = Attachment(
                        FileContent(a["content_b64"]),
                        FileName(a["filename"]),
                        FileType(a.get("type") or "application/octet-stream"),
                        Disposition("attachment"),
                    )
                    msg.add_attachment(att)
            sg = SendGridAPIClient(SENDGRID_API_KEY)
            resp = sg.send(msg)
            record["delivery_status"] = "sent" if resp.status_code in (200, 202) else f"error_{resp.status_code}"
        except Exception as e:
            logger.exception("SendGrid send failed")
            record["delivery_status"] = "error"
            record["delivery_error"] = str(e)[:300]
    else:
        record["delivery_status"] = "saved_no_provider"
        record["delivery_error"] = "SendGrid API key not configured yet; email saved to Sent folder only."

    await db.emails.insert_one(dict(record))
    # If composed from a draft, delete it after send
    if req.draft_id:
        await db.emails.delete_one({"id": req.draft_id, "owner_id": user["id"], "folder": "drafts"})
    return record


@app.post("/api/mail/inbound")
async def mail_inbound(request: Request):
    """SendGrid Inbound Parse webhook (multipart/form-data, no auth).
    Stores email for any recipient that matches a user's email_address."""
    form = await request.form()
    to_raw = (form.get("to") or "").strip()
    frm = (form.get("from") or "").strip()
    subject = (form.get("subject") or "").strip()
    text = (form.get("text") or "").strip()
    html = (form.get("html") or "").strip()
    envelope = form.get("envelope") or "{}"
    try:
        env = json.loads(envelope) if isinstance(envelope, str) else {}
    except Exception:
        env = {}
    raw_to = env.get("to") or []
    if not raw_to:
        raw_to = [e.strip() for e in re.findall(r"[\w._+-]+@[\w.-]+", to_raw)]
    to_addrs = [a.lower() for a in raw_to]

    # collect attachments
    attachments = []
    n = int(form.get("attachments") or 0)
    for i in range(1, n + 1):
        f = form.get(f"attachment{i}")
        if f and hasattr(f, "read"):
            data = await f.read() if hasattr(f.read, "__await__") else f.read()
            try:
                b64 = base64.b64encode(data).decode("ascii")
            except Exception:
                b64 = ""
            attachments.append({"filename": f.filename, "type": f.content_type, "content_b64": b64, "size": len(data)})

    # find matching user(s) on our domain
    domain_to = [a for a in to_addrs if a.endswith(f"@{MAIL_DOMAIN}")]
    if not domain_to:
        logger.info(f"Inbound mail dropped (no domain match): {to_addrs}")
        return {"ok": True, "stored": 0}

    sender_match = re.search(r"[\w._+-]+@[\w.-]+", frm or "")
    sender = sender_match.group(0).lower() if sender_match else frm

    # Parse threading headers from SendGrid Inbound Parse "headers" field
    raw_headers = form.get("headers") or ""
    msg_id = None
    in_reply_to = None
    references = None
    if raw_headers:
        for line in str(raw_headers).split("\n"):
            low = line.lower()
            if low.startswith("message-id:"):
                m = re.search(r"<[^>]+>", line)
                if m: msg_id = m.group(0)
            elif low.startswith("in-reply-to:"):
                m = re.search(r"<[^>]+>", line)
                if m: in_reply_to = m.group(0)
            elif low.startswith("references:"):
                refs = re.findall(r"<[^>]+>", line)
                if refs: references = refs

    # Find thread_id (continue parent's thread)
    thread_id = None
    if in_reply_to:
        parent = await db.emails.find_one({"message_id": in_reply_to}, {"_id": 0, "thread_id": 1})
        thread_id = (parent or {}).get("thread_id") or in_reply_to
    if not thread_id and references:
        for r in references:
            parent = await db.emails.find_one({"message_id": r}, {"_id": 0, "thread_id": 1})
            if parent:
                thread_id = parent.get("thread_id") or r
                break
    if not thread_id:
        thread_id = msg_id or str(uuid.uuid4())

    stored = 0
    for addr in domain_to:
        owner = await db.users.find_one({"email_address": addr}, {"_id": 0})
        if not owner:
            continue
        rec = {
            "id": str(uuid.uuid4()),
            "owner_id": owner["id"],
            "folder": "inbox",
            "from_addr": sender,
            "from_name": frm.split("<")[0].strip().strip('"') if "<" in frm else sender,
            "to_addrs": to_addrs,
            "subject": subject or "(no subject)",
            "body": text or _strip_html(html),
            "body_html": _sanitize_html(html),
            "attachments": attachments,
            "read": False,
            "created_at": now_iso(),
            "delivery_status": "received",
            "message_id": msg_id,
            "in_reply_to": in_reply_to,
            "thread_id": thread_id,
        }
        await db.emails.insert_one(dict(rec))
        stored += 1
        await ws_manager.send_to_user(owner["id"], {"type": "new_email", "email": rec})

    return {"ok": True, "stored": stored}


def _strip_html(s: str) -> str:
    return re.sub(r"<[^>]+>", "", s or "").strip()


# -------------------- Status / Updates --------------------
class StatusReq(BaseModel):
    type: str = "text"  # text | image
    content: str  # text body or base64 image
    background: Optional[str] = None  # hex color for text status


@api_router.post("/statuses")
async def post_status(req: StatusReq, user=Depends(get_current_user)):
    now = datetime.now(timezone.utc)
    rec = {
        "id": str(uuid.uuid4()),
        "user_id": user["id"],
        "user_name": user.get("name") or user.get("phone"),
        "user_avatar": user.get("avatar"),
        "type": req.type,
        "content": req.content,
        "background": req.background or "#0B3B60",
        "created_at": now.isoformat(),
        "expires_at": (now + timedelta(hours=24)).isoformat(),
        "viewed_by": [],
    }
    await db.statuses.insert_one(dict(rec))
    return rec


@api_router.get("/statuses")
async def list_statuses(user=Depends(get_current_user)):
    now_s = datetime.now(timezone.utc).isoformat()
    cursor = db.statuses.find({"expires_at": {"$gt": now_s}}, {"_id": 0}).sort("created_at", -1)
    items = await cursor.to_list(500)
    # Group by user_id; my status separately
    mine: List[dict] = []
    grouped: Dict[str, List[dict]] = {}
    for s in items:
        if s["user_id"] == user["id"]:
            mine.append(s)
        else:
            grouped.setdefault(s["user_id"], []).append(s)
    contacts = []
    for uid, lst in grouped.items():
        lst.sort(key=lambda x: x["created_at"], reverse=True)
        viewed = all(user["id"] in (s.get("viewed_by") or []) for s in lst)
        contacts.append({
            "user_id": uid,
            "user_name": lst[0]["user_name"],
            "user_avatar": lst[0]["user_avatar"],
            "latest": lst[0],
            "count": len(lst),
            "all_viewed": viewed,
        })
    contacts.sort(key=lambda c: c["latest"]["created_at"], reverse=True)
    return {"my_statuses": mine, "contacts": contacts}


@api_router.get("/statuses/{user_id}")
async def user_statuses(user_id: str, user=Depends(get_current_user)):
    now_s = datetime.now(timezone.utc).isoformat()
    items = await db.statuses.find({"user_id": user_id, "expires_at": {"$gt": now_s}}, {"_id": 0}).sort("created_at", 1).to_list(50)
    # mark as viewed
    if user_id != user["id"]:
        await db.statuses.update_many(
            {"user_id": user_id, "expires_at": {"$gt": now_s}, "viewed_by": {"$ne": user["id"]}},
            {"$addToSet": {"viewed_by": user["id"]}},
        )
    return items


@api_router.delete("/statuses/{status_id}")
async def delete_status(status_id: str, user=Depends(get_current_user)):
    r = await db.statuses.delete_one({"id": status_id, "user_id": user["id"]})
    if r.deleted_count == 0:
        raise HTTPException(404, "Not found")
    return {"ok": True}


def _sanitize_html(s: str) -> str:
    """Basic HTML sanitization — strip scripts/iframes/on* handlers/javascript URLs.
    Not bulletproof but blocks the obvious XSS for our internal renderer.
    """
    if not s:
        return ""
    out = s
    out = re.sub(r"<\s*(script|style|iframe|object|embed|link|meta)[^>]*>.*?<\s*/\s*\1\s*>", "", out, flags=re.I | re.S)
    out = re.sub(r"<\s*(script|style|iframe|object|embed|link|meta)[^>]*/?\s*>", "", out, flags=re.I)
    out = re.sub(r"\s+on\w+\s*=\s*\"[^\"]*\"", "", out, flags=re.I)
    out = re.sub(r"\s+on\w+\s*=\s*'[^']*'", "", out, flags=re.I)
    out = re.sub(r"\s+on\w+\s*=\s*[^\s>]+", "", out, flags=re.I)
    out = re.sub(r"(href|src)\s*=\s*\"\s*javascript:[^\"]*\"", r'\1="#"', out, flags=re.I)
    out = re.sub(r"(href|src)\s*=\s*'\s*javascript:[^']*'", r"\1='#'", out, flags=re.I)
    return out



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
    return {"app": "W", "status": "ok"}


# -------------------- Startup --------------------
@app.on_event("startup")
async def on_startup():
    # Seed AI user
    existing = await db.users.find_one({"id": AI_USER_ID})
    if not existing:
        await db.users.insert_one({
            "id": AI_USER_ID,
            "phone": "+0000000000",
            "name": "W AI",
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
    await db.emails.create_index([("owner_id", 1), ("folder", 1), ("created_at", -1)])
    await db.emails.create_index("to_addrs")
    await db.users.create_index("email_handle", sparse=True, unique=True)
    await db.emails.create_index("thread_id", sparse=True)
    await db.emails.create_index("message_id", sparse=True)
    await db.statuses.create_index([("user_id", 1), ("created_at", -1)])
    await db.statuses.create_index("expires_at")
    logger.info("W backend started.")


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
