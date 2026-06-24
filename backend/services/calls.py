"""Daily.co REST API client."""
from typing import Optional

import httpx
from fastapi import HTTPException

from core.config import DAILY_API_KEY, DAILY_API_BASE
from core.db import logger


async def _daily_request(method: str, path: str, json_body: Optional[dict] = None) -> dict:
    if not DAILY_API_KEY:
        raise HTTPException(503, 'Calls are not configured yet.')
    headers = {'Authorization': f'Bearer {DAILY_API_KEY}', 'Content-Type': 'application/json'}
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.request(method, f'{DAILY_API_BASE}{path}', headers=headers, json=json_body)
    if r.status_code >= 400:
        logger.warning(f'Daily {method} {path} -> {r.status_code} {r.text[:200]}')
        raise HTTPException(502, f'Call provider error: {r.text[:120]}')
    return r.json() if r.text else {}
