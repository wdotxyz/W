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
from emergentintegrations.payments.stripe.checkout import StripeCheckout, CheckoutSessionRequest

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
TWILIO_ACCOUNT_SID = os.environ.get('TWILIO_ACCOUNT_SID', '')
TWILIO_AUTH_TOKEN = os.environ.get('TWILIO_AUTH_TOKEN', '')
TWILIO_PHONE_NUMBER = os.environ.get('TWILIO_PHONE_NUMBER', '')
RESERVED_HANDLES = {
    # ── System / role accounts ──
    "admin", "administrator", "root", "support", "help", "helpdesk", "info", "contact",
    "noreply", "no-reply", "postmaster", "abuse", "hostmaster", "webmaster",
    "mail", "email", "ceo", "legal", "billing", "sales", "security", "team",
    "press", "media", "feedback", "newsletter", "marketing", "hr", "jobs",
    "careers", "privacy", "terms", "policy", "moderator", "mod", "staff",
    "official", "verified", "premium", "pro", "plus",
    # ── W / Wave product names ──
    "wave", "waveai", "ai", "wmail", "w-mail", "w", "ww", "www", "wxyz",
    # ── Big-tech trademarks ──
    "apple", "google", "microsoft", "amazon", "meta", "facebook", "instagram",
    "whatsapp", "twitter", "tiktok", "snapchat", "linkedin", "youtube",
    "netflix", "spotify", "uber", "lyft", "airbnb", "stripe", "openai", "claude",
    "anthropic", "gemini", "chatgpt", "github", "gitlab", "dropbox", "slack",
    "discord", "telegram", "signal", "zoom", "twitch", "reddit", "pinterest",
    "tesla", "spacex", "nvidia", "oracle", "ibm", "intel", "amd", "samsung",
    "sony", "huawei", "xiaomi", "lenovo", "dell", "hp",
    # ── Other major brands ──
    "nike", "adidas", "puma", "reebok", "gucci", "prada", "chanel", "rolex",
    "ferrari", "porsche", "lamborghini", "bmw", "mercedes", "audi", "toyota",
    "honda", "ford", "chevrolet", "starbucks", "mcdonalds", "kfc", "subway",
    "burgerking", "dominos", "pizzahut", "cocacola", "pepsi", "redbull",
    # ── Crypto / finance ──
    "bitcoin", "btc", "ethereum", "eth", "coinbase", "binance", "robinhood",
    "paypal", "venmo", "cashapp", "visa", "mastercard", "amex",
    # ── Celebrity stage names / icons (small starter set) ──
    "beyonce", "drake", "eminem", "rihanna", "kanye", "jayz", "jay-z",
    "taylorswift", "taylor-swift", "ladygaga", "lady-gaga", "billieeilish",
    "billie-eilish", "arianagrande", "ariana-grande", "selenagomez",
    "elonmusk", "elon", "musk", "obama", "biden", "trump", "kardashian",
    "kim-k", "kimk", "queen", "kingjames", "lebron", "messi", "ronaldo",
    "mrbeast", "pewdiepie", "ninja", "shroud",
    # ── Religious / sensitive ──
    "god", "jesus", "allah", "buddha", "satan", "devil",
}

# Profanity / slur fragments — block any handle that CONTAINS one of these.
# Substring match catches "asshole123", "fuckface", "n1gger" etc.
PROFANITY_FRAGMENTS = {
    "fuck", "shit", "bitch", "cunt", "asshol", "asshat", "bastard", "dickhead",
    "pussy", "twat", "wank", "cock", "boob", "tit", "anal", "porn",
    "nigger", "nigga", "n1gger", "n1gga", "faggot", "fag", "retard", "kike",
    "spic", "chink", "gook", "tranny", "whore", "slut", "rapist", "rape",
    "nazi", "hitler", "isis", "kkk", "pedophile", "pedo", "molest",
}
def _slugify_domain(d: str) -> str:
    return re.sub(r"[^a-z0-9-]+", "-", (d or "").strip().lower()).strip("-")


def _is_valid_domain(d: str) -> bool:
    if not d:
        return False
    d = re.sub(r"^https?://", "", (d or "").strip().lower()).split("/")[0]
    if len(d) > 253 or "." not in d or d.endswith("."):
        return False
    return bool(re.match(r"^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$", d))


HANDLE_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,24}[a-z0-9]$|^[a-z0-9]$")


def _is_reserved_or_profane(h: str) -> bool:
    if h in RESERVED_HANDLES:
        return True
    flat = h.replace("-", "")  # treat "f-u-c-k" the same as "fuck"
    for frag in PROFANITY_FRAGMENTS:
        if frag in flat:
            return True
    return False

# Handle pricing tiers
HANDLE_PREMIUM_MIN = 4   # 4–5 chars require premium subscription
HANDLE_FREE_MIN = 6      # 6–26 chars are free
HANDLE_MAX = 26
HANDLE_HARD_MIN = 4      # Anything below this is not available at all

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
    password: Optional[str] = None
    domain: Optional[str] = None  # custom domain (e.g. "janedoe.com") — if set, email = handle@domain


class CheckoutReq(BaseModel):
    tier: str
    interval: str


class StartCallReq(BaseModel):
    chat_id: str
    call_type: str = "video"  # "video" | "audio"


class JoinCallReq(BaseModel):
    room_url: str


class LoginReq(BaseModel):
    email: str
    password: str
    otp: Optional[str] = None  # required when account has 2FA enabled


class TwoFactorToggleReq(BaseModel):
    enable: bool
    password: str
    otp: Optional[str] = None  # required only when disabling 2FA


class SetPasswordReq(BaseModel):
    password: str
    current_password: Optional[str] = None  # required if a password already exists


class ForgotPasswordReq(BaseModel):
    email: str


class ResetPasswordReq(BaseModel):
    email: str
    otp: str
    new_password: str


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


# -------------------- Password helpers (bcrypt) --------------------
import bcrypt as _bcrypt

MIN_PASSWORD_LEN = 8
MAX_BCRYPT_BYTES = 72
FAILED_LOGIN_LIMIT = 5
FAILED_LOGIN_WINDOW_MINUTES = 15
LOCK_MINUTES = 15
GENERIC_AUTH_ERROR = "Invalid email or password"
# Dummy hash used to keep timing constant when email doesn't exist.
_DUMMY_HASH = _bcrypt.hashpw(b"dummypasswordxx", _bcrypt.gensalt(rounds=10)).decode()


