"""W Mail: handle/domain management, mailbox CRUD, compose, inbound webhook."""
import asyncio
import base64
import inspect
import json
import re
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Request

from core.config import (
    HANDLE_HARD_MIN, HANDLE_MAX, MAIL_DOMAIN, SENDGRID_API_KEY,
)
from core.db import db, logger
from core.security import _utcnow, get_current_user, now_iso
from core.ws import ws_manager
from models.schemas import ClaimHandleReq, ComposeMailReq, DraftReq, SnoozeReq
from services.helpers import (
    _approx_b64_bytes, _check_and_bump_storage, _handle_tier, _is_reserved_or_profane,
    _is_valid_domain, _sanitize_html, _slugify_domain, _strip_html, _strip_trackers,
    _text_to_html, _text_to_plain, _user_tier, _validate_handle,
)
from services.sendgrid_mail import send_system_email
from services.ai_assist import ai_classify_email, ai_compose_reply
from services.crypto import (
    decrypt_mail_list, decrypt_mail_record, encrypt_mail_record,
)

router = APIRouter()


@router.get('/mail/check-handle/{handle}')
async def check_handle(handle: str, authorization: Optional[str] = Header(None)):
    h = (handle or '').strip().lower()
    if not h or len(h) > HANDLE_MAX:
        return {'available': False, 'tier': 'unavailable', 'reason': f'Must be {HANDLE_HARD_MIN}–{HANDLE_MAX} characters.'}
    if not re.match(r'^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$', h):
        return {'available': False, 'tier': 'unavailable', 'reason': 'Letters, numbers and dashes only.'}
    tier = _handle_tier(h)
    if tier == 'unavailable':
        return {'available': False, 'tier': 'unavailable', 'reason': f"Handles under {HANDLE_HARD_MIN} characters aren't available."}
    if _is_reserved_or_profane(h):
        return {
            'available': False,
            'tier': 'reserved',
            'reason': f'Reserved. Email support@{MAIL_DOMAIN} to request it (may require a premium subscription).',
            'support_email': f'support@{MAIL_DOMAIN}',
        }
    exists = await db.users.find_one({'email_handle': h}, {'_id': 0, 'id': 1})
    if exists:
        return {'available': False, 'tier': tier, 'reason': 'Already taken.'}
    return {
        'available': True,
        'tier': tier,
        'handle': h,
        'address': f'{h}@{MAIL_DOMAIN}',
        'requires_premium': tier in ('plus', 'pro'),
    }


@router.post('/mail/claim-handle')
async def claim_handle(req: ClaimHandleReq, user=Depends(get_current_user)):
    raw_handle = (req.handle or '').strip().lower()
    target_domain = (req.domain or '').strip().lower() or MAIL_DOMAIN
    target_domain = re.sub(r'^https?://', '', target_domain).split('/')[0]
    using_wxyz = target_domain == MAIL_DOMAIN

    if using_wxyz:
        h = _validate_handle(raw_handle)
    else:
        if not raw_handle or len(raw_handle) > 26:
            raise HTTPException(400, 'Handle must be 1–26 characters.')
        if not re.match(r'^[a-z0-9]([a-z0-9-]{0,24}[a-z0-9])?$', raw_handle):
            raise HTTPException(400, "Letters, numbers and dashes only. Can't start or end with a dash.")
        h = raw_handle

    exists = await db.users.find_one({'email_handle': h, 'id': {'$ne': user['id']}}, {'_id': 0, 'id': 1})
    if exists and using_wxyz:
        raise HTTPException(409, 'Handle already taken.')

    update: dict = {'email_handle': h}
    if not using_wxyz:
        domain = target_domain
        if not _is_valid_domain(domain):
            raise HTTPException(400, "That doesn't look like a valid domain.")
        taken = await db.users.find_one({'custom_domain': domain, 'id': {'$ne': user['id']}}, {'_id': 0, 'id': 1})
        if taken:
            raise HTTPException(409, 'This domain is already in use by another W account.')
        fallback = f'{h}-{_slugify_domain(domain)}@{MAIL_DOMAIN}'
        update.update({
            'email_address': f'{h}@{domain}',
            'custom_domain': domain,
            'domain_verified': False,
            'domain_added_at': now_iso(),
            'fallback_address': fallback,
        })
    else:
        update['email_address'] = f'{h}@{MAIL_DOMAIN}'
        update['custom_domain'] = None
        update['domain_verified'] = True
        update['fallback_address'] = None
    await db.users.update_one({'id': user['id']}, {'$set': update})
    fresh = await db.users.find_one({'id': user['id']}, {'_id': 0, 'password_hash': 0})
    return fresh


@router.get('/domain/dns-records')
async def domain_dns_records(user=Depends(get_current_user)):
    domain = user.get('custom_domain')
    if not domain:
        raise HTTPException(400, 'No custom domain configured for this account.')
    return {
        'domain': domain,
        'fallback_address': user.get('fallback_address'),
        'verified': bool(user.get('domain_verified')),
        'records': [
            {'type': 'MX', 'host': '@', 'value': 'mx.sendgrid.net', 'priority': 10,
             'purpose': 'Route incoming email through W'},
            {'type': 'TXT', 'host': '@', 'value': 'v=spf1 include:sendgrid.net ~all',
             'purpose': 'SPF — authorize W/SendGrid to send mail from your domain'},
            {'type': 'CNAME', 'host': 'em-w', 'value': 'u00000.wl.sendgrid.net',
             'purpose': 'Domain authentication (CNAME) — required for DKIM signing'},
            {'type': 'TXT', 'host': '_dmarc', 'value': f'v=DMARC1; p=none; rua=mailto:dmarc@{MAIL_DOMAIN}',
             'purpose': 'DMARC policy (optional but recommended)'},
        ],
        'instructions': (
            'Log into your domain registrar (GoDaddy, Cloudflare, Namecheap, Squarespace, etc.), '
            'open the DNS management page for your domain, and add the records above. '
            'Most registrars apply changes within a few minutes; some take up to 48 hours. '
            "Tap 'Verify' below once they're added."
        ),
    }


