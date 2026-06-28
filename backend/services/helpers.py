"""Shared helpers: handle validation, tiers, storage, HTML utilities."""
import re
from typing import Optional

from fastapi import HTTPException

from core.config import (
    HANDLE_HARD_MIN, HANDLE_MAX, MAIL_DOMAIN,
    RESERVED_HANDLES, PROFANITY_FRAGMENTS, TIER_STORAGE_GB, MVP_STORAGE_BYTES,
)
from core.db import db
from core.security import _parse_dt, _utcnow


# -------------------- Domain helpers --------------------
def _slugify_domain(d: str) -> str:
    return re.sub(r'[^a-z0-9-]+', '-', (d or '').strip().lower()).strip('-')


def _is_valid_domain(d: str) -> bool:
    if not d:
        return False
    d = re.sub(r'^https?://', '', (d or '').strip().lower()).split('/')[0]
    if len(d) > 253 or '.' not in d or d.endswith('.'):
        return False
    return bool(re.match(r'^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$', d))


def _is_reserved_or_profane(h: str) -> bool:
    if h in RESERVED_HANDLES:
        return True
    flat = h.replace('-', '')
    for frag in PROFANITY_FRAGMENTS:
        if frag in flat:
            return True
    return False


# -------------------- Tier helpers --------------------
def _handle_tier(h: str) -> str:
    """Return 'free' | 'plus' | 'pro' | 'unavailable' based on length."""
    n = len(h)
    if n < HANDLE_HARD_MIN:
        return 'unavailable'
    if n == 4:
        return 'pro'
    if n == 5:
        return 'plus'
    return 'free'


def _user_tier(user: dict) -> str:
    """Return active tier for a user — expiry-aware."""
    t = (user or {}).get('tier', 'free')
    if t == 'free':
        return 'free'
    exp = _parse_dt((user or {}).get('tier_expires_at'))
    if exp and exp <= _utcnow():
        return 'free'
    return t


def _tier_meets(required: str, current: str) -> bool:
    rank = {'free': 0, 'plus': 1, 'pro': 2}
    return rank.get(current, 0) >= rank.get(required, 0)


def _validate_handle(h: str, allow_premium: bool = False) -> str:
    h = (h or '').strip().lower()
    if not h or len(h) > HANDLE_MAX:
        raise HTTPException(400, f'Handle must be {HANDLE_HARD_MIN}–{HANDLE_MAX} characters.')
    if not re.match(r'^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$', h):
        raise HTTPException(400, "Letters, numbers and dashes only. Can't start or end with a dash.")
    tier = _handle_tier(h)
    if tier == 'unavailable':
        raise HTTPException(400, f"Handles under {HANDLE_HARD_MIN} characters aren't available.")
    if tier == 'premium' and not allow_premium:
        raise HTTPException(402, 'This handle requires a premium subscription.')
    if _is_reserved_or_profane(h):
        raise HTTPException(403, f"That handle isn't available. Email support@{MAIL_DOMAIN} to request it.")
    return h


# -------------------- Storage --------------------
def _storage_limit_bytes(user: dict) -> int:
    # MVP-wide flat cap; restore per-tier limits once paid plans launch.
    return MVP_STORAGE_BYTES


def _storage_limit_bytes_by_tier(user: dict) -> int:
    """Per-tier storage limit (used only when paid plans are live)."""
    return TIER_STORAGE_GB.get(_user_tier(user), 1) * 1024 * 1024 * 1024


def _approx_b64_bytes(b64: Optional[str]) -> int:
    if not b64:
        return 0
    s = b64.split(',', 1)[-1] if b64.startswith('data:') else b64
    return int(len(s) * 3 / 4)


async def _check_and_bump_storage(user: dict, added_bytes: int) -> None:
    if added_bytes <= 0:
        return
    limit = _storage_limit_bytes(user)
    used = int(user.get('storage_used_bytes', 0) or 0)
    if used + added_bytes > limit:
        used_mb = used / (1024 * 1024)
        limit_mb = limit / (1024 * 1024)
        raise HTTPException(
            413,
            f"Storage full — {used_mb:.1f} MB of {limit_mb:.0f} MB used. Star important emails and close threads to free space.",
        )
    await db.users.update_one({'id': user['id']}, {'$inc': {'storage_used_bytes': added_bytes}})


# -------------------- Chat serialization --------------------
async def _serialize_chat(chat: dict, user_id: str) -> dict:
    chat.pop('_id', None)
    last = await db.messages.find_one({'chat_id': chat['id']}, {'_id': 0}, sort=[('created_at', -1)])
    chat['last_message'] = last
    chat['unread'] = await db.messages.count_documents({
        'chat_id': chat['id'],
        'sender_id': {'$ne': user_id},
        'read_by': {'$ne': user_id},
    })
    other_ids = [m for m in chat['member_ids'] if m != user_id]
    others = await db.users.find({'id': {'$in': other_ids}}, {'_id': 0}).to_list(50)
    chat['members'] = others
    if not chat.get('is_group') and others:
        chat['display_name'] = others[0].get('name') or others[0].get('phone')
        chat['display_avatar'] = others[0].get('avatar')
        chat['display_tier'] = _user_tier(others[0])
    else:
        chat['display_name'] = chat.get('name', 'Group')
        chat['display_avatar'] = chat.get('avatar')
        chat['display_tier'] = 'free'
    return chat


# -------------------- HTML helpers (mail) --------------------
def _strip_html(s: str) -> str:
    return re.sub(r'<[^>]+>', '', s or '').strip()


def _text_to_plain(text: str, from_addr: str = '') -> str:
    body = (text or '').rstrip()
    footer = (
        '\n\n'
        '—\n'
        'Sent via W — your AI-native messaging & mail (https://w.xyz).'
    )
    return body + footer


def _text_to_html(text: str, sender_name: str = '') -> str:
    import html as _html
    escaped = _html.escape(text or '')
    escaped = re.sub(
        r'(https?://[^\s<>"]+)',
        r'<a href="\1" style="color:#0A7A90">\1</a>',
        escaped,
    )
    escaped = escaped.replace('\n', '<br>')
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
        'your AI-native messaging &amp; mail.'
        '</p></div></body></html>'
    )


def _sanitize_html(s: str) -> str:
    if not s:
        return ''
    out = s
    out = re.sub(r'<\s*(script|style|iframe|object|embed|link|meta)[^>]*>.*?<\s*/\s*\1\s*>', '', out, flags=re.I | re.S)
    out = re.sub(r'<\s*(script|style|iframe|object|embed|link|meta)[^>]*/?\s*>', '', out, flags=re.I)
    out = re.sub(r'\s+on\w+\s*=\s*"[^"]*"', '', out, flags=re.I)
    out = re.sub(r"\s+on\w+\s*=\s*'[^']*'", '', out, flags=re.I)
    out = re.sub(r'\s+on\w+\s*=\s*[^\s>]+', '', out, flags=re.I)
    out = re.sub(r'(href|src)\s*=\s*"\s*javascript:[^"]*"', r'\1="#"', out, flags=re.I)
    out = re.sub(r"(href|src)\s*=\s*'\s*javascript:[^']*'", r"\1='#'", out, flags=re.I)
    return out
