"""Authentication, profile, and user-listing endpoints."""
import random
import re
from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException

from core.config import (
    FAILED_LOGIN_LIMIT, FAILED_LOGIN_WINDOW_MINUTES, LOCK_MINUTES,
    GENERIC_AUTH_ERROR, TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER,
)
from core.db import db, logger
from core.security import (
    _DUMMY_HASH, _mask_phone, _parse_dt, _send_2fa_otp, _utcnow,
    get_current_user, hash_password, make_token, now_iso, verify_password,
)
from models.schemas import (
    AutoReplyReq, ForgotPasswordReq, GhostMailReq, LoginReq, NotifSettingsReq, ProfileReq,
    RecoveryEmailReq, RecoveryEmailVerifyReq, ResetPasswordReq,
    SendOtpReq, SetPasswordReq, SignatureReq, TwoFactorToggleReq, VerifyOtpReq,
)
from services.sendgrid_mail import send_system_email
from services.helpers import _user_tier

import uuid

router = APIRouter()


@router.post('/auth/send-otp')
async def send_otp(req: SendOtpReq):
    otp = f"{random.randint(0, 999999):06d}"
    await db.otps.update_one(
        {'phone': req.phone},
        {'$set': {'phone': req.phone, 'otp': otp, 'created_at': now_iso()}},
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
            logger.info(f'[TWILIO] OTP sent to {req.phone}')
            return {'success': True, 'message': 'OTP sent via SMS'}
        except TwilioRestException as e:
            logger.exception(f'Twilio send failed: {e}')
            if e.code == 21608 or 'unverified' in str(e).lower():
                return {
                    'success': True,
                    'dev_otp': otp,
                    'message': 'Twilio trial: number not verified. Showing dev OTP. Verify the number in Twilio Console or upgrade.',
                }
            raise HTTPException(400, f'SMS failed: {e.msg or str(e)}')
        except Exception as e:
            logger.exception(f'Twilio error: {e}')
            raise HTTPException(500, 'Failed to send SMS')
    logger.info(f'[DEV OTP] {req.phone} -> {otp}')
    return {'success': True, 'dev_otp': otp, 'message': 'OTP sent (dev mode)'}


@router.post('/auth/verify-otp')
async def verify_otp(req: VerifyOtpReq):
    rec = await db.otps.find_one({'phone': req.phone}, {'_id': 0})
    if not rec or rec.get('otp') != req.otp:
        raise HTTPException(400, 'Invalid OTP')
    user = await db.users.find_one({'phone': req.phone}, {'_id': 0})
    is_new = False
    reactivated = False
    if not user:
        is_new = True
        user = {
            'id': str(uuid.uuid4()),
            'phone': req.phone,
            'name': '',
            'avatar': None,
            'about': "Hey there! I'm using Wave.",
            'created_at': now_iso(),
            'last_seen': now_iso(),
        }
        await db.users.insert_one(user)
        user.pop('_id', None)
    elif user.get('deactivated'):
        await db.users.update_one(
            {'id': user['id']},
            {'$set': {'deactivated': False, 'reactivated_at': now_iso()},
             '$unset': {'deactivated_at': ''}},
        )
        user['deactivated'] = False
        reactivated = True
    await db.otps.delete_one({'phone': req.phone})
    if req.password:
        pw_hash = hash_password(req.password)
        await db.users.update_one(
            {'id': user['id']},
            {'$set': {'password_hash': pw_hash, 'failed_logins': 0},
             '$unset': {'failed_login_window_started_at': '', 'lock_until': ''}},
        )
        user['password_hash'] = pw_hash
    token = make_token(user['id'])
    user.pop('password_hash', None)
    return {'token': token, 'user': user, 'is_new': is_new, 'reactivated': reactivated}


@router.post('/auth/login')
async def login(req: LoginReq):
    email = (req.email or '').strip().lower()
    if not email or '@' not in email:
        verify_password(req.password or '', _DUMMY_HASH)
        raise HTTPException(401, GENERIC_AUTH_ERROR)
    user = await db.users.find_one({'email_address': email}, {'_id': 0})
    if not user:
        verify_password(req.password or '', _DUMMY_HASH)
        raise HTTPException(401, GENERIC_AUTH_ERROR)
    if user.get('deactivated'):
        raise HTTPException(401, GENERIC_AUTH_ERROR)
    lock_until = _parse_dt(user.get('lock_until'))
    if lock_until and lock_until > _utcnow():
        raise HTTPException(429, 'Account temporarily locked. Try again in a few minutes.')
    pw_hash = user.get('password_hash')
    if not pw_hash:
        verify_password(req.password or '', _DUMMY_HASH)
        raise HTTPException(401, GENERIC_AUTH_ERROR)
    if not verify_password(req.password, pw_hash):
        now = _utcnow()
        window_start = _parse_dt(user.get('failed_login_window_started_at'))
        failed = int(user.get('failed_logins', 0))
        if not window_start or (now - window_start).total_seconds() > FAILED_LOGIN_WINDOW_MINUTES * 60:
            failed = 1
            window_start = now
        else:
            failed += 1
        update = {'failed_logins': failed, 'failed_login_window_started_at': window_start.isoformat()}
        if failed >= FAILED_LOGIN_LIMIT:
            update['lock_until'] = (now + timedelta(minutes=LOCK_MINUTES)).isoformat()
        await db.users.update_one({'id': user['id']}, {'$set': update})
        raise HTTPException(401, GENERIC_AUTH_ERROR)

    if user.get('two_factor_enabled'):
        if not req.otp:
            dev_otp = await _send_2fa_otp(user, purpose='login')
            resp = {'requires_2fa': True, 'phone_masked': _mask_phone(user.get('phone', ''))}
            if dev_otp:
                resp['dev_otp'] = dev_otp
            return resp
        rec = await db.otps.find_one({'phone': user['phone']}, {'_id': 0})
        if not rec or rec.get('otp') != req.otp:
            raise HTTPException(401, 'Invalid verification code')
        await db.otps.delete_one({'phone': user['phone']})

    await db.users.update_one(
        {'id': user['id']},
        {'$set': {'failed_logins': 0, 'last_login_at': now_iso()},
         '$unset': {'failed_login_window_started_at': '', 'lock_until': ''}},
    )
    user.pop('password_hash', None)
    token = make_token(user['id'])
    return {'token': token, 'user': user, 'is_new': False, 'reactivated': False}


@router.post('/auth/2fa')
async def toggle_2fa(req: TwoFactorToggleReq, user=Depends(get_current_user)):
    pw_hash = user.get('password_hash')
    if not pw_hash or not verify_password(req.password, pw_hash):
        raise HTTPException(401, 'Password is incorrect')
    if not user.get('phone'):
        raise HTTPException(400, 'Add a phone number before enabling 2-step verification.')

    if req.enable:
        await db.users.update_one({'id': user['id']}, {'$set': {'two_factor_enabled': True, 'two_factor_enabled_at': now_iso()}})
        return {'two_factor_enabled': True}

    if not req.otp:
        dev_otp = await _send_2fa_otp(user, purpose='disable_2fa')
        resp = {'requires_otp': True, 'phone_masked': _mask_phone(user['phone'])}
        if dev_otp:
            resp['dev_otp'] = dev_otp
        return resp
    rec = await db.otps.find_one({'phone': user['phone']}, {'_id': 0})
    if not rec or rec.get('otp') != req.otp:
        raise HTTPException(401, 'Invalid verification code')
    await db.otps.delete_one({'phone': user['phone']})
    await db.users.update_one(
        {'id': user['id']},
        {'$set': {'two_factor_enabled': False},
         '$unset': {'two_factor_enabled_at': ''}},
    )
    return {'two_factor_enabled': False}


@router.post('/auth/set-password')
async def set_password(req: SetPasswordReq, user=Depends(get_current_user)):
    existing = user.get('password_hash')
    if existing:
        if not req.current_password or not verify_password(req.current_password, existing):
            raise HTTPException(401, 'Current password is incorrect')
    new_hash = hash_password(req.password)
    await db.users.update_one(
        {'id': user['id']},
        {'$set': {'password_hash': new_hash, 'failed_logins': 0, 'password_updated_at': now_iso()},
         '$unset': {'failed_login_window_started_at': '', 'lock_until': ''}},
    )
    return {'success': True}


@router.post('/auth/forgot-password')
async def forgot_password(req: ForgotPasswordReq):
    email = (req.email or '').strip().lower()
    if not email or '@' not in email:
        return {'success': True}
    user = await db.users.find_one({'email_address': email}, {'_id': 0})
    if not user:
        return {'success': True}
    try:
        otp = f"{random.randint(0, 999999):06d}"
        now = _utcnow()
        await db.users.update_one(
            {'id': user['id']},
            {'$set': {'password_reset_otp': otp, 'password_reset_otp_at': now.isoformat()}},
        )

        recovery_email = user.get('recovery_email') if user.get('recovery_email_verified') else None
        sent_via = None

        if recovery_email:
            text_body = (
                f"Hi {user.get('name') or 'there'},\n\n"
                f"Use this code to reset the password for your W account ({email}):\n\n"
                f"    {otp}\n\n"
                f"It expires in 15 minutes. If you didn't request this, ignore this message and change your W password.\n\n"
                f"\u2014 The W team"
            )
            html_body = (
                f"<p>Hi {user.get('name') or 'there'},</p>"
                f"<p>Use this code to reset the password for your W account <b>{email}</b>:</p>"
                f"<p style='font-size:28px;letter-spacing:6px;font-weight:800;color:#0A7A90;'>{otp}</p>"
                f"<p>It expires in 15 minutes. If you didn't request this, ignore this message.</p>"
            )
            ok = send_system_email(
                to_email=recovery_email,
                subject='Reset your W password',
                text_body=text_body,
                html_body=html_body,
                from_name='W Security',
            )
            if ok:
                sent_via = 'recovery_email'
                return {'success': True, 'sent_via': 'recovery_email',
                        'recovery_email_hint': _mask_email(recovery_email)}

        if user.get('phone') and TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN and TWILIO_PHONE_NUMBER:
            # Also write phone-keyed OTP for backwards compatibility
            await db.otps.update_one(
                {'phone': user['phone']},
                {'$set': {'phone': user['phone'], 'otp': otp, 'created_at': now.isoformat(),
                          'purpose': 'password_reset'}},
                upsert=True,
            )
            try:
                from twilio.rest import Client as _Twilio
                _Twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN).messages.create(
                    to=user['phone'], from_=TWILIO_PHONE_NUMBER,
                    body=f"Your W password reset code is {otp}. Valid for 15 minutes.",
                )
                return {'success': True, 'sent_via': 'sms', 'phone_hint': _mask_phone(user['phone'])}
            except Exception as e:
                logger.warning(f'Twilio reset SMS failed: {e}')

        # Dev / unconfigured fallback
        return {'success': True, 'dev_otp': otp, 'sent_via': sent_via or 'dev'}
    except Exception as e:
        logger.exception(f'forgot-password error: {e}')
    return {'success': True}