@router.post('/domain/verify')
async def domain_verify(user=Depends(get_current_user)):
    domain = user.get('custom_domain')
    if not domain:
        raise HTTPException(400, 'No custom domain configured.')
    try:
        import socket
        try:
            import dns.resolver  # type: ignore
            answers = dns.resolver.resolve(domain, 'MX', lifetime=5)
            hosts = [str(rd.exchange).lower().rstrip('.') for rd in answers]
        except Exception:
            socket.gethostbyname(domain)
            hosts = []
        verified = any('sendgrid' in h for h in hosts)
        await db.users.update_one(
            {'id': user['id']},
            {'$set': {'domain_verified': verified,
                      'domain_verified_at': now_iso() if verified else None,
                      'domain_last_check_at': now_iso(),
                      'domain_mx_seen': hosts}},
        )
        return {'verified': verified, 'mx_records': hosts,
                'message': 'Verified! Custom domain is active.' if verified
                           else "MX records aren't pointing to W yet. Give DNS a few more minutes and try again."}
    except Exception as e:
        logger.warning(f'Domain verify failed for {domain}: {e}')
        return {'verified': False, 'mx_records': [], 'message': "Couldn't resolve domain. Double-check spelling and DNS settings."}


# -------------------- Mailbox listings --------------------
@router.get('/mail/inbox')
async def mail_inbox(user=Depends(get_current_user)):
    addr = (user.get('email_address') or '').lower()
    fb = (user.get('fallback_address') or '').lower()
    addrs = [a for a in [addr, fb] if a]
    if not addrs:
        return []
    now_s = now_iso()
    q = {
        'to_addrs': {'$in': addrs},
        'folder': 'inbox',
        'archived': {'$ne': True},
        '$or': [
            {'snoozed_until': {'$exists': False}},
            {'snoozed_until': None},
            {'snoozed_until': {'$lte': now_s}},
        ],
    }
    msgs = decrypt_mail_list(await db.emails.find(q, {'_id': 0}).sort('created_at', -1).to_list(500))
    return msgs


@router.get('/mail/starred')
async def mail_starred(user=Depends(get_current_user)):
    """All starred (kept) emails across folders. Useful for the 'Saved' tab."""
    addr = (user.get('email_address') or '').lower()
    fb = (user.get('fallback_address') or '').lower()
    addrs = [a for a in [addr, fb] if a]
    q = {'starred': True, '$or': [{'owner_id': user['id']}, {'to_addrs': {'$in': addrs or [None]}}]}
    msgs = decrypt_mail_list(await db.emails.find(q, {'_id': 0}).sort('created_at', -1).to_list(500))
    return msgs


@router.get('/mail/spam')
async def mail_spam(user=Depends(get_current_user)):
    """Spam folder — emails routed here either manually or by the AI spam scanner."""
    addr = (user.get('email_address') or '').lower()
    fb = (user.get('fallback_address') or '').lower()
    addrs = [a for a in [addr, fb] if a]
    if not addrs:
        return []
    q = {'to_addrs': {'$in': addrs}, 'folder': 'spam'}
    msgs = decrypt_mail_list(await db.emails.find(q, {'_id': 0}).sort('created_at', -1).to_list(500))
    return msgs


@router.post('/mail/{mail_id}/spam')
async def mark_mail_spam(mail_id: str, user=Depends(get_current_user)):
    addrs = _addrs_for(user)
    res = await db.emails.update_one(
        {'id': mail_id, 'to_addrs': {'$in': addrs or [None]}},
        {'$set': {'folder': 'spam', 'spam_marked_at': now_iso(), 'starred': False}},
    )
    if res.matched_count == 0:
        raise HTTPException(404, 'Email not found.')
    return {'ok': True, 'mail_id': mail_id, 'folder': 'spam'}


@router.post('/mail/{mail_id}/not-spam')
async def mark_mail_not_spam(mail_id: str, user=Depends(get_current_user)):
    """Move a spam-flagged email back to the inbox.

    Also learns: the sender's domain joins the user's personal allowlist so
    future emails from that domain skip the auto-triage step entirely.
    """
    addrs = _addrs_for(user)
    mail = await db.emails.find_one(
        {'id': mail_id, 'folder': 'spam', 'to_addrs': {'$in': addrs or [None]}},
        {'_id': 0, 'from_addr': 1},
    )
    if not mail:
        raise HTTPException(404, 'Email not found in spam.')
    await db.emails.update_one(
        {'id': mail_id},
        {'$set': {'folder': 'inbox'}, '$unset': {'spam_marked_at': '', 'spam_reason': ''}},
    )
    dom = _sender_domain(mail.get('from_addr') or '')
    if dom:
        await db.users.update_one({'id': user['id']}, {'$addToSet': {'inbox_allowlist': dom}})
    return {'ok': True, 'mail_id': mail_id, 'folder': 'inbox'}