def validate_password(password: str) -> None:
    if not isinstance(password, str) or len(password) < MIN_PASSWORD_LEN:
        raise HTTPException(400, "Password must be at least 8 characters")
    if len(password.encode("utf-8")) > MAX_BCRYPT_BYTES:
        raise HTTPException(400, "Password is too long (max 72 bytes)")
    if not re.search(r"[0-9\W_]", password):
        raise HTTPException(400, "Password must include a number or symbol")


def hash_password(password: str) -> str:
    validate_password(password)
    return _bcrypt.hashpw(password.encode("utf-8"), _bcrypt.gensalt(rounds=12)).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return _bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))
    except Exception:
        return False


def _utcnow():
    return datetime.now(timezone.utc)


def _parse_dt(v):
    """Mongo may return either a real datetime or an ISO string — normalize."""
    if v is None:
        return None
    if isinstance(v, datetime):
        return v if v.tzinfo else v.replace(tzinfo=timezone.utc)
    try:
        return datetime.fromisoformat(str(v).replace("Z", "+00:00"))
    except Exception:
        return None



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
    await db.otps.update_one(
        {"phone": req.phone},
        {"$set": {"phone": req.phone, "otp": otp, "created_at": now_iso()}},
        upsert=True,
    )
    twilio_configured = bool(TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN and TWILIO_PHONE_NUMBER)
    if twilio_configured:
        try:
            from twilio.rest import Client
            from twilio.base.exceptions import TwilioRestException
            client = Client(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN)
            client.messages.create(
                to=req.phone,
                from_=TWILIO_PHONE_NUMBER,
                body=f"Your W code is {otp}. Valid for 10 minutes. Don't share it.",
            )
            logger.info(f"[TWILIO] OTP sent to {req.phone}")
            return {"success": True, "message": "OTP sent via SMS"}
        except TwilioRestException as e:
            logger.exception(f"Twilio send failed: {e}")
            # Trial accounts can only send to verified numbers — fall back to dev mode for those
            if e.code == 21608 or "unverified" in str(e).lower():
                return {
                    "success": True,
                    "dev_otp": otp,
                    "message": "Twilio trial: number not verified. Showing dev OTP. Verify the number in Twilio Console or upgrade.",
                }
            raise HTTPException(400, f"SMS failed: {e.msg or str(e)}")
        except Exception as e:
            logger.exception(f"Twilio error: {e}")
            raise HTTPException(500, "Failed to send SMS")
    # Dev mode fallback
    logger.info(f"[DEV OTP] {req.phone} -> {otp}")
    return {"success": True, "dev_otp": otp, "message": "OTP sent (dev mode)"}


@api_router.post("/auth/verify-otp")
async def verify_otp(req: VerifyOtpReq):
    rec = await db.otps.find_one({"phone": req.phone}, {"_id": 0})
    if not rec or rec.get("otp") != req.otp:
        raise HTTPException(400, "Invalid OTP")
    user = await db.users.find_one({"phone": req.phone}, {"_id": 0})
    is_new = False
    reactivated = False
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
    elif user.get("deactivated"):
        # Auto-reactivate when a deactivated user signs back in
        await db.users.update_one(
            {"id": user["id"]},
            {"$set": {"deactivated": False, "reactivated_at": now_iso()},
             "$unset": {"deactivated_at": ""}},
        )
        user["deactivated"] = False
        reactivated = True
    await db.otps.delete_one({"phone": req.phone})
    # If a password was supplied (signup), hash & store it now and clear lockout
    if req.password:
        pw_hash = hash_password(req.password)
        await db.users.update_one(
            {"id": user["id"]},
            {"$set": {"password_hash": pw_hash, "failed_logins": 0},
             "$unset": {"failed_login_window_started_at": "", "lock_until": ""}},
        )
        user["password_hash"] = pw_hash
    token = make_token(user["id"])
    user.pop("password_hash", None)
    return {"token": token, "user": user, "is_new": is_new, "reactivated": reactivated}


def _mask_phone(phone: str) -> str:
    """Return e.g. '+1 ••• ••• 1234'."""
    if not phone:
        return ""
    digits = re.sub(r"\D", "", phone)
    if len(digits) < 4:
        return phone
    last = digits[-4:]
    return f"{phone[:phone.index(digits[0])]}••• ••• {last}"


async def _send_2fa_otp(user: dict, purpose: str = "login"):
    """Send a 2FA OTP to the user's phone. Returns dev_otp when Twilio is unavailable."""
    if not user.get("phone"):
        return None
    otp = f"{random.randint(0, 999999):06d}"
    await db.otps.update_one(
        {"phone": user["phone"]},
        {"$set": {"phone": user["phone"], "otp": otp, "created_at": now_iso(), "purpose": purpose}},
        upsert=True,
    )
    if TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN and TWILIO_PHONE_NUMBER:
        try:
            from twilio.rest import Client as _Twilio
            _Twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN).messages.create(
                to=user["phone"], from_=TWILIO_PHONE_NUMBER,
                body=f"Your W verification code is {otp}. Valid for 10 minutes.",
            )
            return None
        except Exception as e:
            logger.warning(f"Twilio 2FA SMS failed: {e}")
            return otp
    return otp


