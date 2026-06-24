"""Stripe billing client + payment success handler."""
from datetime import timedelta
from typing import Optional

from fastapi import HTTPException
from emergentintegrations.payments.stripe.checkout import StripeCheckout

from core.config import STRIPE_API_KEY
from core.db import db, logger
from core.security import _parse_dt, _utcnow, now_iso
from services.helpers import _user_tier


def _stripe_client(webhook_url: Optional[str] = None) -> StripeCheckout:
    if not STRIPE_API_KEY:
        raise HTTPException(503, 'Billing is not configured yet.')
    return StripeCheckout(api_key=STRIPE_API_KEY, webhook_url=webhook_url)


async def _apply_payment_success(session_id: str) -> dict:
    payment = await db.payments.find_one({'session_id': session_id}, {'_id': 0})
    if not payment:
        return {'applied': False}
    if payment.get('status') == 'paid':
        return {'applied': False, 'duplicate': True}
    user = await db.users.find_one({'id': payment['user_id']}, {'_id': 0})
    if not user:
        return {'applied': False}
    now = _utcnow()
    current_exp = _parse_dt(user.get('tier_expires_at'))
    current_tier = _user_tier(user)
    base = current_exp if (current_exp and current_exp > now and current_tier == payment['tier']) else now
    new_exp = base + timedelta(days=int(payment['days']))
    await db.users.update_one({'id': user['id']}, {'$set': {
        'tier': payment['tier'],
        'tier_expires_at': new_exp.isoformat(),
        'tier_updated_at': now.isoformat(),
        'last_payment_session': session_id,
    }})
    await db.payments.update_one({'session_id': session_id},
                                  {'$set': {'status': 'paid', 'paid_at': now.isoformat()}})
    logger.info(f"Billing: user={user['id']} upgraded to {payment['tier']} until {new_exp.isoformat()}")
    return {'applied': True, 'tier': payment['tier'], 'expires_at': new_exp.isoformat()}