@router.get('/mail/promotions')
async def mail_promotions(user=Depends(get_current_user)):
    """Promotions folder — newsletters, marketing, deal emails auto-routed by AI."""
    addrs = _addrs_for(user)
    if not addrs:
        return []
    q = {'to_addrs': {'$in': addrs}, 'folder': 'promotions'}
    msgs = decrypt_mail_list(await db.emails.find(q, {'_id': 0}).sort('created_at', -1).to_list(500))
    return msgs


@router.post('/mail/{mail_id}/promotions')
async def mark_mail_promotions(mail_id: str, user=Depends(get_current_user)):
    addrs = _addrs_for(user)
    res = await db.emails.update_one(
        {'id': mail_id, 'to_addrs': {'$in': addrs or [None]}},
        {'$set': {'folder': 'promotions', 'promotions_marked_at': now_iso(), 'starred': False}},
    )
    if res.matched_count == 0:
        raise HTTPException(404, 'Email not found.')
    return {'ok': True, 'mail_id': mail_id, 'folder': 'promotions'}


@router.post('/mail/{mail_id}/not-promotions')
async def mark_mail_not_promotions(mail_id: str, user=Depends(get_current_user)):
    """Move a promotions-flagged email back to the inbox.

    Also learns: the sender's domain joins the user's personal allowlist so
    future emails from that domain skip the auto-triage step entirely.
    """
    addrs = _addrs_for(user)
    mail = await db.emails.find_one(
        {'id': mail_id, 'folder': 'promotions', 'to_addrs': {'$in': addrs or [None]}},
        {'_id': 0, 'from_addr': 1},
    )
    if not mail:
        raise HTTPException(404, 'Email not found in promotions.')
    await db.emails.update_one(
        {'id': mail_id},
        {'$set': {'folder': 'inbox'}, '$unset': {'promotions_marked_at': '', 'promotions_reason': ''}},
    )
    dom = _sender_domain(mail.get('from_addr') or '')
    if dom:
        await db.users.update_one({'id': user['id']}, {'$addToSet': {'inbox_allowlist': dom}})
    return {'ok': True, 'mail_id': mail_id, 'folder': 'inbox'}


@router.get('/mail/archived')
async def mail_archived(user=Depends(get_current_user)):
    addr = (user.get('email_address') or '').lower()
    fb = (user.get('fallback_address') or '').lower()
    addrs = [a for a in [addr, fb] if a]
    if not addrs:
        return []
    q = {'to_addrs': {'$in': addrs}, 'archived': True}
    msgs = decrypt_mail_list(await db.emails.find(q, {'_id': 0}).sort('created_at', -1).to_list(500))
    return msgs


@router.get('/mail/snoozed')
async def mail_snoozed(user=Depends(get_current_user)):
    addr = (user.get('email_address') or '').lower()
    fb = (user.get('fallback_address') or '').lower()
    addrs = [a for a in [addr, fb] if a]
    if not addrs:
        return []
    now_s = now_iso()
    q = {'to_addrs': {'$in': addrs}, 'snoozed_until': {'$gt': now_s}}
    msgs = decrypt_mail_list(await db.emails.find(q, {'_id': 0}).sort('snoozed_until', 1).to_list(500))
    return msgs


@router.get('/mail/sent')
async def mail_sent(user=Depends(get_current_user)):
    msgs = decrypt_mail_list(await db.emails.find({'owner_id': user['id'], 'folder': 'sent'}, {'_id': 0}).sort('created_at', -1).to_list(500))
    return msgs


@router.get('/mail/drafts')
async def mail_drafts(user=Depends(get_current_user)):
    msgs = decrypt_mail_list(await db.emails.find({'owner_id': user['id'], 'folder': 'drafts'}, {'_id': 0}).sort('created_at', -1).to_list(500))
    return msgs


@router.get('/mail/search')
async def mail_search(q: str, user=Depends(get_current_user)):
    q = (q or '').strip()
    if not q:
        return []
    addr = (user.get('email_address') or '').lower()
    pattern = re.escape(q)
    query = {
        '$and': [
            {'$or': [
                {'owner_id': user['id']},
                {'to_addrs': addr},
            ]},
            {'$or': [
                {'subject': {'$regex': pattern, '$options': 'i'}},
                {'body': {'$regex': pattern, '$options': 'i'}},
                {'from_addr': {'$regex': pattern, '$options': 'i'}},
                {'from_name': {'$regex': pattern, '$options': 'i'}},
                {'to_addrs': {'$regex': pattern, '$options': 'i'}},
            ]},
        ]
    }
    msgs = decrypt_mail_list(await db.emails.find(query, {'_id': 0}).sort('created_at', -1).to_list(200))
    return msgs


@router.post('/mail/drafts')
async def save_draft(req: DraftReq, user=Depends(get_current_user)):
    if not user.get('email_address'):
        raise HTTPException(400, 'Set up your @w.xyz address first.')
    now = now_iso()
    if req.id:
        existing = await db.emails.find_one({'id': req.id, 'owner_id': user['id'], 'folder': 'drafts'}, {'_id': 0})
        if not existing:
            raise HTTPException(404, 'Draft not found')
        update = {
            'to_addrs': [a.strip().lower() for a in (req.to or []) if a.strip()],
            'subject': req.subject or '',
            'body': req.body or '',
            'attachments': req.attachments or [],
            'updated_at': now,
        }
        await db.emails.update_one({'id': req.id}, {'$set': encrypt_mail_record(dict(update))})
        fresh = await db.emails.find_one({'id': req.id}, {'_id': 0})
        return decrypt_mail_record(fresh)
    record = {
        'id': str(uuid.uuid4()),
        'owner_id': user['id'],
        'folder': 'drafts',
        'from_addr': user['email_address'],
        'from_name': user.get('name') or user['email_address'],
        'to_addrs': [a.strip().lower() for a in (req.to or []) if a.strip()],
        'subject': req.subject or '',
        'body': req.body or '',
        'attachments': req.attachments or [],
        'read': True,
        'created_at': now,
        'updated_at': now,
        'delivery_status': 'draft',
    }
    await db.emails.insert_one(encrypt_mail_record(dict(record)))
    return record


