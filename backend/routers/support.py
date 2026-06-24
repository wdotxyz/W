"""Support tickets: contact form submissions stored in MongoDB.

Authenticated users send a subject + message. Stored for triage in db.support_tickets.
"""
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

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

    ticket = {
        'id': str(uuid.uuid4()),
        'user_id': user['id'],
        'user_name': user.get('name') or '',
        'user_email': user.get('email_address') or user.get('fallback_address') or '',
        'reply_to': (req.reply_to or '').strip().lower() or None,
        'category': (req.category or 'general').lower(),
        'subject': subject[:200],
        'message': message[:5000],
        'status': 'open',
        'created_at': now_iso(),
    }
    await db.support_tickets.insert_one(dict(ticket))
    logger.info(f'support: new ticket {ticket["id"]} from {ticket["user_email"]} cat={ticket["category"]}')
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