@api_router.post("/auth/login")
async def login(req: LoginReq):
    """Email + password login with optional 2-step phone OTP.

    Flow:
    - 2FA OFF → returns {token, user, ...} immediately.
    - 2FA ON, no otp supplied → sends OTP to phone, returns
      {requires_2fa: true, phone_masked, dev_otp?}.
    - 2FA ON, otp supplied → verifies password + OTP, returns {token, user, ...}.
    """
    email = (req.email or "").strip().lower()
    if not email or "@" not in email:
        verify_password(req.password or "", _DUMMY_HASH)
        raise HTTPException(401, GENERIC_AUTH_ERROR)
    user = await db.users.find_one({"email_address": email}, {"_id": 0})
    if not user:
        verify_password(req.password or "", _DUMMY_HASH)
        raise HTTPException(401, GENERIC_AUTH_ERROR)
    if user.get("deactivated"):
        raise HTTPException(401, GENERIC_AUTH_ERROR)
    lock_until = _parse_dt(user.get("lock_until"))
    if lock_until and lock_until > _utcnow():
        raise HTTPException(429, "Account temporarily locked. Try again in a few minutes.")
    pw_hash = user.get("password_hash")
    if not pw_hash:
        verify_password(req.password or "", _DUMMY_HASH)
        raise HTTPException(401, GENERIC_AUTH_ERROR)
    if not verify_password(req.password, pw_hash):
        # Bump failed-login counter & maybe lock
        now = _utcnow()
        window_start = _parse_dt(user.get("failed_login_window_started_at"))
        failed = int(user.get("failed_logins", 0))
        if not window_start or (now - window_start).total_seconds() > FAILED_LOGIN_WINDOW_MINUTES * 60:
            failed = 1
            window_start = now
        else:
            failed += 1
        update = {"failed_logins": failed, "failed_login_window_started_at": window_start.isoformat()}
        if failed >= FAILED_LOGIN_LIMIT:
            update["lock_until"] = (now + timedelta(minutes=LOCK_MINUTES)).isoformat()
        await db.users.update_one({"id": user["id"]}, {"$set": update})
        raise HTTPException(401, GENERIC_AUTH_ERROR)

    # Password OK. Branch on 2FA.
    if user.get("two_factor_enabled"):
        if not req.otp:
            dev_otp = await _send_2fa_otp(user, purpose="login")
            resp = {"requires_2fa": True, "phone_masked": _mask_phone(user.get("phone", ""))}
            if dev_otp:
                resp["dev_otp"] = dev_otp
            return resp
        # Verify the OTP
        rec = await db.otps.find_one({"phone": user["phone"]}, {"_id": 0})
        if not rec or rec.get("otp") != req.otp:
            raise HTTPException(401, "Invalid verification code")
        await db.otps.delete_one({"phone": user["phone"]})

    # Success
    await db.users.update_one(
        {"id": user["id"]},
        {"$set": {"failed_logins": 0, "last_login_at": now_iso()},
         "$unset": {"failed_login_window_started_at": "", "lock_until": ""}},
    )
    user.pop("password_hash", None)
    token = make_token(user["id"])
    return {"token": token, "user": user, "is_new": False, "reactivated": False}


@api_router.post("/auth/2fa")
async def toggle_2fa(req: TwoFactorToggleReq, user=Depends(get_current_user)):
    """Enable or disable 2-step verification.
    - Enabling requires the user's current password (re-auth).
    - Disabling requires both the password AND a fresh OTP sent to their phone.
    """
    pw_hash = user.get("password_hash")
    if not pw_hash or not verify_password(req.password, pw_hash):
        raise HTTPException(401, "Password is incorrect")
    if not user.get("phone"):
        raise HTTPException(400, "Add a phone number before enabling 2-step verification.")

    if req.enable:
        await db.users.update_one({"id": user["id"]}, {"$set": {"two_factor_enabled": True, "two_factor_enabled_at": now_iso()}})
        return {"two_factor_enabled": True}

    # Disabling — require OTP for extra safety
    if not req.otp:
        dev_otp = await _send_2fa_otp(user, purpose="disable_2fa")
        resp = {"requires_otp": True, "phone_masked": _mask_phone(user["phone"])}
        if dev_otp:
            resp["dev_otp"] = dev_otp
        return resp
    rec = await db.otps.find_one({"phone": user["phone"]}, {"_id": 0})
    if not rec or rec.get("otp") != req.otp:
        raise HTTPException(401, "Invalid verification code")
    await db.otps.delete_one({"phone": user["phone"]})
    await db.users.update_one(
        {"id": user["id"]},
        {"$set": {"two_factor_enabled": False},
         "$unset": {"two_factor_enabled_at": ""}},
    )
    return {"two_factor_enabled": False}


# Removed - keep old login above


@api_router.post("/auth/set-password")
async def set_password(req: SetPasswordReq, user=Depends(get_current_user)):
    """Set or change the authenticated user's password.
    If a password is already set, current_password must match.
    """
    existing = user.get("password_hash")
    if existing:
        if not req.current_password or not verify_password(req.current_password, existing):
            raise HTTPException(401, "Current password is incorrect")
    new_hash = hash_password(req.password)
    await db.users.update_one(
        {"id": user["id"]},
        {"$set": {"password_hash": new_hash, "failed_logins": 0, "password_updated_at": now_iso()},
         "$unset": {"failed_login_window_started_at": "", "lock_until": ""}},
    )
    return {"success": True}


@api_router.post("/auth/forgot-password")
async def forgot_password(req: ForgotPasswordReq):
    """Send a phone OTP to the email's owner. Always returns success (no enumeration)."""
    email = (req.email or "").strip().lower()
    if email and "@" in email:
        user = await db.users.find_one({"email_address": email}, {"_id": 0})
        if user and user.get("phone"):
            # Reuse send_otp internals (Twilio or dev fallback)
            try:
                otp = f"{random.randint(0, 999999):06d}"
                await db.otps.update_one(
                    {"phone": user["phone"]},
                    {"$set": {"phone": user["phone"], "otp": otp, "created_at": now_iso(),
                              "purpose": "password_reset"}},
                    upsert=True,
                )
                if TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN and TWILIO_PHONE_NUMBER:
                    try:
                        from twilio.rest import Client as _Twilio
                        _Twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN).messages.create(
                            to=user["phone"], from_=TWILIO_PHONE_NUMBER,
                            body=f"Your W password reset code is {otp}. Valid for 10 minutes.",
                        )
                    except Exception as e:
                        logger.warning(f"Twilio reset SMS failed: {e}")
                        return {"success": True, "dev_otp": otp}
                else:
                    return {"success": True, "dev_otp": otp}
            except Exception as e:
                logger.exception(f"forgot-password error: {e}")
    # Generic response either way
    return {"success": True}