@router.delete('/mail/{mail_id}')
async def mail_delete(mail_id: str, user=Depends(get_current_user)):
    m = await db.emails.find_one({'id': mail_id}, {'_id': 0})
    if not m or m.get('owner_id') != user['id']:
        raise HTTPException(404, 'Not found')
    await db.emails.delete_one({'id': mail_id})
    return {'ok': True}


# -------------------- Threaded conversation view --------------------
def _addrs_for(user: dict) -> list:
    addr = (user.get('email_address') or '').lower()
    fb = (user.get('fallback_address') or '').lower()
    return [a for a in [addr, fb] if a]


@router.get('/mail/thread/{thread_id}')
async def get_thread(thread_id: str, user=Depends(get_current_user)):
    """Return every email in a thread the user can see + mark them as read/opened."""
    addrs = _addrs_for(user)
    q = {'thread_id': thread_id, '$or': [{'owner_id': user['id']}, {'to_addrs': {'$in': addrs or [None]}}]}
    items = decrypt_mail_list(await db.emails.find(q, {'_id': 0}).sort('created_at', 1).to_list(500))
    if not items:
        raise HTTPException(404, 'Thread not found')
    # Mark unread inbound emails as read AND record opened_at if not already.
    # Skip archived / currently-snoozed messages so they don't become Ghost-Mail victims.
    now_s = now_iso()
    ids_to_open = [
        m['id'] for m in items
        if m.get('folder') == 'inbox'
           and not m.get('archived')
           and not (m.get('snoozed_until') and m['snoozed_until'] > now_s)
           and (not m.get('read') or not m.get('opened_at'))
    ]
    if ids_to_open:
        await db.emails.update_many(
            {'id': {'$in': ids_to_open}},
            {'$set': {'read': True, 'opened_at': now_s}},
        )
        for m in items:
            if m['id'] in ids_to_open:
                m['read'] = True
                m['opened_at'] = now_s
    return {
        'thread_id': thread_id,
        'messages': items,
        'ghost_mail_enabled': bool(user.get('ghost_mail_enabled', True)),
        'is_starred': any(m.get('starred') for m in items),
    }


@router.post('/mail/thread/{thread_id}/star')
async def star_thread(thread_id: str, user=Depends(get_current_user)):
    """Save the entire thread permanently (Ghost Mail won't delete it on close).
    Applies to both incoming and outgoing messages in the thread."""
    q = {'thread_id': thread_id, 'owner_id': user['id']}
    res = await db.emails.update_many(q, {'$set': {'starred': True, 'starred_at': now_iso()}})
    return {'starred': True, 'matched': res.modified_count}


@router.post('/mail/thread/{thread_id}/unstar')
async def unstar_thread(thread_id: str, user=Depends(get_current_user)):
    q = {'thread_id': thread_id, 'owner_id': user['id']}
    res = await db.emails.update_many(q, {'$set': {'starred': False}, '$unset': {'starred_at': ''}})
    return {'starred': False, 'matched': res.modified_count}


@router.post('/mail/thread/{thread_id}/close')
async def close_thread(thread_id: str, user=Depends(get_current_user)):
    """Left in place for API compatibility. As of the 24-hour Ghost Mail
    model, closing a thread no longer immediately deletes anything —
    unsaved mail auto-expires after 24h via the background sweeper."""
    return {'deleted': 0, 'ghost_mail': True, 'mode': 'time_based_24h'}


# -------------------- Per-message actions --------------------
@router.patch('/mail/{mail_id}/star')
async def star_mail(mail_id: str, user=Depends(get_current_user)):
    m = await db.emails.find_one({'id': mail_id}, {'_id': 0, 'starred': 1, 'owner_id': 1, 'to_addrs': 1})
    if not m:
        raise HTTPException(404, 'Not found')
    addrs = _addrs_for(user)
    if m.get('owner_id') != user['id'] and not (set([a.lower() for a in (m.get('to_addrs') or [])]) & set(addrs)):
        raise HTTPException(403, 'Forbidden')
    new_val = not bool(m.get('starred'))
    update: dict = {'$set': {'starred': new_val}}
    if new_val:
        update['$set']['starred_at'] = now_iso()
    else:
        update['$unset'] = {'starred_at': ''}
    await db.emails.update_one({'id': mail_id}, update)
    return {'starred': new_val}


@router.patch('/mail/{mail_id}/archive')
async def archive_mail(mail_id: str, user=Depends(get_current_user)):
    m = await db.emails.find_one({'id': mail_id}, {'_id': 0, 'archived': 1, 'to_addrs': 1, 'owner_id': 1})
    if not m:
        raise HTTPException(404, 'Not found')
    addrs = _addrs_for(user)
    if m.get('owner_id') != user['id'] and not (set([a.lower() for a in (m.get('to_addrs') or [])]) & set(addrs)):
        raise HTTPException(403, 'Forbidden')
    new_val = not bool(m.get('archived'))
    update: dict = {'$set': {'archived': new_val}}
    if new_val:
        update['$set']['archived_at'] = now_iso()
    else:
        update['$unset'] = {'archived_at': ''}
    await db.emails.update_one({'id': mail_id}, update)
    return {'archived': new_val}


