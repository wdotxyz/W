"""Admin-only stats endpoint for the W support team.

Reads email volume from MongoDB and surfaces a SendGrid → AWS SES
migration recommendation based on projected monthly volume.

Only users with is_support=True (the seeded support@w.xyz account)
can access these endpoints.
"""
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException

from core.db import db
from core.security import get_current_user

router = APIRouter()


def _require_support(user: dict) -> None:
    if not user.get('is_support'):
        raise HTTPException(403, 'Support team access only.')


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _iso(dt: datetime) -> str:
    return dt.isoformat()


# --- Pricing (June 2026) -----------------------------------------------------
SENDGRID_TIERS = [
    (100 * 30, 0.00),     # Free: 100/day ≈ 3,000/month
    (50_000, 19.95),      # Essentials
    (100_000, 89.95),     # Pro
    (1_500_000, 249.00),  # Premier (approx)
]

SES_PER_THOUSAND = 0.10  # $/1k emails (non-EC2)
SES_INBOUND_PER_THOUSAND = 0.10


def _sendgrid_cost(monthly_volume: int) -> float:
    """Return the SendGrid plan price for a projected monthly volume."""
    for cap, price in SENDGRID_TIERS:
        if monthly_volume <= cap:
            return price
    return SENDGRID_TIERS[-1][1]


def _ses_cost(monthly_volume: int, monthly_inbound: int = 0) -> float:
    return ((monthly_volume + monthly_inbound) / 1000.0) * SES_PER_THOUSAND


def _recommendation(monthly_volume: int, savings: float) -> dict:
    if monthly_volume < 1_000:
        return {
            'verdict': 'stay',
            'headline': 'Stay on SendGrid',
            'body': "You're well under 1k emails/month. Migration isn't worth the engineering time yet.",
        }
    if savings < 15:
        return {
            'verdict': 'stay',
            'headline': 'Stay on SendGrid for now',
            'body': f"Projected savings on SES are only ~${savings:.2f}/mo. Wait until savings exceed $15/mo to justify the migration effort.",
        }
    if savings < 80:
        return {
            'verdict': 'plan',
            'headline': 'Start planning the SES migration',
            'body': f"You'd save ~${savings:.2f}/mo on AWS SES. Consider migrating outbound to SES (4–8h dev) while keeping SendGrid inbound parse.",
        }
    return {
        'verdict': 'migrate',
        'headline': 'Time to migrate to AWS SES',
        'body': f"At your volume you're overspending by ~${savings:.2f}/mo. Move outbound (and ideally inbound) to AWS SES to cut email costs by ~{int(((1 - _ses_cost(monthly_volume)/max(_sendgrid_cost(monthly_volume), 0.01)) * 100))}%.",
    }


@router.get('/admin/stats')
async def admin_stats(user=Depends(get_current_user)):
    _require_support(user)
    now = _utcnow()
    cutoff_24h = _iso(now - timedelta(hours=24))
    cutoff_7d = _iso(now - timedelta(days=7))
    cutoff_30d = _iso(now - timedelta(days=30))

    # Email volume
    sent_24h = await db.emails.count_documents({'folder': 'sent', 'created_at': {'$gte': cutoff_24h}})
    sent_7d = await db.emails.count_documents({'folder': 'sent', 'created_at': {'$gte': cutoff_7d}})
    sent_30d = await db.emails.count_documents({'folder': 'sent', 'created_at': {'$gte': cutoff_30d}})
    inbox_24h = await db.emails.count_documents({'folder': 'inbox', 'created_at': {'$gte': cutoff_24h}})
    inbox_7d = await db.emails.count_documents({'folder': 'inbox', 'created_at': {'$gte': cutoff_7d}})
    inbox_30d = await db.emails.count_documents({'folder': 'inbox', 'created_at': {'$gte': cutoff_30d}})

    # User & ticket counts
    total_users = await db.users.count_documents({})
    new_users_7d = await db.users.count_documents({'created_at': {'$gte': cutoff_7d}})
    open_tickets = await db.support_tickets.count_documents({'status': 'open'})
    total_tickets = await db.support_tickets.count_documents({})

    # Projected monthly volume (linear projection from last 7 days, ×30/7)
    projected_outbound = int(round((sent_7d / 7) * 30)) if sent_7d > 0 else sent_30d
    projected_inbound = int(round((inbox_7d / 7) * 30)) if inbox_7d > 0 else inbox_30d
    projected_total = projected_outbound + projected_inbound

    sendgrid_cost = _sendgrid_cost(projected_outbound)
    ses_cost = _ses_cost(projected_outbound, projected_inbound)
    savings = max(0.0, sendgrid_cost - ses_cost)

    rec = _recommendation(projected_outbound, savings)

    return {
        'as_of': _iso(now),
        'volume': {
            'outbound': {'h24': sent_24h, 'd7': sent_7d, 'd30': sent_30d},
            'inbound':  {'h24': inbox_24h, 'd7': inbox_7d, 'd30': inbox_30d},
        },
        'projection': {
            'monthly_outbound': projected_outbound,
            'monthly_inbound': projected_inbound,
            'monthly_total': projected_total,
            'basis': 'Linear projection from last 7 days × 30',
        },
        'pricing': {
            'sendgrid_monthly': round(sendgrid_cost, 2),
            'ses_monthly': round(ses_cost, 2),
            'savings_monthly': round(savings, 2),
            'savings_annual': round(savings * 12, 2),
        },
        'recommendation': rec,
        'users': {'total': total_users, 'new_7d': new_users_7d},
        'support': {'open_tickets': open_tickets, 'total_tickets': total_tickets},
    }
