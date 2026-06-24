"""Auth primitives: bcrypt, JWT, OTP, get_current_user dep."""
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, Optional
import random
import re

import bcrypt as _bcrypt
import jwt as pyjwt
from fastapi import Header, HTTPException

from core.config import (
    JWT_SECRET, MIN_PASSWORD_LEN, MAX_BCRYPT_BYTES,
    TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER,
)
from core.db import db, logger

# Dummy hash for constant-time login when email doesn't exist.
_DUMMY_HASH = _bcrypt.hashpw(b'dummypasswordxx', _bcrypt.gensalt(rounds=10)).decode()


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _parse_dt(v):
    """Mongo may return either a real datetime or an ISO string — normalize."""
    if v is None:
        return None
    if isinstance(v, datetime):
        return v if v.tzinfo else v.replace(tzinfo=timezone.utc)
    try:
        return datetime.fromisoformat(str(v).replace('Z', '+00:00'))
    except Exception:
        return None


def make_token(user_id: str) -> str:
    payload = {'user_id': user_id, 'exp': datetime.now(timezone.utc) + timedelta(days=30)}
    return pyjwt.encode(payload, JWT_SECRET, algorithm='HS256')


def decode_token(token: str) -> dict:
    return pyjwt.decode(token, JWT_SECRET, algorithms=['HS256'])


def validate_password(password: str) -> None:
    if not isinstance(password, str) or len(password) < MIN_PASSWORD_LEN:
        raise HTTPException(400, 'Password must be at least 8 characters')
    if len(password.encode('utf-8')) > MAX_BCRYPT_BYTES:
        raise HTTPException(400, 'Password is too long (max 72 bytes)')
    if not re.search(r'[0-9\W_]', password):
        raise HTTPException(400, 'Password must include a number or symbol')


def hash_password(password: str) -> str:
    validate_password(password)
    return _bcrypt.hashpw(password.encode('utf-8'), _bcrypt.gensalt(rounds=12)).decode('utf-8')


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return _bcrypt.checkpw(plain.encode('utf-8'), hashed.encode('utf-8'))
    except Exception:
        return False


async def get_current_user(authorization: Optional[str] = Header(None)) -> Dict[str, Any]:
    if not authorization or not authorization.startswith('Bearer '):
        raise HTTPException(401, 'Missing token')
    token = authorization.split(' ', 1)[1]
    try:
        payload = decode_token(token)
    except Exception:
        raise HTTPException(401, 'Invalid token')
    user = await db.users.find_one({'id': payload['user_id']}, {'_id': 0})
    if not user:
        raise HTTPException(401, 'User not found')
    return user


def _mask_phone(phone: str) -> str:
    """Return e.g. '+1 ••• ••• 1234'."""
    if not phone:
        return ''
    digits = re.sub(r'\D', '', phone)
    if len(digits) < 4:
        return phone
    last = digits[-4:]
    return f"{phone[:phone.index(digits[0])]}••• ••• {last}"


async def _send_2fa_otp(user: dict, purpose: str = 'login') -> Optional[str]:
    """Send a 2FA OTP to the user's phone. Returns dev_otp when Twilio is unavailable."""
    if not user.get('phone'):
        return None
    otp = f"{random.randint(0, 999999):06d}"
    await db.otps.update_one(
        {'phone': user['phone']},
        {'$set': {'phone': user['phone'], 'otp': otp, 'created_at': now_iso(), 'purpose': purpose}},
        upsert=True,
    )
    if TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN and TWILIO_PHONE_NUMBER:
        try:
            from twilio.rest import Client as _Twilio
            _Twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN).messages.create(
                to=user['phone'], from_=TWILIO_PHONE_NUMBER,
                body=f"Your W verification code is {otp}. Valid for 10 minutes.",
            )
            return None
        except Exception as e:
            logger.warning(f'Twilio 2FA SMS failed: {e}')
            return otp
    return otp