@router.patch('/mail/{mail_id}/snooze')
async def snooze_mail(mail_id: str, req: SnoozeReq, user=Depends(get_current_user)):
    m = await db.emails.find_one({'id': mail_id}, {'_id': 0, 'to_addrs': 1, 'owner_id': 1})
    if not m:
        raise HTTPException(404, 'Not found')
    addrs = _addrs_for(user)
    if m.get('owner_id') != user['id'] and not (set([a.lower() for a in (m.get('to_addrs') or [])]) & set(addrs)):
        raise HTTPException(403, 'Forbidden')
    if req.until:
        # Validate ISO date
        try:
            dt = datetime.fromisoformat(req.until.replace('Z', '+00:00'))
        except Exception:
            raise HTTPException(400, 'Invalid snooze date.')
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        if dt <= _utcnow():
            raise HTTPException(400, 'Snooze date must be in the future.')
        await db.emails.update_one({'id': mail_id}, {'$set': {'snoozed_until': req.until}})
        return {'snoozed_until': req.until}
    await db.emails.update_one({'id': mail_id}, {'$unset': {'snoozed_until': ''}})
    return {'snoozed_until': None}


@router.get('/mail/{mail_id}')
async def mail_detail(mail_id: str, user=Depends(get_current_user)):
    m = await db.emails.find_one({'id': mail_id}, {'_id': 0})
    if not m:
        raise HTTPException(404, 'Not found')
    addr = (user.get('email_address') or '').lower()
    if m.get('owner_id') != user['id'] and addr not in [a.lower() for a in (m.get('to_addrs') or [])]:
        raise HTTPException(403, 'Forbidden')
    if not m.get('read') and m.get('folder') == 'inbox' and addr in [a.lower() for a in (m.get('to_addrs') or [])]:
        await db.emails.update_one({'id': mail_id}, {'$set': {'read': True}})
        m['read'] = True
    return decrypt_mail_record(m)


@router.patch('/mail/{mail_id}/read')
async def mail_mark_read(mail_id: str, user=Depends(get_current_user)):
    await db.emails.update_one({'id': mail_id}, {'$set': {'read': True}})
    return {'ok': True}


@router.patch('/mail/{mail_id}/unread')
async def mail_mark_unread(mail_id: str, user=Depends(get_current_user)):
    await db.emails.update_one({'id': mail_id}, {'$set': {'read': False}})
    return {'ok': True}


def _build_sendgrid_message(record: dict, user: dict, attachments: list):
    """Build a SendGrid Mail object from a stored record. Returns the Mail or None."""
    if not SENDGRID_API_KEY:
        return None
    from sendgrid.helpers.mail import Mail, Email, To, ReplyTo, Content, Attachment, FileContent, FileName, FileType, Disposition, Header as SgHeader
    from_addr = record['from_addr']
    body_out = record.get('body') or ' '
    plain_body = _text_to_plain(body_out, from_addr)
    html_body = _text_to_html(body_out, user.get('name') or from_addr)
    msg = Mail(
        from_email=Email(from_addr, user.get('name') or from_addr),
        subject=record.get('subject') or '(no subject)',
        plain_text_content=Content('text/plain', plain_body),
        html_content=Content('text/html', html_body),
    )
    msg.reply_to = ReplyTo(from_addr, user.get('name') or from_addr)
    msg.add_header(SgHeader('X-Mailer', 'W Mail/1.0'))
    for addr in record['to_addrs']:
        msg.add_to(To(addr))
    for a in (attachments or []):
        if a.get('content_b64') and a.get('filename'):
            att = Attachment(
                FileContent(a['content_b64']),
                FileName(a['filename']),
                FileType(a.get('type') or 'application/octet-stream'),
                Disposition('attachment'),
            )
            msg.add_attachment(att)
    return msg


async def _send_record_now(record: dict, user: dict) -> dict:
    """Actually transmit a queued/scheduled email via SendGrid. Mutates and returns the record."""
    # Records loaded from MongoDB are encrypted; ones built fresh in compose
    # are still plaintext. decrypt_mail_record is idempotent for both.
    decrypt_mail_record(record)
    if not SENDGRID_API_KEY:
        record['delivery_status'] = 'saved_no_provider'
        record['delivery_error'] = 'SendGrid API key not configured yet; email saved to Sent folder only.'
        return record
    try:
        from sendgrid import SendGridAPIClient
        msg = _build_sendgrid_message(record, user, record.get('attachments') or [])
        sg = SendGridAPIClient(SENDGRID_API_KEY)
        resp = sg.send(msg)
        record['delivery_status'] = 'sent' if resp.status_code in (200, 202) else f'error_{resp.status_code}'
    except Exception as e:
        logger.exception('SendGrid send failed')
        record['delivery_status'] = 'error'
        record['delivery_error'] = str(e)[:300]
    return record