def _mask_email(em: str) -> str:
    try:
        local, domain = em.split('@', 1)
    except Exception:
        return em
    if len(local) <= 2:
        masked = local[0] + '*'
    else:
        masked = local[0] + ('*' * (len(local) - 2)) + local[-1]
    return f'{masked}@{domain}'


@router.post('/auth/reset-password')
async def reset_password(req: ResetPasswordReq):
    email = (req.email or '').strip().lower()
    if not email or '@' not in email:
        raise HTTPException(401, GENERIC_AUTH_ERROR)
    user = await db.users.find_one({'email_address': email}, {'_id': 0})
    if not user:
        raise HTTPException(401, GENERIC_AUTH_ERROR)
    submitted = (req.otp or '').strip()
    ok = False

    # 1. Try user-level OTP (recovery email / dev fallback). 15-min validity.
    stored = user.get('password_reset_otp')
    sent_at = _parse_dt(user.get('password_reset_otp_at'))
    if stored and submitted == stored:
        if sent_at and (_utcnow() - sent_at) > timedelta(minutes=15):
            raise HTTPException(401, 'Reset code expired. Request a new one.')
        ok = True

    # 2. Fall back to legacy phone-keyed OTP (SMS).
    if not ok and user.get('phone'):
        rec = await db.otps.find_one({'phone': user['phone']}, {'_id': 0})
        if rec and rec.get('otp') == submitted:
            ok = True

    if not ok:
        raise HTTPException(401, GENERIC_AUTH_ERROR)

    new_hash = hash_password(req.new_password)
    await db.users.update_one(
        {'id': user['id']},
        {'$set': {'password_hash': new_hash, 'failed_logins': 0,
                  'password_updated_at': now_iso(), 'last_login_at': now_iso()},
         '$unset': {'failed_login_window_started_at': '', 'lock_until': '',
                    'deactivated': '', 'deactivated_at': '',
                    'password_reset_otp': '', 'password_reset_otp_at': ''}},
    )
    if user.get('phone'):
        await db.otps.delete_one({'phone': user['phone']})
    refreshed = await db.users.find_one({'id': user['id']}, {'_id': 0, 'password_hash': 0})
    token = make_token(user['id'])
    return {'token': token, 'user': refreshed, 'is_new': False, 'reactivated': False}


