"""Support tickets: contact form submissions stored in MongoDB and
also dropped into the support@w.xyz Inbox so the team can reply from the app."""
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from core.config import MAIL_DOMAIN
from core.db import db, logger
from core.security import get_current_user, now_iso

router = APIRouter()


class SupportContactReq(BaseModel):
    subject: str
    message: str
    category: Optional[str] = 'general'  # general | bug | billing | feature | account
    reply_to: Optional[str] = None  # override email for response


@router.post('/support/contact')
async def support_contact(req: SupportContactReq, user=Depends(get_current_user)):
    subject = (req.subject or '').strip()
    message = (req.message or '').strip()
    if len(subject) < 3:
        raise HTTPException(400, 'Please add a short subject (3+ characters).')
    if len(message) < 10:
        raise HTTPException(400, 'Please describe your issue (at least 10 characters).')
    if len(subject) > 200:
        raise HTTPException(400, 'Subject is too long (max 200 characters).')
    if len(message) > 5000:
        raise HTTPException(400, 'Message is too long (max 5000 characters).')

    sender_addr = user.get('email_address') or user.get('fallback_address') or ''
    sender_name = user.get('name') or sender_addr
    category = (req.category or 'general').lower()

    ticket = {
        'id': str(uuid.uuid4()),
        'user_id': user['id'],
        'user_name': sender_name,
        'user_email': sender_addr,
        'reply_to': (req.reply_to or '').strip().lower() or None,
        'category': category,
        'subject': subject[:200],
        'message': message[:5000],
        'status': 'open',
        'created_at': now_iso(),
    }
    await db.support_tickets.insert_one(dict(ticket))

    # Drop the ticket directly into support@w.xyz's Inbox so the support team
    # can read & reply using the regular Inbox UI — no SendGrid round-trip needed.
    support_addr = f'support@{MAIL_DOMAIN}'
    support_user = await db.users.find_one({'email_address': support_addr}, {'_id': 0, 'id': 1})
    if support_user:
        mail_id = str(uuid.uuid4())
        message_id = f'<{mail_id}@{MAIL_DOMAIN}>'
        prefix = f'[{category.upper()}] ' if category != 'general' else ''
        body = f"{message}\n\n— Sent from W Help & Support form\nUser: {sender_name} <{sender_addr or '(no address)'}>"
        await db.emails.insert_one({
            'id': mail_id,
            'owner_id': support_user['id'],
            'folder': 'inbox',
            'from_addr': sender_addr or 'noreply@w.xyz',
            'from_name': sender_name,
            'from_tier': 'free',
            'to_addrs': [support_addr],
            'subject': f'{prefix}{subject}'[:200],
            'body': body,
            'body_html': '',
            'attachments': [],
            'read': False,
            'created_at': now_iso(),
            'message_id': message_id,
            'thread_id': message_id,
            'ticket_id': ticket['id'],
        })

    logger.info(f"support: new ticket {ticket['id']} from {sender_addr} cat={category}")
    return {
        'ok': True,
        'ticket_id': ticket['id'],
        'message': "Thanks — we've got your message and will reply within 1 business day.",
    }


@router.get('/support/my-tickets')
async def list_my_tickets(user=Depends(get_current_user)):
    items = (
        await db.support_tickets.find({'user_id': user['id']}, {'_id': 0})
        .sort('created_at', -1)
        .to_list(50)
    )
    return {'tickets': items}