@router.post('/mail/compose')
async def mail_compose(req: ComposeMailReq, user=Depends(get_current_user)):
    if not user.get('email_address'):
        raise HTTPException(400, 'Set up your @w.xyz address first.')
    if not req.to or not req.subject and not req.body:
        raise HTTPException(400, 'Recipient and subject/body required.')

    total_att_bytes = sum(_approx_b64_bytes((a or {}).get('content_b64')) for a in (req.attachments or []))
    if total_att_bytes > 0:
        await _check_and_bump_storage(user, total_att_bytes)

    from_addr = user['email_address']
    mail_id = str(uuid.uuid4())
    message_id = f'<{mail_id}@{MAIL_DOMAIN}>'
    thread_id = req.thread_id
    if req.in_reply_to and not thread_id:
        parent = await db.emails.find_one({'message_id': req.in_reply_to}, {'_id': 0, 'thread_id': 1})
        thread_id = (parent or {}).get('thread_id') or req.in_reply_to
    if not thread_id:
        thread_id = message_id

    body_out = req.body or ''
    sig = (user.get('signature') or '').strip()
    if sig and req.include_signature and '-- ' not in body_out:
        body_out = f'{body_out}\n\n-- \n{sig}'

    # Decide whether this is an immediate send, a deferred Undo-window send,
    # or a true scheduled "send later" message.
    scheduled_at: Optional[str] = None
    if req.send_at:
        scheduled_at = req.send_at
    elif req.defer_seconds and req.defer_seconds > 0:
        scheduled_at = (_utcnow() + timedelta(seconds=int(req.defer_seconds))).isoformat()

    record = {
        'id': mail_id,
        'owner_id': user['id'],
        'folder': 'scheduled' if scheduled_at else 'sent',
        'from_addr': from_addr,
        'from_name': user.get('name') or from_addr,
        'from_tier': _user_tier(user),
        'to_addrs': [a.strip().lower() for a in req.to if a.strip()],
        'subject': req.subject or '(no subject)',
        'body': body_out,
        'body_html': '',
        'attachments': req.attachments or [],
        'read': True,
        'created_at': now_iso(),
        'delivery_status': 'scheduled' if scheduled_at else 'queued',
        'delivery_error': None,
        'message_id': message_id,
        'in_reply_to': req.in_reply_to,
        'thread_id': thread_id,
        'scheduled_at': scheduled_at,
    }

    if not scheduled_at:
        await _send_record_now(record, user)

    await db.emails.insert_one(encrypt_mail_record(dict(record)))
    if req.draft_id:
        await db.emails.delete_one({'id': req.draft_id, 'owner_id': user['id'], 'folder': 'drafts'})
    return record


@router.get('/mail/scheduled')
async def mail_scheduled(user=Depends(get_current_user)):
    """All messages queued for deferred / scheduled send."""
    msgs = await db.emails.find(
        {'owner_id': user['id'], 'folder': 'scheduled'},
        {'_id': 0},
    ).sort('scheduled_at', 1).to_list(500)
    return msgs


@router.post('/mail/{mail_id}/cancel-send')
async def mail_cancel_send(mail_id: str, user=Depends(get_current_user)):
    """Cancel a scheduled / deferred send and turn it back into a draft."""
    rec = await db.emails.find_one(
        {'id': mail_id, 'owner_id': user['id'], 'folder': 'scheduled'},
        {'_id': 0},
    )
    if not rec:
        raise HTTPException(404, 'Scheduled email not found (it may have already been sent).')
    await db.emails.update_one(
        {'id': mail_id},
        {
            '$set': {'folder': 'drafts', 'delivery_status': 'cancelled'},
            '$unset': {'scheduled_at': '', 'message_id': '', 'thread_id': '', 'in_reply_to': ''},
        },
    )
    return {'ok': True, 'mail_id': mail_id, 'folder': 'drafts'}