@api_router.post("/auth/reset-password")
async def reset_password(req: ResetPasswordReq):
    email = (req.email or "").strip().lower()
    if not email or "@" not in email:
        raise HTTPException(401, GENERIC_AUTH_ERROR)
    user = await db.users.find_one({"email_address": email}, {"_id": 0})
    if not user or not user.get("phone"):
        raise HTTPException(401, GENERIC_AUTH_ERROR)
    rec = await db.otps.find_one({"phone": user["phone"]}, {"_id": 0})
    if not rec or rec.get("otp") != req.otp:
        raise HTTPException(401, GENERIC_AUTH_ERROR)
    # Hash + persist new password, consume OTP, clear lockout
    new_hash = hash_password(req.new_password)
    await db.users.update_one(
        {"id": user["id"]},
        {"$set": {"password_hash": new_hash, "failed_logins": 0,
                  "password_updated_at": now_iso(), "last_login_at": now_iso()},
         "$unset": {"failed_login_window_started_at": "", "lock_until": "",
                    "deactivated": "", "deactivated_at": ""}},
    )
    await db.otps.delete_one({"phone": user["phone"]})
    refreshed = await db.users.find_one({"id": user["id"]}, {"_id": 0, "password_hash": 0})
    token = make_token(user["id"])
    return {"token": token, "user": refreshed, "is_new": False, "reactivated": False}


@api_router.post("/auth/profile")
async def update_profile(req: ProfileReq, user=Depends(get_current_user)):
    update = {"name": req.name, "avatar": req.avatar, "about": req.about or user.get("about")}
    await db.users.update_one({"id": user["id"]}, {"$set": update})
    user.update(update)
    return user


@api_router.get("/auth/me")
async def me(user=Depends(get_current_user)):
    return user


@api_router.post("/auth/deactivate")
async def deactivate_account(user=Depends(get_current_user)):
    """Soft-disable the user's account. They are hidden from people-search,
    new chats cannot be started with them, but their data stays so they can
    reactivate just by signing back in with their phone number.
    """
    await db.users.update_one(
        {"id": user["id"]},
        {"$set": {"deactivated": True, "deactivated_at": now_iso()}},
    )
    logger.info(f"Account deactivated: user_id={user['id']} handle={user.get('email_handle')}")
    return {"deactivated": True}