@router.post('/auth/profile')
async def update_profile(req: ProfileReq, user=Depends(get_current_user)):
    update = {'name': req.name, 'avatar': req.avatar, 'about': req.about or user.get('about')}
    await db.users.update_one({'id': user['id']}, {'$set': update})
    user.update(update)
    user.pop('password_hash', None)
    return user


@router.get('/auth/me')
async def me(user=Depends(get_current_user)):
    user.pop('password_hash', None)
    return user


@router.post('/auth/deactivate')
async def deactivate_account(user=Depends(get_current_user)):
    await db.users.update_one(
        {'id': user['id']},
        {'$set': {'deactivated': True, 'deactivated_at': now_iso()}},
    )
    logger.info(f"Account deactivated: user_id={user['id']} handle={user.get('email_handle')}")
    return {'deactivated': True}


@router.delete('/auth/me')
async def delete_account(user=Depends(get_current_user)):
    uid = user['id']
    addr = (user.get('email_address') or '').lower()

    chats = await db.chats.find({'member_ids': uid}, {'_id': 0}).to_list(1000)
    chat_ids_to_delete: list[str] = []
    for c in chats:
        members = [m for m in (c.get('member_ids') or []) if m != uid]
        if len(members) <= 1 or not c.get('is_group'):
            chat_ids_to_delete.append(c['id'])
        else:
            await db.chats.update_one({'id': c['id']}, {'$pull': {'member_ids': uid}})

    if chat_ids_to_delete:
        await db.chats.delete_many({'id': {'$in': chat_ids_to_delete}})
        await db.messages.delete_many({'chat_id': {'$in': chat_ids_to_delete}})

    await db.messages.delete_many({'sender_id': uid})

    await db.emails.delete_many({'owner_id': uid})
    if addr:
        await db.emails.delete_many({'to_addrs': addr})

    await db.statuses.delete_many({'user_id': uid})
    if user.get('phone'):
        await db.otps.delete_many({'phone': user['phone']})

    await db.users.delete_one({'id': uid})

    logger.info(f"Account deleted: user_id={uid} handle={user.get('email_handle')} phone={user.get('phone')}")
    return {'deleted': True}