@router.post('/mail/inbound')
async def mail_inbound(request: Request):
    """SendGrid Inbound Parse webhook (multipart/form-data, no auth)."""
    form = await request.form()
    to_raw = (form.get('to') or '').strip()
    frm = (form.get('from') or '').strip()
    subject = (form.get('subject') or '').strip()
    text = (form.get('text') or '').strip()
    html = (form.get('html') or '').strip()
    envelope = form.get('envelope') or '{}'
    try:
        env = json.loads(envelope) if isinstance(envelope, str) else {}
    except Exception:
        env = {}
    raw_to = env.get('to') or []
    if not raw_to:
        raw_to = [e.strip() for e in re.findall(r'[\w._+-]+@[\w.-]+', to_raw)]
    to_addrs = [a.lower() for a in raw_to]

    attachments = []
    n = int(form.get('attachments') or 0)
    for i in range(1, n + 1):
        f = form.get(f'attachment{i}')
        if f and hasattr(f, 'read'):
            raw = f.read()
            if inspect.isawaitable(raw):
                data = await raw
            else:
                data = raw
            try:
                b64 = base64.b64encode(data).decode('ascii')
            except Exception:
                b64 = ''
            attachments.append({'filename': f.filename, 'type': f.content_type, 'content_b64': b64, 'size': len(data)})

    domain_to = [a for a in to_addrs if a.endswith(f'@{MAIL_DOMAIN}')]
    if not domain_to:
        logger.info(f'Inbound mail dropped (no domain match): {to_addrs}')
        return {'ok': True, 'stored': 0}

    sender_match = re.search(r'[\w._+-]+@[\w.-]+', frm or '')
    sender = sender_match.group(0).lower() if sender_match else frm

    raw_headers = form.get('headers') or ''
    msg_id = None
    in_reply_to = None
    references = None
    if raw_headers:
        for line in str(raw_headers).split('\n'):
            low = line.lower()
            if low.startswith('message-id:'):
                m = re.search(r'<[^>]+>', line)
                if m:
                    msg_id = m.group(0)
            elif low.startswith('in-reply-to:'):
                m = re.search(r'<[^>]+>', line)
                if m:
                    in_reply_to = m.group(0)
            elif low.startswith('references:'):
                refs = re.findall(r'<[^>]+>', line)
                if refs:
                    references = refs

    thread_id = None
    if in_reply_to:
        parent = await db.emails.find_one({'message_id': in_reply_to}, {'_id': 0, 'thread_id': 1})
        thread_id = (parent or {}).get('thread_id') or in_reply_to
    if not thread_id and references:
        for r in references:
            parent = await db.emails.find_one({'message_id': r}, {'_id': 0, 'thread_id': 1})
            if parent:
                thread_id = parent.get('thread_id') or r
                break
    if not thread_id:
        thread_id = msg_id or str(uuid.uuid4())

    stored = 0
    sender_tier = 'free'
    if sender and sender.endswith(f'@{MAIL_DOMAIN}'):
        sender_user = await db.users.find_one({'email_address': sender}, {'_id': 0})
        if sender_user:
            sender_tier = _user_tier(sender_user)

    for addr in domain_to:
        owner = await db.users.find_one({'email_address': addr}, {'_id': 0})
        if not owner:
            continue
        sanitized_html, trackers_blocked = _strip_trackers(_sanitize_html(html))
        rec = {
            'id': str(uuid.uuid4()),
            'owner_id': owner['id'],
            'folder': 'inbox',
            'from_addr': sender,
            'from_name': frm.split('<')[0].strip().strip('"') if '<' in frm else sender,
            'from_tier': sender_tier,
            'to_addrs': to_addrs,
            'subject': subject or '(no subject)',
            'body': text or _strip_html(html),
            'body_html': sanitized_html,
            'trackers_blocked': trackers_blocked,
            'attachments': attachments,
            'read': False,
            'created_at': now_iso(),
            'delivery_status': 'received',
            'message_id': msg_id,
            'in_reply_to': in_reply_to,
            'thread_id': thread_id,
        }
        await db.emails.insert_one(encrypt_mail_record(dict(rec)))
        stored += 1
        await ws_manager.send_to_user(owner['id'], {'type': 'new_email', 'email': rec})
        # Async triage: header heuristics → user allowlist → Claude. Fire-and-forget
        # so the SendGrid webhook isn't blocked.
        asyncio.create_task(_triage_inbound(rec, owner, str(raw_headers or '')))
        # Optional out-of-office auto-reply
        await _maybe_send_auto_reply(owner, sender, subject, in_reply_to=msg_id,
                                       incoming_body=(text or _strip_html(html)))

    return {'ok': True, 'stored': stored}


# Known ESPs / bulk-mail SaaS — emails from these are almost always Promos.
_PROMO_ESP_SUFFIXES = (
    'mail.mailchimp.com', 'mailchimpapp.com', 'mailchimp.com',
    'sendgrid.net', 'sendgrid.com',
    'mandrillapp.com', 'mc.sendgrid.net',
    'klaviyomail.com', 'klaviyo.com',
    'mktomail.com', 'mktdns.com',  # marketo
    'sparkpostmail.com',
    'amazonses.com',  # often used for bulk
    'campaign-archive.com', 'list-manage.com',
    'salesforce.com', 'pardot.com',
    'constantcontact.com', 'ccsend.com',
    'sendinblue.com', 'sib.org',  # brevo
    'iterable.email', 'iterable.com',
    'customer.io',
    'postmarkapp.com',  # transactional but often promo too
    'mailerlite.com',
    'omnisend.com',
    'convertkit.com', 'convertkit-mail.com',
    'mailjet.com',
    'beehiiv.com', 'list-mail.beehiiv.com',
    'substack.com',
)


def _looks_like_bulk(raw_headers: str, sender: str) -> bool:
    """Cheap header-only check. True if the email almost certainly belongs
    in Promotions / bulk-mail. Skips the AI call when True."""
    h = (raw_headers or '').lower()
    if not h and not sender:
        return False
    signals = (
        'list-unsubscribe:',
        'list-unsubscribe-post:',
        'list-id:',
        'precedence: bulk',
        'precedence:bulk',
        'precedence: list',
        'x-mailgun-batch:',
        'x-campaign',
        'x-mailchimp',
        'x-mc-user',
        'feedback-id:',  # used by Gmail / Apple for bulk feedback loop
    )
    if any(s in h for s in signals):
        return True
    s = (sender or '').lower()
    if '@' in s:
        domain = s.split('@', 1)[1]
        if any(domain == d or domain.endswith('.' + d) for d in _PROMO_ESP_SUFFIXES):
            return True
    return False


def _sender_domain(addr: str) -> str:
    a = (addr or '').lower().strip()
    return a.split('@', 1)[1] if '@' in a else ''


