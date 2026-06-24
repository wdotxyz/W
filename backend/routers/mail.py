"""W Mail: handle/domain management, mailbox CRUD, compose, inbound webhook."""
import base64
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
    _is_valid_domain, _sanitize_html, _slugify_domain, _strip_html, _text_to_html,
    _text_to_plain, _user_tier, _validate_handle,
)
from services.sendgrid_mail import send_system_email
from services.ai_assist import ai_compose_reply

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
    msgs = await db.emails.find(q, {'_id': 0}).sort('created_at', -1).to_list(500)
    return msgs


@router.get('/mail/starred')
async def mail_starred(user=Depends(get_current_user)):
    """All starred (kept) emails across folders. Useful for the 'Saved' tab."""
    addr = (user.get('email_address') or '').lower()
    fb = (user.get('fallback_address') or '').lower()
    addrs = [a for a in [addr, fb] if a]
    q = {'starred': True, '$or': [{'owner_id': user['id']}, {'to_addrs': {'$in': addrs or [None]}}]}
    msgs = await db.emails.find(q, {'_id': 0}).sort('created_at', -1).to_list(500)
    return msgs


@router.get('/mail/archived')
async def mail_archived(user=Depends(get_current_user)):
    addr = (user.get('email_address') or '').lower()
    fb = (user.get('fallback_address') or '').lower()
    addrs = [a for a in [addr, fb] if a]
    if not addrs:
        return []
    q = {'to_addrs': {'$in': addrs}, 'archived': True}
    msgs = await db.emails.find(q, {'_id': 0}).sort('created_at', -1).to_list(500)
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
    msgs = await db.emails.find(q, {'_id': 0}).sort('snoozed_until', 1).to_list(500)
    return msgs


@router.get('/mail/sent')
async def mail_sent(user=Depends(get_current_user)):
    msgs = await db.emails.find({'owner_id': user['id'], 'folder': 'sent'}, {'_id': 0}).sort('created_at', -1).to_list(500)
    return msgs


@router.get('/mail/drafts')
async def mail_drafts(user=Depends(get_current_user)):
    msgs = await db.emails.find({'owner_id': user['id'], 'folder': 'drafts'}, {'_id': 0}).sort('created_at', -1).to_list(500)
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
    msgs = await db.emails.find(query, {'_id': 0}).sort('created_at', -1).to_list(200)
    return msgs


@router.post('/mail/drafts')
async def save_draft(req: DraftReq, user=Depends(get_current_user)):
    if not user.get('email_address'):
        raise HTTPException(400, 'Set up your @w.xyz handle first.')
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
        await db.emails.update_one({'id': req.id}, {'$set': update})
        fresh = await db.emails.find_one({'id': req.id}, {'_id': 0})
        return fresh
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
    await db.emails.insert_one(dict(record))
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
    items = await db.emails.find(q, {'_id': 0}).sort('created_at', 1).to_list(500)
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
    """Save the entire thread permanently (Ghost Mail won't delete it on close)."""
    addrs = _addrs_for(user)
    q = {'thread_id': thread_id, 'folder': 'inbox', 'to_addrs': {'$in': addrs or [None]}}
    res = await db.emails.update_many(q, {'$set': {'starred': True, 'starred_at': now_iso()}})
    return {'starred': True, 'matched': res.modified_count}


@router.post('/mail/thread/{thread_id}/unstar')
async def unstar_thread(thread_id: str, user=Depends(get_current_user)):
    addrs = _addrs_for(user)
    q = {'thread_id': thread_id, 'folder': 'inbox', 'to_addrs': {'$in': addrs or [None]}}
    res = await db.emails.update_many(q, {'$set': {'starred': False}, '$unset': {'starred_at': ''}})
    return {'starred': False, 'matched': res.modified_count}


@router.post('/mail/thread/{thread_id}/close')
async def close_thread(thread_id: str, user=Depends(get_current_user)):
    """Called when the user navigates away. Ghost-deletes unstarred inbox messages
    that were already opened, IF the user has ghost_mail enabled."""
    if not user.get('ghost_mail_enabled', True):
        return {'deleted': 0, 'ghost_mail': False}
    addrs = _addrs_for(user)
    now_s = now_iso()
    q = {
        'thread_id': thread_id,
        'folder': 'inbox',
        'to_addrs': {'$in': addrs or [None]},
        'starred': {'$ne': True},
        'archived': {'$ne': True},
        'opened_at': {'$exists': True, '$ne': None},
        '$or': [
            {'snoozed_until': {'$exists': False}},
            {'snoozed_until': None},
            {'snoozed_until': {'$lte': now_s}},
        ],
    }
    victims = await db.emails.find(q, {'_id': 0, 'id': 1}).to_list(200)
    if not victims:
        return {'deleted': 0, 'ghost_mail': True}
    ids = [v['id'] for v in victims]
    await db.emails.delete_many({'id': {'$in': ids}})
    # Notify via WebSocket so other open sessions refresh
    try:
        await ws_manager.send_to_user(user['id'], {'type': 'mail_deleted', 'ids': ids, 'thread_id': thread_id})
    except Exception:
        pass
    return {'deleted': len(ids), 'ghost_mail': True, 'ids': ids}


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
    return m