@router.patch('/auth/notification-settings')
async def update_notif_settings(req: NotifSettingsReq, user=Depends(get_current_user)):
    update = {f'notif.{k}': v for k, v in req.dict().items() if v is not None}
    if update:
        await db.users.update_one({'id': user['id']}, {'$set': update})
    fresh = await db.users.find_one({'id': user['id']}, {'_id': 0})
    return fresh.get('notif', {}) if fresh else {}


@router.patch('/auth/signature')
async def update_signature(req: SignatureReq, user=Depends(get_current_user)):
    sig = (req.signature or '')[:1000]
    await db.users.update_one({'id': user['id']}, {'$set': {'signature': sig}})
    return {'signature': sig}


# -------------------- Recovery Email (external, e.g. Gmail) --------------------
EMAIL_RE = re.compile(r'^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$')


@router.post('/auth/recovery-email/set')
async def set_recovery_email(req: RecoveryEmailReq, user=Depends(get_current_user)):
    email = (req.email or '').strip().lower()
    if not EMAIL_RE.match(email):
        raise HTTPException(400, "That doesn't look like a valid email address.")
    if user.get('email_address') and email == user['email_address'].lower():
        raise HTTPException(400, 'Recovery email cannot be the same as your W address.')
    otp = f"{random.randint(0, 999999):06d}"
    now = _utcnow()
    await db.users.update_one(
        {'id': user['id']},
        {'$set': {
            'recovery_email_pending': email,
            'recovery_email_otp': otp,
            'recovery_email_otp_at': now.isoformat(),
        }},
    )
    body_text = (
        f"Hi {user.get('name') or 'there'},\n\n"
        f"Use this code to confirm {email} as the recovery email for your W account:\n\n"
        f"    {otp}\n\n"
        f"It expires in 15 minutes. If you didn't request this, ignore this message.\n\n"
        f"\u2014 The W team"
    )
    body_html = (
        f"<p>Hi {user.get('name') or 'there'},</p>"
        f"<p>Use this code to confirm <b>{email}</b> as the recovery email for your W account:</p>"
        f"<p style='font-size:28px;letter-spacing:6px;font-weight:800;color:#0A7A90;'>{otp}</p>"
        f"<p>It expires in 15 minutes. If you didn't request this, ignore this message.</p>"
        f"<p style='color:#5B7083;font-size:12px;'>\u2014 The W team</p>"
    )
    sent = send_system_email(
        to_email=email,
        subject='Verify your W recovery email',
        text_body=body_text,
        html_body=body_html,
        from_name='W Security',
    )
    resp: dict = {'sent': sent, 'recovery_email_pending': email}
    if not sent:
        resp['dev_otp'] = otp
    return resp