async def _triage_inbound(rec: dict, owner: dict, raw_headers: str) -> None:
    """Background task: route a freshly-received email to the right folder.

    Layered like Gmail's:
      1. Personal allowlist  → keep in inbox, no AI cost.
      2. Header heuristics   → bulk/marketing markers → Promos, no AI cost.
      3. Claude semantic AI  → spam vs promotions vs inbox.
    """
    try:
        owner_id = owner['id']
        sender = rec.get('from_addr') or ''
        dom = _sender_domain(sender)

        # 1) Personal allowlist (sender domains the user has rescued before)
        allow: set = set((owner.get('inbox_allowlist') or []))
        if dom and dom in allow:
            return  # stays in inbox

        # 2) Bulk-mail header heuristics → Promotions (no AI call)
        if _looks_like_bulk(raw_headers, sender):
            await db.emails.update_one(
                {'id': rec['id']},
                {'$set': {
                    'folder': 'promotions',
                    'promotions_marked_at': now_iso(),
                    'promotions_reason': 'Bulk-mail headers detected.',
                    'ai_triage': {'category': 'promotions', 'confidence': 0.95, 'reason': 'header-heuristic'},
                }},
            )
            await ws_manager.send_to_user(owner_id, {'type': 'mail_triaged', 'mail_id': rec['id'], 'folder': 'promotions'})
            return

        # 3) Claude semantic triage
        result = await ai_classify_email(rec)
        if not result:
            return
        cat = result.get('category')
        if cat not in ('spam', 'promotions'):
            return
        upd: dict = {'folder': cat, 'ai_triage': result}
        if cat == 'spam':
            upd['spam_marked_at'] = now_iso()
            upd['spam_reason'] = result.get('reason') or ''
            upd['starred'] = False
        else:
            upd['promotions_marked_at'] = now_iso()
            upd['promotions_reason'] = result.get('reason') or ''
        await db.emails.update_one({'id': rec['id']}, {'$set': upd})
        await ws_manager.send_to_user(owner_id, {
            'type': 'mail_triaged',
            'mail_id': rec['id'],
            'folder': cat,
        })
    except Exception as e:
        logger.warning(f'inbound triage failed for {rec.get("id")}: {type(e).__name__}: {str(e)[:120]}')


async def _maybe_send_auto_reply(owner: dict, sender: str, original_subject: str,
                                  in_reply_to: Optional[str] = None,
                                  incoming_body: str = '') -> None:
    """If the recipient has an active auto-reply, fire one back via SendGrid.

    Anti-loop safeguards:
      * Only one auto-reply per (owner, sender) per 24h.
      * Skip if sender is empty, self, or a no-reply / mailer-daemon address.
      * Skip if sender is the owner's own W address (prevents self-loops).
    """
    ar = (owner or {}).get('auto_reply') or {}
    if not ar.get('enabled'):
        return
    has_static = bool(ar.get('body'))
    has_ai = bool(ar.get('ai_enabled')) and _user_tier(owner) in ('plus', 'pro')
    if not has_static and not has_ai:
        return
    if not sender or '@' not in sender:
        return
    s_low = sender.lower()
    blocked_locals = ('noreply', 'no-reply', 'mailer-daemon', 'postmaster', 'donotreply',
                       'bounce', 'bounces', 'abuse', 'unsubscribe')
    local = s_low.split('@', 1)[0]
    if local in blocked_locals or 'mailer-daemon' in s_low:
        return
    owner_addr = (owner.get('email_address') or '').lower()
    if owner_addr and owner_addr == s_low:
        return
    # Date window
    now = _utcnow()
    start = _parse_dt_safe(ar.get('start_at'))
    end = _parse_dt_safe(ar.get('end_at'))
    if start and now < start:
        return
    if end and now > end:
        return
    # 24h dedup
    last = await db.auto_reply_log.find_one({'owner_id': owner['id'], 'to': s_low})
    if last:
        when = _parse_dt_safe(last.get('sent_at'))
        if when and (now - when) < timedelta(hours=24):
            return

    reply_subject = ar.get('subject') or 'Out of office'
    if original_subject and not reply_subject.lower().startswith('re:'):
        reply_subject = f'{reply_subject}: Re: {original_subject}'

    # AI mode: generate a personalised reply from the inbound email (Pro feature).
    text_body = ar.get('body') or ''
    if ar.get('ai_enabled') and _user_tier(owner) in ('plus', 'pro'):
        try:
            ai_text = await ai_compose_reply(
                owner=owner,
                incoming_subject=original_subject or '',
                incoming_body=incoming_body or '',
                note=ar.get('body') or None,  # the static body becomes optional "context note"
            )
            if ai_text:
                text_body = ai_text
        except Exception as e:
            owner_id = owner.get('id')
            logger.warning(f'AI auto-reply generation failed for {owner_id}: {e}')
            if not text_body:
                return  # No fallback content; skip rather than send empty
    if not text_body:
        return

    html_body = _text_to_html(text_body, owner.get('name') or owner_addr)
    try:
        send_system_email(
            to_email=sender,
            subject=reply_subject,
            text_body=text_body,
            html_body=html_body,
            from_email=owner_addr or None,
            from_name=owner.get('name') or 'W User',
            reply_to=owner_addr or None,
        )
        await db.auto_reply_log.update_one(
            {'owner_id': owner['id'], 'to': s_low},
            {'$set': {'owner_id': owner['id'], 'to': s_low, 'sent_at': now.isoformat()}},
            upsert=True,
        )
    except Exception as e:
        logger.warning(f"auto-reply send failed for {owner.get('id')} -> {sender}: {e}")


def _parse_dt_safe(v):
    """Local helper to parse optional ISO datetimes for auto-reply windowing."""
    if not v:
        return None
    try:
        from datetime import datetime as _dt, timezone as _tz
        if isinstance(v, _dt):
            return v if v.tzinfo else v.replace(tzinfo=_tz.utc)
        return _dt.fromisoformat(str(v).replace('Z', '+00:00'))
    except Exception:
        return None
