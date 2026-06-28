"""Tiny SendGrid wrapper used by recovery-email OTP, auto-replies, etc.

The compose endpoint constructs its own richer Mail() with attachments and
headers — this helper is for small transactional system emails only.
"""
from typing import Optional

from core.config import MAIL_DOMAIN, MAIL_FROM_DEFAULT, SENDGRID_API_KEY
from core.db import logger


def send_system_email(
    to_email: str,
    subject: str,
    text_body: str,
    html_body: Optional[str] = None,
    from_email: Optional[str] = None,
    from_name: str = 'W',
    reply_to: Optional[str] = None,
) -> bool:
    """Send a small transactional email. Returns True on success.

    Returns False (and logs) if SendGrid isn't configured or the send fails —
    callers should treat that as a soft failure (e.g. for OTPs, show a dev fallback).
    """
    if not SENDGRID_API_KEY:
        logger.info(f"[system-email skipped: no SENDGRID_API_KEY] to={to_email} subject={subject!r}")
        return False
    try:
        from sendgrid import SendGridAPIClient
        from sendgrid.helpers.mail import Mail, Email, To, ReplyTo, Content, Header as SgHeader
        sender = from_email or MAIL_FROM_DEFAULT
        msg = Mail(
            from_email=Email(sender, from_name),
            to_emails=To(to_email),
            subject=subject,
            plain_text_content=Content('text/plain', text_body),
        )
        if html_body:
            msg.add_content(Content('text/html', html_body))
        if reply_to:
            msg.reply_to = ReplyTo(reply_to)
        msg.add_header(SgHeader('X-Mailer', 'W Mail/1.0'))
        msg.add_header(SgHeader('Auto-Submitted', 'auto-generated'))
        sg = SendGridAPIClient(SENDGRID_API_KEY)
        resp = sg.send(msg)
        ok = resp.status_code in (200, 202)
        if not ok:
            logger.warning(f"SendGrid system_email status={resp.status_code} to={to_email}")
        return ok
    except Exception as e:
        logger.exception(f"SendGrid system_email failed to={to_email}: {e}")
        return False