@api_router.delete("/auth/me")
async def delete_account(user=Depends(get_current_user)):
    """Permanently delete the authenticated user's account and all their data.
    Per App Store / Google Play policy, this fully erases user-owned records.
    Outgoing emails already delivered cannot be recalled.
    """
    uid = user["id"]
    addr = (user.get("email_address") or "").lower()

    # 1) Remove user from chats they participate in; delete chats they were in alone or as 1:1
    chats = await db.chats.find({"member_ids": uid}, {"_id": 0}).to_list(1000)
    chat_ids_to_delete: list[str] = []
    for c in chats:
        members = [m for m in (c.get("member_ids") or []) if m != uid]
        # 1:1 or AI chat — drop the whole chat. Group chat — keep it but remove the user.
        if len(members) <= 1 or not c.get("is_group"):
            chat_ids_to_delete.append(c["id"])
        else:
            await db.chats.update_one({"id": c["id"]}, {"$pull": {"member_ids": uid}})

    if chat_ids_to_delete:
        await db.chats.delete_many({"id": {"$in": chat_ids_to_delete}})
        await db.messages.delete_many({"chat_id": {"$in": chat_ids_to_delete}})

    # 2) Remove messages the user sent in any remaining (group) chats so their content is gone too
    await db.messages.delete_many({"sender_id": uid})

    # 3) Wipe all owned mail (sent, drafts, inbox) and any inbound mail addressed to their handle
    await db.emails.delete_many({"owner_id": uid})
    if addr:
        await db.emails.delete_many({"to_addrs": addr})

    # 4) Wipe statuses & OTPs
    await db.statuses.delete_many({"user_id": uid})
    if user.get("phone"):
        await db.otps.delete_many({"phone": user["phone"]})

    # 5) Finally remove the user record itself
    await db.users.delete_one({"id": uid})

    logger.info(f"Account deleted: user_id={uid} handle={user.get('email_handle')} phone={user.get('phone')}")
    return {"deleted": True}


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
    users = await db.users.find(
        {"id": {"$ne": user["id"]}, "deactivated": {"$ne": True}},
        {"_id": 0},
    ).to_list(500)
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
        chat["display_tier"] = _user_tier(others[0])
    else:
        chat["display_name"] = chat.get("name", "Group")
        chat["display_avatar"] = chat.get("avatar")
        chat["display_tier"] = "free"
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
    # Quota check for binary content (images / voice notes)
    if req.type in ("image", "voice", "file") and req.content:
        await _check_and_bump_storage(user, _approx_b64_bytes(req.content))
    msg = {
        "id": str(uuid.uuid4()),
        "chat_id": chat_id,
        "sender_id": user["id"],
        "sender_name": user.get("name") or user.get("phone"),
        "sender_tier": _user_tier(user),
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


def _handle_tier(h: str) -> str:
    """Return 'free' | 'plus' | 'pro' | 'unavailable' based on length.
    - 1-3 chars: unavailable (no one can claim)
    - 4    chars: requires Pro tier
    - 5    chars: requires Plus tier (or higher)
    - 6-26 chars: free for everyone
    """
    n = len(h)
    if n < HANDLE_HARD_MIN:
        return "unavailable"
    if n == 4:
        return "pro"
    if n == 5:
        return "plus"
    return "free"


def _user_tier(user: dict) -> str:
    """Return active tier for a user — 'pro' / 'plus' / 'free'. Expiry-aware."""
    t = (user or {}).get("tier", "free")
    if t == "free":
        return "free"
    exp = _parse_dt((user or {}).get("tier_expires_at"))
    if exp and exp <= _utcnow():
        return "free"
    return t


def _tier_meets(required: str, current: str) -> bool:
    rank = {"free": 0, "plus": 1, "pro": 2}
    return rank.get(current, 0) >= rank.get(required, 0)


def _validate_handle(h: str, allow_premium: bool = False) -> str:
    h = (h or "").strip().lower()
    if not h or len(h) > HANDLE_MAX:
        raise HTTPException(400, f"Handle must be {HANDLE_HARD_MIN}–{HANDLE_MAX} characters.")
    if not re.match(r"^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$", h):
        raise HTTPException(400, "Letters, numbers and dashes only. Can't start or end with a dash.")
    tier = _handle_tier(h)
    if tier == "unavailable":
        raise HTTPException(400, f"Handles under {HANDLE_HARD_MIN} characters aren't available.")
    if tier == "premium" and not allow_premium:
        raise HTTPException(402, "This handle requires a premium subscription.")
    if _is_reserved_or_profane(h):
        raise HTTPException(403, "That handle isn't available. Email support@w.xyz to request it.")
    return h


@api_router.get("/mail/check-handle/{handle}")
async def check_handle(handle: str, authorization: Optional[str] = Header(None)):
    h = (handle or "").strip().lower()
    if not h or len(h) > HANDLE_MAX:
        return {"available": False, "tier": "unavailable", "reason": f"Must be {HANDLE_HARD_MIN}–{HANDLE_MAX} characters."}
    if not re.match(r"^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$", h):
        return {"available": False, "tier": "unavailable", "reason": "Letters, numbers and dashes only."}
    tier = _handle_tier(h)
    if tier == "unavailable":
        return {"available": False, "tier": "unavailable", "reason": f"Handles under {HANDLE_HARD_MIN} characters aren't available."}
    # Reserved / trademark / profanity / celebrity blocklist
    if _is_reserved_or_profane(h):
        return {
            "available": False,
            "tier": "reserved",
            "reason": "Reserved. Email support@w.xyz to request it (may require a premium subscription).",
            "support_email": "support@w.xyz",
        }
    exists = await db.users.find_one({"email_handle": h}, {"_id": 0, "id": 1})
    if exists:
        return {"available": False, "tier": tier, "reason": "Already taken."}
    return {
        "available": True,
        "tier": tier,
        "handle": h,
        "address": f"{h}@{MAIL_DOMAIN}",
        "requires_premium": tier in ("plus", "pro"),
    }


# ============================== BILLING ==============================

STRIPE_API_KEY = os.environ.get("STRIPE_API_KEY", "")

# Plans: amount in USD, days of access granted per purchase
PLAN_CATALOG = {
    ("plus", "month"): {"amount": 4.99, "days": 30, "tier": "plus", "label": "W Plus · Monthly"},
    ("plus", "year"):  {"amount": 49.00, "days": 365, "tier": "plus", "label": "W Plus · Yearly"},
    ("pro",  "month"): {"amount": 9.99, "days": 30, "tier": "pro", "label": "W Pro · Monthly"},
    ("pro",  "year"):  {"amount": 99.00, "days": 365, "tier": "pro", "label": "W Pro · Yearly"},
}
TIER_STORAGE_GB = {"free": 1, "plus": 50, "pro": 100}


def _stripe_client(webhook_url: Optional[str] = None) -> StripeCheckout:
    if not STRIPE_API_KEY:
        raise HTTPException(503, "Billing is not configured yet.")
    return StripeCheckout(api_key=STRIPE_API_KEY, webhook_url=webhook_url)


@api_router.get("/billing/plans")
async def billing_plans():
    return {
        "currency": "usd",
        "plans": [
            {"tier": "free", "label": "Free", "monthly": 0, "yearly": 0,
             "storage_gb": TIER_STORAGE_GB["free"],
             "perks": ["1 GB storage", "Custom @w.xyz address", "6+ character handles"]},
            {"tier": "plus", "label": "Plus",
             "monthly": PLAN_CATALOG[("plus", "month")]["amount"],
             "yearly":  PLAN_CATALOG[("plus", "year")]["amount"],
             "storage_gb": TIER_STORAGE_GB["plus"],
             "perks": ["50 GB storage", "5-character handles", "Blue check \u2713", "Priority support"]},
            {"tier": "pro", "label": "Pro",
             "monthly": PLAN_CATALOG[("pro", "month")]["amount"],
             "yearly":  PLAN_CATALOG[("pro", "year")]["amount"],
             "storage_gb": TIER_STORAGE_GB["pro"],
             "perks": ["100 GB storage", "4 & 5-character handles", "Blue check \u2713", "Priority support"]},
        ],
    }


@api_router.get("/billing/me")
async def billing_me(user=Depends(get_current_user)):
    tier = _user_tier(user)
    used = int(user.get("storage_used_bytes", 0) or 0)
    limit = TIER_STORAGE_GB.get(tier, 1) * 1024 * 1024 * 1024
    return {
        "tier": tier,
        "tier_label": tier.capitalize(),
        "tier_expires_at": user.get("tier_expires_at"),
        "storage_gb": TIER_STORAGE_GB.get(tier, 1),
        "storage_used_bytes": used,
        "storage_limit_bytes": limit,
        "storage_percent": round((used / limit) * 100, 1) if limit else 0,
        "has_blue_check": tier in ("plus", "pro"),
    }


def _storage_limit_bytes(user: dict) -> int:
    return TIER_STORAGE_GB.get(_user_tier(user), 1) * 1024 * 1024 * 1024


def _approx_b64_bytes(b64: Optional[str]) -> int:
    if not b64:
        return 0
    # data URI prefix stripped; base64 expands by ~4/3
    s = b64.split(",", 1)[-1] if b64.startswith("data:") else b64
    return int(len(s) * 3 / 4)


async def _check_and_bump_storage(user: dict, added_bytes: int) -> None:
    """Raise 413 if the upload would exceed the user's tier quota. Increments counter on success."""
    if added_bytes <= 0:
        return
    limit = _storage_limit_bytes(user)
    used = int(user.get("storage_used_bytes", 0) or 0)
    if used + added_bytes > limit:
        used_gb = used / (1024 ** 3)
        limit_gb = limit / (1024 ** 3)
        tier = _user_tier(user)
        raise HTTPException(
            413,
            f"Storage full — {used_gb:.2f} GB of {limit_gb:.0f} GB on the {tier.capitalize()} plan. Upgrade to keep uploading.",
        )
    await db.users.update_one({"id": user["id"]}, {"$inc": {"storage_used_bytes": added_bytes}})


@api_router.post("/billing/checkout")
async def billing_checkout(req: CheckoutReq, request: Request, user=Depends(get_current_user)):
    key = (req.tier, req.interval)
    if key not in PLAN_CATALOG:
        raise HTTPException(400, "Invalid plan selection.")
    plan = PLAN_CATALOG[key]
    origin = request.headers.get("origin") or os.environ.get("APP_PUBLIC_URL", "").rstrip("/")
    if not origin:
        raise HTTPException(500, "APP_PUBLIC_URL not configured.")
    success_url = f"{origin}/billing/success?session_id={{CHECKOUT_SESSION_ID}}"
    cancel_url = f"{origin}/billing/cancel"
    webhook_url = f"{origin}/api/billing/webhook"

    sc = _stripe_client(webhook_url=webhook_url)
    csr = CheckoutSessionRequest(
        amount=plan["amount"], currency="usd",
        success_url=success_url, cancel_url=cancel_url,
        metadata={"user_id": user["id"], "tier": plan["tier"],
                  "interval": req.interval, "days": str(plan["days"])},
    )
    session = await sc.create_checkout_session(csr)
    await db.payments.insert_one({
        "id": str(uuid.uuid4()), "session_id": session.session_id,
        "user_id": user["id"], "tier": plan["tier"], "interval": req.interval,
        "days": plan["days"], "amount": plan["amount"], "currency": "usd",
        "status": "pending", "created_at": now_iso(), "label": plan["label"],
    })
    return {"url": session.url, "session_id": session.session_id}


async def _apply_payment_success(session_id: str) -> dict:
    payment = await db.payments.find_one({"session_id": session_id}, {"_id": 0})
    if not payment:
        return {"applied": False}
    if payment.get("status") == "paid":
        return {"applied": False, "duplicate": True}
    user = await db.users.find_one({"id": payment["user_id"]}, {"_id": 0})
    if not user:
        return {"applied": False}
    now = _utcnow()
    current_exp = _parse_dt(user.get("tier_expires_at"))
    current_tier = _user_tier(user)
    base = current_exp if (current_exp and current_exp > now and current_tier == payment["tier"]) else now
    new_exp = base + timedelta(days=int(payment["days"]))
    await db.users.update_one({"id": user["id"]}, {"$set": {
        "tier": payment["tier"],
        "tier_expires_at": new_exp.isoformat(),
        "tier_updated_at": now.isoformat(),
        "last_payment_session": session_id,
    }})
    await db.payments.update_one({"session_id": session_id},
                                  {"$set": {"status": "paid", "paid_at": now.isoformat()}})
    logger.info(f"Billing: user={user['id']} upgraded to {payment['tier']} until {new_exp.isoformat()}")
    return {"applied": True, "tier": payment["tier"], "expires_at": new_exp.isoformat()}


@api_router.get("/billing/status/{session_id}")
async def billing_status(session_id: str, user=Depends(get_current_user)):
    payment = await db.payments.find_one({"session_id": session_id}, {"_id": 0})
    if not payment or payment.get("user_id") != user["id"]:
        raise HTTPException(404, "Session not found.")
    if payment.get("status") == "paid":
        return {"status": "paid", "tier": payment["tier"]}
    try:
        sc = _stripe_client()
        s = await sc.get_checkout_status(session_id)
        if s.payment_status == "paid":
            await _apply_payment_success(session_id)
            return {"status": "paid", "tier": payment["tier"]}
        return {"status": s.payment_status or s.status or "pending"}
    except Exception as e:
        logger.warning(f"billing/status reconcile error: {e}")
        return {"status": "pending"}


@api_router.post("/billing/webhook")
async def billing_webhook(request: Request):
    payload = await request.body()
    sig = request.headers.get("stripe-signature")
    try:
        sc = _stripe_client()
        evt = await sc.handle_webhook(payload, signature=sig)
    except Exception as e:
        logger.warning(f"Webhook verify failed: {e}")
        raise HTTPException(400, "Invalid webhook")
    try:
        await db.billing_events.insert_one({"id": evt.event_id, "type": evt.event_type, "at": now_iso()})
    except Exception:
        return {"ok": True, "duplicate": True}
    if evt.event_type in ("checkout.session.completed", "payment_intent.succeeded") and evt.payment_status == "paid" and evt.session_id:
        await _apply_payment_success(evt.session_id)
    return {"ok": True}


# ============================== VOICE / VIDEO CALLS (Daily.co) ==============================

DAILY_API_KEY = os.environ.get("DAILY_API_KEY", "")
DAILY_SUBDOMAIN = os.environ.get("DAILY_SUBDOMAIN", "")
DAILY_API_BASE = "https://api.daily.co/v1"
DAILY_CALL_TTL = 1800  # 30 minutes


async def _daily_request(method: str, path: str, json_body: Optional[dict] = None) -> dict:
    import httpx
    if not DAILY_API_KEY:
        raise HTTPException(503, "Calls are not configured yet.")
    headers = {"Authorization": f"Bearer {DAILY_API_KEY}", "Content-Type": "application/json"}
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.request(method, f"{DAILY_API_BASE}{path}", headers=headers, json=json_body)
    if r.status_code >= 400:
        logger.warning(f"Daily {method} {path} -> {r.status_code} {r.text[:200]}")
        raise HTTPException(502, f"Call provider error: {r.text[:120]}")
    return r.json() if r.text else {}


@api_router.post("/calls/start")
async def calls_start(req: StartCallReq, user=Depends(get_current_user)):
    """Create a Daily room + owner token, save call record, broadcast incoming-call event."""
    chat = await db.chats.find_one({"id": req.chat_id, "member_ids": user["id"]}, {"_id": 0})
    if not chat:
        raise HTTPException(404, "Chat not found")
    now = _utcnow()
    exp_unix = int((now + timedelta(seconds=DAILY_CALL_TTL)).timestamp())
    room_name = f"chat-{req.chat_id[:8]}-{uuid.uuid4().hex[:8]}"
    # Create the room
    await _daily_request("POST", "/rooms", {
        "name": room_name,
        "privacy": "private",
        "properties": {
            "exp": exp_unix,
            "eject_at_room_exp": True,
            "max_participants": 2,
            "start_video_off": req.call_type == "audio",
            "start_audio_off": False,
        },
    })
    # Owner token for the caller
    owner = await _daily_request("POST", "/meeting-tokens", {
        "properties": {"room_name": room_name, "exp": exp_unix, "is_owner": True,
                       "user_name": user.get("name") or "Caller", "user_id": user["id"]},
    })
    room_url = f"https://{DAILY_SUBDOMAIN}.daily.co/{room_name}"
    await db.calls.insert_one({
        "id": str(uuid.uuid4()), "chat_id": req.chat_id, "room_name": room_name, "room_url": room_url,
        "owner_user_id": user["id"], "call_type": req.call_type,
        "created_at": now_iso(), "expires_at": (now + timedelta(seconds=DAILY_CALL_TTL)).isoformat(),
        "ended_at": None,
    })
    # Ring the other participants via the existing WebSocket
    callee_ids = [m for m in (chat.get("member_ids") or []) if m != user["id"] and m != "ai-assistant-wave"]
    payload = {
        "type": "incoming_call", "chat_id": req.chat_id, "room_url": room_url,
        "call_type": req.call_type, "from_user_id": user["id"],
        "from_name": user.get("name") or user.get("phone") or "Someone",
        "from_avatar": user.get("avatar"),
    }
    for cid in callee_ids:
        try:
            await ws_manager.broadcast_to_users([cid], payload)
        except Exception:
            pass
    return {"room_url": room_url, "owner_token": owner["token"], "expires_at": payload.get("expires_at")}


@api_router.post("/calls/join")
async def calls_join(req: JoinCallReq, user=Depends(get_current_user)):
    room_name = req.room_url.rstrip("/").split("/")[-1]
    doc = await db.calls.find_one({"room_name": room_name}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Call not found")
    chat = await db.chats.find_one({"id": doc["chat_id"], "member_ids": user["id"]}, {"_id": 0})
    if not chat:
        raise HTTPException(403, "Not a member of this chat")
    exp = _parse_dt(doc.get("expires_at"))
    if exp and exp < _utcnow():
        raise HTTPException(410, "Call expired")
    token = await _daily_request("POST", "/meeting-tokens", {
        "properties": {"room_name": room_name, "exp": int(exp.timestamp()) if exp else None,
                       "is_owner": False, "user_name": user.get("name") or "Guest", "user_id": user["id"]},
    })
    return {"room_url": doc["room_url"], "participant_token": token["token"]}


@api_router.post("/calls/end")
async def calls_end(req: JoinCallReq, user=Depends(get_current_user)):
    room_name = req.room_url.rstrip("/").split("/")[-1]
    doc = await db.calls.find_one({"room_name": room_name}, {"_id": 0})
    if not doc:
        return {"ok": True}
    if doc["owner_user_id"] != user["id"]:
        # Non-owners can leave but not delete the room
        return {"ok": True, "owner_only": True}
    try:
        await _daily_request("DELETE", f"/rooms/{room_name}")
    except Exception:
        pass
    await db.calls.update_one({"room_name": room_name}, {"$set": {"ended_at": now_iso()}})
    return {"ok": True, "deleted": True}


class ClaimHandleReq(BaseModel):
    handle: str
    domain: Optional[str] = None  # if set, primary address = {handle}@{domain}; fallback @w.xyz auto-created


@api_router.post("/mail/claim-handle")
async def claim_handle(req: ClaimHandleReq, user=Depends(get_current_user)):
    raw_handle = (req.handle or "").strip().lower()
    target_domain = (req.domain or "").strip().lower() or MAIL_DOMAIN
    target_domain = re.sub(r"^https?://", "", target_domain).split("/")[0]
    using_wxyz = target_domain == MAIL_DOMAIN

    if using_wxyz:
        h = _validate_handle(raw_handle)  # enforces 4+ length, reserved, premium gating
    else:
        # Custom domain — user owns it. Only enforce basic format (1-26 chars, letters/numbers/dashes).
        if not raw_handle or len(raw_handle) > 26:
            raise HTTPException(400, "Handle must be 1–26 characters.")
        if not re.match(r"^[a-z0-9]([a-z0-9-]{0,24}[a-z0-9])?$", raw_handle):
            raise HTTPException(400, "Letters, numbers and dashes only. Can't start or end with a dash.")
        h = raw_handle

    exists = await db.users.find_one({"email_handle": h, "id": {"$ne": user["id"]}}, {"_id": 0, "id": 1})
    if exists and using_wxyz:
        raise HTTPException(409, "Handle already taken.")

    update: dict = {"email_handle": h}
    if not using_wxyz:
        domain = target_domain
        if False:  # noqa — never reached, target_domain already filtered out @w.xyz above
            update["email_address"] = f"{h}@{MAIL_DOMAIN}"
            update["custom_domain"] = None
            update["domain_verified"] = True
            update["fallback_address"] = None
        else:
            if not _is_valid_domain(domain):
                raise HTTPException(400, "That doesn't look like a valid domain.")
            # Make sure two users don't claim the same domain
            taken = await db.users.find_one({"custom_domain": domain, "id": {"$ne": user["id"]}}, {"_id": 0, "id": 1})
            if taken:
                raise HTTPException(409, "This domain is already in use by another W account.")
            fallback = f"{h}-{_slugify_domain(domain)}@{MAIL_DOMAIN}"
            update.update({
                "email_address": f"{h}@{domain}",
                "custom_domain": domain,
                "domain_verified": False,
                "domain_added_at": now_iso(),
                "fallback_address": fallback,
            })
    else:
        update["email_address"] = f"{h}@{MAIL_DOMAIN}"
        update["custom_domain"] = None
        update["domain_verified"] = True
        update["fallback_address"] = None
    await db.users.update_one({"id": user["id"]}, {"$set": update})
    fresh = await db.users.find_one({"id": user["id"]}, {"_id": 0, "password_hash": 0})
    return fresh


@api_router.get("/domain/dns-records")
async def domain_dns_records(user=Depends(get_current_user)):
    """Returns the DNS records the user must add at their registrar to activate
    their custom domain. These are static instructions — same for everyone."""
    domain = user.get("custom_domain")
    if not domain:
        raise HTTPException(400, "No custom domain configured for this account.")
    return {
        "domain": domain,
        "fallback_address": user.get("fallback_address"),
        "verified": bool(user.get("domain_verified")),
        "records": [
            {"type": "MX", "host": "@", "value": "mx.sendgrid.net", "priority": 10,
             "purpose": "Route incoming email through W"},
            {"type": "TXT", "host": "@", "value": "v=spf1 include:sendgrid.net ~all",
             "purpose": "SPF — authorize W/SendGrid to send mail from your domain"},
            {"type": "CNAME", "host": "em-w", "value": f"u00000.wl.sendgrid.net",
             "purpose": "Domain authentication (CNAME) — required for DKIM signing"},
            {"type": "TXT", "host": "_dmarc", "value": "v=DMARC1; p=none; rua=mailto:dmarc@w.xyz",
             "purpose": "DMARC policy (optional but recommended)"},
        ],
        "instructions": (
            "Log into your domain registrar (GoDaddy, Cloudflare, Namecheap, Squarespace, etc.), "
            "open the DNS management page for your domain, and add the records above. "
            "Most registrars apply changes within a few minutes; some take up to 48 hours. "
            "Tap 'Verify' below once they're added."
        ),
    }


@api_router.post("/domain/verify")
async def domain_verify(user=Depends(get_current_user)):
    """Resolves the user's custom domain MX records and marks verified if SendGrid is found."""
    domain = user.get("custom_domain")
    if not domain:
        raise HTTPException(400, "No custom domain configured.")
    try:
        import socket
        # Use dnspython if available; otherwise fall back to a basic socket lookup
        try:
            import dns.resolver  # type: ignore
            answers = dns.resolver.resolve(domain, "MX", lifetime=5)
            hosts = [str(rd.exchange).lower().rstrip(".") for rd in answers]
        except Exception:
            # Coarser fallback — just confirm the domain resolves; can't verify MX
            socket.gethostbyname(domain)
            hosts = []
        verified = any("sendgrid" in h for h in hosts)
        await db.users.update_one(
            {"id": user["id"]},
            {"$set": {"domain_verified": verified,
                      "domain_verified_at": now_iso() if verified else None,
                      "domain_last_check_at": now_iso(),
                      "domain_mx_seen": hosts}},
        )
        return {"verified": verified, "mx_records": hosts,
                "message": "Verified! Custom domain is active." if verified
                           else "MX records aren't pointing to W yet. Give DNS a few more minutes and try again."}
    except Exception as e:
        logger.warning(f"Domain verify failed for {domain}: {e}")
        return {"verified": False, "mx_records": [], "message": "Couldn't resolve domain. Double-check spelling and DNS settings."}


@api_router.get("/mail/inbox")
async def mail_inbox(user=Depends(get_current_user)):
    addr = (user.get("email_address") or "").lower()
    fb = (user.get("fallback_address") or "").lower()
    addrs = [a for a in [addr, fb] if a]
    if not addrs:
        return []
    msgs = await db.emails.find({"to_addrs": {"$in": addrs}, "folder": "inbox"}, {"_id": 0}).sort("created_at", -1).to_list(500)
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

    # Storage quota check for attachments
    total_att_bytes = sum(_approx_b64_bytes((a or {}).get("content_b64")) for a in (req.attachments or []))
    if total_att_bytes > 0:
        await _check_and_bump_storage(user, total_att_bytes)

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
        "from_tier": _user_tier(user),
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
            from sendgrid.helpers.mail import Mail, Email, To, ReplyTo, Content, Attachment, FileContent, FileName, FileType, Disposition, Header
            # Build BOTH plain-text and HTML versions with matching footers so
            # the MIME parts are balanced (avoids MIME_HTML_MOSTLY).
            plain_body = _text_to_plain(body_out or " ", from_addr)
            html_body = _text_to_html(body_out or " ", user.get("name") or from_addr)
            msg = Mail(
                from_email=Email(from_addr, user.get("name") or from_addr),
                subject=req.subject or "(no subject)",
                plain_text_content=Content("text/plain", plain_body),
                html_content=Content("text/html", html_body),
            )
            # Reply-To so replies route back to the same @w.xyz address (small reputation win).
            msg.reply_to = ReplyTo(from_addr, user.get("name") or from_addr)
            # List-Unsubscribe header (RFC 8058) — strong signal of legitimate mail
            unsubscribe_url = f"mailto:unsubscribe@{MAIL_DOMAIN}?subject=unsubscribe"
            msg.add_header(Header("List-Unsubscribe", f"<{unsubscribe_url}>"))
            msg.add_header(Header("List-Unsubscribe-Post", "List-Unsubscribe=One-Click"))
            msg.add_header(Header("X-Mailer", "W Mail/1.0"))
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
    # If the sender is a @w.xyz user, attach their tier so the inbox can show a blue check
    sender_tier = "free"
    if sender and sender.endswith(f"@{MAIL_DOMAIN}"):
        sender_user = await db.users.find_one({"email_address": sender}, {"_id": 0})
        if sender_user:
            sender_tier = _user_tier(sender_user)

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
            "from_tier": sender_tier,
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


def _text_to_plain(text: str, from_addr: str = "") -> str:
    """Plain-text version with footer that mirrors the HTML one.
    Bulks up the text/plain MIME part so it isn't dwarfed by the HTML part
    (avoids SpamAssassin's MIME_HTML_MOSTLY rule).
    """
    body = (text or "").rstrip()
    footer = (
        "\n\n"
        "—\n"
        "Sent via W — your AI-native messaging & mail (https://w.xyz).\n"
        f"Reply to this message or write {from_addr or 'us'} directly.\n"
        f"To unsubscribe, email unsubscribe@{MAIL_DOMAIN} or reply with the word 'unsubscribe'."
    )
    return body + footer


def _text_to_html(text: str, sender_name: str = "") -> str:
    """Convert plain text to a clean HTML email with proper structure.
    Helps deliverability (real mail is multipart) and looks better in client.
    Kept lean to maintain a healthy text-to-HTML ratio.
    """
    import html as _html
    escaped = _html.escape(text or "")
    # Convert URLs to clickable links
    escaped = re.sub(
        r"(https?://[^\s<>\"]+)",
        r'<a href="\1" style="color:#0A7A90">\1</a>',
        escaped,
    )
    escaped = escaped.replace("\n", "<br>")
    return (
        '<!DOCTYPE html><html><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width,initial-scale=1">'
        '<title>Message</title></head>'
        '<body style="margin:0;padding:24px;background:#f0f4f8;'
        'font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#06152B;font-size:15px;line-height:1.55">'
        '<div style="max-width:600px;margin:0 auto;background:#fff;padding:28px;border-radius:10px">'
        f'{escaped}'
        '<p style="margin-top:28px;padding-top:14px;border-top:1px solid #E2E8F0;'
        'font-size:12px;color:#5B7083">'
        'Sent via <a href="https://w.xyz" style="color:#0A7A90">W</a> — '
        'your AI-native messaging &amp; mail. '
        f'To unsubscribe, email <a href="mailto:unsubscribe@{MAIL_DOMAIN}" style="color:#0A7A90">'
        f'unsubscribe@{MAIL_DOMAIN}</a> or reply with the word "unsubscribe".'
        '</p></div></body></html>'
    )


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
