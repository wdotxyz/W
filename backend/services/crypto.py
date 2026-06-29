"""Application-layer envelope encryption for sensitive mail fields.

Threat model: protects against database-only leaks (DB dump, backup snapshot,
read replica compromise) by ensuring the data at rest is unreadable without
the master key. The master key lives outside MongoDB — either in the
MAIL_ENCRYPTION_KEY env var (preferred) or in a chmod-600 file on disk.

This is NOT zero-access encryption: a fully compromised server can still
read mail because it has the key. For true zero-access (Proton-style) we'd
derive the key from each user's password and decrypt in memory only during
authenticated requests — at the cost of breaking background AI features.

Each ciphertext stored in the DB carries the tag ``enc:v1:<token>`` so we
can roll the format forward and so decrypt is idempotent for legacy
plaintext rows.
"""
from __future__ import annotations

import os
import secrets
from pathlib import Path
from typing import Optional

from cryptography.fernet import Fernet, InvalidToken

from core.db import logger

# ---------------------------------------------------------------------------
# Master key bootstrap
# ---------------------------------------------------------------------------

_KEY_FILE = Path(__file__).resolve().parent.parent / '.encryption_key'
_ENC_PREFIX = 'enc:v1:'


def _load_or_create_master_key() -> Optional[bytes]:
    raw = os.environ.get('MAIL_ENCRYPTION_KEY', '').strip()
    if raw:
        return raw.encode()
    # Fallback: persisted file (created on first run inside the container)
    try:
        if _KEY_FILE.exists():
            return _KEY_FILE.read_bytes().strip()
        new_key = Fernet.generate_key()
        _KEY_FILE.write_bytes(new_key)
        try:
            _KEY_FILE.chmod(0o600)
        except Exception:
            pass
        logger.warning(
            f'Generated new mail-encryption master key at {_KEY_FILE}. '
            f'Move this value to the MAIL_ENCRYPTION_KEY env var for production deploys.'
        )
        return new_key
    except Exception as e:
        logger.error(f'crypto: failed to bootstrap master key: {type(e).__name__}: {e}')
        return None


_MASTER_KEY = _load_or_create_master_key()
_FERNET: Optional[Fernet] = None
try:
    if _MASTER_KEY:
        _FERNET = Fernet(_MASTER_KEY)
except Exception as e:
    logger.error(f'crypto: invalid MAIL_ENCRYPTION_KEY: {e}')
    _FERNET = None


def is_enabled() -> bool:
    return _FERNET is not None


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def encrypt_value(plaintext: Optional[str]) -> Optional[str]:
    """Encrypt a string. Returns ``enc:v1:<token>``. Pass-through for None/empty.

    Idempotent: if value already starts with our prefix, return as-is.
    """
    if plaintext is None or plaintext == '':
        return plaintext
    if not isinstance(plaintext, str):
        return plaintext
    if plaintext.startswith(_ENC_PREFIX):
        return plaintext
    if _FERNET is None:
        return plaintext
    try:
        token = _FERNET.encrypt(plaintext.encode('utf-8')).decode('ascii')
        return _ENC_PREFIX + token
    except Exception as e:
        logger.error(f'crypto.encrypt failed: {type(e).__name__}: {e}')
        return plaintext


def decrypt_value(value: Optional[str]) -> Optional[str]:
    """Decrypt a previously-encrypted string. Pass-through for plaintext
    (so legacy rows continue to work)."""
    if not isinstance(value, str) or not value.startswith(_ENC_PREFIX):
        return value
    if _FERNET is None:
        return value
    try:
        token = value[len(_ENC_PREFIX):].encode('ascii')
        return _FERNET.decrypt(token).decode('utf-8')
    except InvalidToken:
        logger.warning('crypto.decrypt: invalid token — was the master key rotated?')
        return ''
    except Exception as e:
        logger.error(f'crypto.decrypt failed: {type(e).__name__}: {e}')
        return value


# Fields on the email document that contain user-readable text and are
# therefore worth encrypting. Attachments (base64) are kept plaintext for
# v1 — they're already large and the perf hit isn't worth it for MVP.
ENCRYPTED_MAIL_FIELDS = ('subject', 'body', 'body_html')


def encrypt_mail_record(rec: dict) -> dict:
    """In-place encrypt the sensitive fields of an email record before insert."""
    if not rec or _FERNET is None:
        return rec
    for k in ENCRYPTED_MAIL_FIELDS:
        if k in rec:
            rec[k] = encrypt_value(rec.get(k))
    return rec


def decrypt_mail_record(rec: dict) -> dict:
    """In-place decrypt the sensitive fields of an email record after read."""
    if not rec:
        return rec
    for k in ENCRYPTED_MAIL_FIELDS:
        if k in rec:
            rec[k] = decrypt_value(rec.get(k))
    return rec


def decrypt_mail_list(records: list) -> list:
    for r in records:
        decrypt_mail_record(r)
    return records