@router.post('/auth/recovery-email/verify')
async def verify_recovery_email(req: RecoveryEmailVerifyReq, user=Depends(get_current_user)):
    pending = user.get('recovery_email_pending')
    stored = user.get('recovery_email_otp')
    sent_at = _parse_dt(user.get('recovery_email_otp_at'))
    if not pending or not stored:
        raise HTTPException(400, 'No recovery email pending. Add one first.')
    if sent_at and (_utcnow() - sent_at) > timedelta(minutes=15):
        raise HTTPException(400, 'Code expired. Send a new one.')
    if (req.otp or '').strip() != stored:
        raise HTTPException(401, 'Incorrect code.')
    await db.users.update_one(
        {'id': user['id']},
        {'$set': {'recovery_email': pending,
                  'recovery_email_verified': True,
                  'recovery_email_verified_at': now_iso()},
         '$unset': {'recovery_email_pending': '', 'recovery_email_otp': '', 'recovery_email_otp_at': ''}},
    )
    return {'recovery_email': pending, 'verified': True}


@router.delete('/auth/recovery-email')
async def remove_recovery_email(user=Depends(get_current_user)):
    await db.users.update_one(
        {'id': user['id']},
        {'$unset': {'recovery_email': '', 'recovery_email_verified': '',
                    'recovery_email_verified_at': '',
                    'recovery_email_pending': '', 'recovery_email_otp': '', 'recovery_email_otp_at': ''}},
    )
    return {'recovery_email': None, 'verified': False}


# -------------------- Auto-reply (Out of Office) --------------------
@router.get('/auth/auto-reply')
async def get_auto_reply(user=Depends(get_current_user)):
    return user.get('auto_reply') or {'enabled': False, 'subject': '', 'body': '', 'start_at': None, 'end_at': None}


@router.patch('/auth/auto-reply')
async def update_auto_reply(req: AutoReplyReq, user=Depends(get_current_user)):
    existing = user.get('auto_reply') or {}
    settings = {
        'enabled': bool(req.enabled),
        'subject': (req.subject if req.subject is not None else existing.get('subject', '')).strip()[:200],
        'body': (req.body if req.body is not None else existing.get('body', '')).strip()[:4000],
        'start_at': req.start_at if req.start_at is not None else existing.get('start_at'),
        'end_at': req.end_at if req.end_at is not None else existing.get('end_at'),
        'ai_enabled': bool(req.ai_enabled) if req.ai_enabled is not None else bool(existing.get('ai_enabled')),
        'updated_at': now_iso(),
    }
    # Pro-gate: ai_enabled requires Plus or Pro
    if settings['ai_enabled'] and _user_tier(user) not in ('plus', 'pro'):
        raise HTTPException(402, 'Smart Auto-Reply (AI) is a Plus or Pro feature. Upgrade to let W AI reply for you.')
    # When AI mode is on, body becomes optional (AI writes from incoming context).
    if settings['enabled'] and not settings['ai_enabled'] and not settings['body']:
        raise HTTPException(400, 'Add a reply message or enable Smart Auto-Reply (AI).')
    if settings['enabled'] and not settings['subject']:
        settings['subject'] = 'Out of office'
    await db.users.update_one({'id': user['id']}, {'$set': {'auto_reply': settings}})
    return settings


# -------------------- Ghost Mail (default ON; premium can disable) --------------------
@router.get('/auth/ghost-mail')
async def get_ghost_mail(user=Depends(get_current_user)):
    enabled = user.get('ghost_mail_enabled', True)
    return {
        'enabled': bool(enabled),
        'can_disable': _user_tier(user) in ('plus', 'pro'),
        'tier': _user_tier(user),
    }


@router.patch('/auth/ghost-mail')
async def update_ghost_mail(req: GhostMailReq, user=Depends(get_current_user)):
    if not req.enabled and _user_tier(user) not in ('plus', 'pro'):
        raise HTTPException(402, 'Disabling Ghost Mail is a Plus / Pro feature. Upgrade to keep all your emails.')
    await db.users.update_one(
        {'id': user['id']},
        {'$set': {'ghost_mail_enabled': bool(req.enabled), 'ghost_mail_updated_at': now_iso()}},
    )
    return {'enabled': bool(req.enabled)}


@router.get('/users')
async def list_users(user=Depends(get_current_user)):
    users = await db.users.find(
        {'id': {'$ne': user['id']}, 'deactivated': {'$ne': True}},
        {'_id': 0},
    ).to_list(500)
    return users