@router.patch('/mail/{mail_id}/read')
async def mail_mark_read(mail_id: str, user=Depends(get_current_user)):
    await db.emails.update_one({'id': mail_id}, {'$set': {'read': True}})
    return {'ok': True}


@router.post('/mail/compose')
async def mail_compose(req: ComposeMailReq, user=Depends(get_current_user)):
    if not user.get('email_address'):
        raise HTTPException(400, 'Set up your @w.xyz handle first.')
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

    record = {
        'id': mail_id,
        'owner_id': user['id'],
        'folder': 'sent',
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
        'delivery_status': 'queued',
        'delivery_error': None,
        'message_id': message_id,
        'in_reply_to': req.in_reply_to,
        'thread_id': thread_id,
    }

    if SENDGRID_API_KEY:
        try:
            from sendgrid import SendGridAPIClient
            from sendgrid.helpers.mail import Mail, Email, To, ReplyTo, Content, Attachment, FileContent, FileName, FileType, Disposition, Header as SgHeader
            plain_body = _text_to_plain(body_out or ' ', from_addr)
            html_body = _text_to_html(body_out or ' ', user.get('name') or from_addr)
            msg = Mail(
                from_email=Email(from_addr, user.get('name') or from_addr),
                subject=req.subject or '(no subject)',
                plain_text_content=Content('text/plain', plain_body),
                html_content=Content('text/html', html_body),
            )
            msg.reply_to = ReplyTo(from_addr, user.get('name') or from_addr)
            unsubscribe_url = f'mailto:unsubscribe@{MAIL_DOMAIN}?subject=unsubscribe'
            msg.add_header(SgHeader('List-Unsubscribe', f'<{unsubscribe_url}>'))
            msg.add_header(SgHeader('List-Unsubscribe-Post', 'List-Unsubscribe=One-Click'))
            msg.add_header(SgHeader('X-Mailer', 'W Mail/1.0'))
            for addr in record['to_addrs']:
                msg.add_to(To(addr))
            for a in (req.attachments or []):
                if a.get('content_b64') and a.get('filename'):
                    att = Attachment(
                        FileContent(a['content_b64']),
                        FileName(a['filename']),
                        FileType(a.get('type') or 'application/octet-stream'),
                        Disposition('attachment'),
                    )
                    msg.add_attachment(att)
            sg = SendGridAPIClient(SENDGRID_API_KEY)
            resp = sg.send(msg)
            record['delivery_status'] = 'sent' if resp.status_code in (200, 202) else f'error_{resp.status_code}'
        except Exception as e:
            logger.exception('SendGrid send failed')
            record['delivery_status'] = 'error'
            record['delivery_error'] = str(e)[:300]
    else:
        record['delivery_status'] = 'saved_no_provider'
        record['delivery_error'] = 'SendGrid API key not configured yet; email saved to Sent folder only.'

    await db.emails.insert_one(dict(record))
    if req.draft_id:
        await db.emails.delete_one({'id': req.draft_id, 'owner_id': user['id'], 'folder': 'drafts'})
    return record


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
            data = await f.read() if hasattr(f.read, '__await__') else f.read()
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
            'body_html': _sanitize_html(html),
            'attachments': attachments,
            'read': False,
            'created_at': now_iso(),
            'delivery_status': 'received',
            'message_id': msg_id,
            'in_reply_to': in_reply_to,
            'thread_id': thread_id,
        }
        await db.emails.insert_one(dict(rec))
        stored += 1
        await ws_manager.send_to_user(owner['id'], {'type': 'new_email', 'email': rec})
        # Optional out-of-office auto-reply
        await _maybe_send_auto_reply(owner, sender, subject, in_reply_to=msg_id,
                                       incoming_body=(text or _strip_html(html)))

    return {'ok': True, 'stored': stored}


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
