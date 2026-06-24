"""Stripe billing endpoints."""
import os
import uuid

from fastapi import APIRouter, Depends, HTTPException, Request
from emergentintegrations.payments.stripe.checkout import CheckoutSessionRequest

from core.config import PLAN_CATALOG, TIER_STORAGE_GB
from core.db import db, logger
from core.security import get_current_user, now_iso
from models.schemas import CheckoutReq
from services.billing import _apply_payment_success, _stripe_client
from services.helpers import _user_tier

router = APIRouter()


@router.get('/billing/plans')
async def billing_plans():
    return {
        'currency': 'usd',
        'plans': [
            {'tier': 'free', 'label': 'Free', 'monthly': 0, 'yearly': 0,
             'storage_gb': TIER_STORAGE_GB['free'],
             'perks': ['1 GB storage', 'Custom @w.xyz address', '6+ character handles']},
            {'tier': 'plus', 'label': 'Plus',
             'monthly': PLAN_CATALOG[('plus', 'month')]['amount'],
             'yearly':  PLAN_CATALOG[('plus', 'year')]['amount'],
             'storage_gb': TIER_STORAGE_GB['plus'],
             'perks': ['50 GB storage', '5-character handles', 'Blue check ✓', 'Priority support']},
            {'tier': 'pro', 'label': 'Pro',
             'monthly': PLAN_CATALOG[('pro', 'month')]['amount'],
             'yearly':  PLAN_CATALOG[('pro', 'year')]['amount'],
             'storage_gb': TIER_STORAGE_GB['pro'],
             'perks': ['100 GB storage', '4 & 5-character handles', 'Blue check ✓', 'Priority support']},
        ],
    }


@router.get('/billing/me')
async def billing_me(user=Depends(get_current_user)):
    tier = _user_tier(user)
    used = int(user.get('storage_used_bytes', 0) or 0)
    limit = TIER_STORAGE_GB.get(tier, 1) * 1024 * 1024 * 1024
    return {
        'tier': tier,
        'tier_label': tier.capitalize(),
        'tier_expires_at': user.get('tier_expires_at'),
        'storage_gb': TIER_STORAGE_GB.get(tier, 1),
        'storage_used_bytes': used,
        'storage_limit_bytes': limit,
        'storage_percent': round((used / limit) * 100, 1) if limit else 0,
        'has_blue_check': tier in ('plus', 'pro'),
    }


@router.post('/billing/checkout')
async def billing_checkout(req: CheckoutReq, request: Request, user=Depends(get_current_user)):
    key = (req.tier, req.interval)
    if key not in PLAN_CATALOG:
        raise HTTPException(400, 'Invalid plan selection.')
    plan = PLAN_CATALOG[key]
    origin = request.headers.get('origin') or os.environ.get('APP_PUBLIC_URL', '').rstrip('/')
    if not origin:
        raise HTTPException(500, 'APP_PUBLIC_URL not configured.')
    success_url = f"{origin}/billing/success?session_id={{CHECKOUT_SESSION_ID}}"
    cancel_url = f"{origin}/billing/cancel"
    webhook_url = f"{origin}/api/billing/webhook"

    sc = _stripe_client(webhook_url=webhook_url)
    csr = CheckoutSessionRequest(
        amount=plan['amount'], currency='usd',
        success_url=success_url, cancel_url=cancel_url,
        metadata={'user_id': user['id'], 'tier': plan['tier'],
                  'interval': req.interval, 'days': str(plan['days'])},
    )
    session = await sc.create_checkout_session(csr)
    await db.payments.insert_one({
        'id': str(uuid.uuid4()), 'session_id': session.session_id,
        'user_id': user['id'], 'tier': plan['tier'], 'interval': req.interval,
        'days': plan['days'], 'amount': plan['amount'], 'currency': 'usd',
        'status': 'pending', 'created_at': now_iso(), 'label': plan['label'],
    })
    return {'url': session.url, 'session_id': session.session_id}


@router.get('/billing/status/{session_id}')
async def billing_status(session_id: str, user=Depends(get_current_user)):
    payment = await db.payments.find_one({'session_id': session_id}, {'_id': 0})
    if not payment or payment.get('user_id') != user['id']:
        raise HTTPException(404, 'Session not found.')
    if payment.get('status') == 'paid':
        return {'status': 'paid', 'tier': payment['tier']}
    try:
        sc = _stripe_client()
        s = await sc.get_checkout_status(session_id)
        if s.payment_status == 'paid':
            await _apply_payment_success(session_id)
            return {'status': 'paid', 'tier': payment['tier']}
        return {'status': s.payment_status or s.status or 'pending'}
    except Exception as e:
        logger.warning(f'billing/status reconcile error: {e}')
        return {'status': 'pending'}


@router.post('/billing/webhook')
async def billing_webhook(request: Request):
    payload = await request.body()
    sig = request.headers.get('stripe-signature')
    try:
        sc = _stripe_client()
        evt = await sc.handle_webhook(payload, signature=sig)
    except Exception as e:
        logger.warning(f'Webhook verify failed: {e}')
        raise HTTPException(400, 'Invalid webhook')
    try:
        await db.billing_events.insert_one({'id': evt.event_id, 'type': evt.event_type, 'at': now_iso()})
    except Exception:
        return {'ok': True, 'duplicate': True}
    if evt.event_type in ('checkout.session.completed', 'payment_intent.succeeded') and evt.payment_status == 'paid' and evt.session_id:
        await _apply_payment_success(evt.session_id)
    return {'ok': True}
