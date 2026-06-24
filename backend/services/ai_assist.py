"""Reusable Claude helpers for AI Smart Reply, Compose/Rewrite, Summarize.

Kept separate from `services/ai.py` (which is the chat-assistant conversation handler)
because these are one-shot transactional prompts, not multi-turn sessions.
"""
from typing import List, Optional
import json
import re

from emergentintegrations.llm.chat import LlmChat, UserMessage

from core.config import EMERGENT_LLM_KEY
from core.db import logger

_DEFAULT_MODEL = ('anthropic', 'claude-sonnet-4-5-20250929')


async def _ask_claude(system: str, prompt: str, session_id: str = 'w-ai-assist',
                     max_chars_in: int = 8000) -> str:
    """Single-turn Claude call. Truncates input prompt to keep latency / cost sane."""
    if not EMERGENT_LLM_KEY:
        return ''
    truncated = (prompt or '')[-max_chars_in:]
    chat = LlmChat(
        api_key=EMERGENT_LLM_KEY,
        session_id=session_id,
        system_message=system,
    ).with_model(*_DEFAULT_MODEL)
    out = await chat.send_message(UserMessage(text=truncated))
    return str(out or '').strip()


def _extract_json(text: str) -> Optional[dict]:
    """Best-effort JSON extraction from a Claude response (handles ```json blocks)."""
    if not text:
        return None
    m = re.search(r'```(?:json)?\s*(\{.*?\}|\[.*?\])\s*```', text, flags=re.S)
    raw = m.group(1) if m else text.strip()
    # Find first {...} or [...]
    if not raw.startswith('{') and not raw.startswith('['):
        i = raw.find('{')
        j = raw.find('[')
        if i < 0 and j < 0:
            return None
        start = i if (i >= 0 and (j < 0 or i < j)) else j
        raw = raw[start:]
    try:
        return json.loads(raw)
    except Exception:
        logger.warning(f'AI assist: JSON parse failed; got: {text[:200]!r}')
        return None


# -------------------- Smart Reply --------------------
_SMART_REPLY_SYSTEM = (
    "You are W AI, a writing assistant inside the W messaging & mail app. "
    "Generate 3 short, distinct reply suggestions for the user to send next. "
    "Rules: 1-12 words each. Friendly but professional. Match the tone of the conversation. "
    "Never reveal you are AI. Output STRICT JSON: {\"suggestions\": [\"a\", \"b\", \"c\"]} — no prose."
)


async def smart_reply_suggestions(conversation: List[dict], mode: str = 'chat') -> List[str]:
    """Return up to 3 short reply suggestions for the last message in the conversation."""
    if not conversation:
        return []
    lines = []
    for m in conversation[-12:]:
        who = (m.get('role') or 'them').strip().lower()
        text = (m.get('text') or '').strip()
        if not text:
            continue
        lines.append(f"{'You' if who in ('me', 'self', 'user') else 'Them'}: {text}")
    prompt = (
        f"Conversation channel: {mode}.\n\n"
        + '\n'.join(lines)
        + "\n\nWrite 3 reply suggestions the user could send next. Output JSON only."
    )
    raw = await _ask_claude(_SMART_REPLY_SYSTEM, prompt, session_id='w-smart-reply')
    data = _extract_json(raw) or {}
    out = data.get('suggestions') if isinstance(data, dict) else None
    if not isinstance(out, list):
        return []
    cleaned = [str(s).strip().strip('"\'') for s in out if isinstance(s, (str,)) and str(s).strip()]
    return cleaned[:3]


# -------------------- Compose mail --------------------
_COMPOSE_SYSTEM = (
    "You write polished emails inside the W mail composer. "
    "Given a one-line user intent, return a short email (3-8 sentences). "
    "Use plain text. Don't include 'Subject:' inside the body. "
    "Output STRICT JSON: {\"subject\": \"...\", \"body\": \"...\"}."
)


async def compose_email(prompt: str, tone: str = 'professional') -> dict:
    full = f"Tone: {tone}.\nUser intent: {prompt.strip()}\n\nDraft the email."
    raw = await _ask_claude(_COMPOSE_SYSTEM, full, session_id='w-compose')
    data = _extract_json(raw) or {}
    return {
        'subject': str(data.get('subject') or '').strip()[:200],
        'body': str(data.get('body') or '').strip(),
    }


# -------------------- Rewrite text --------------------
_REWRITE_MODES = {
    'professional': 'Rewrite the text in a polite, professional, business-appropriate tone.',
    'friendly': 'Rewrite the text in a warm, casual, friendly tone (keep it short).',
    'shorten': 'Rewrite the text more concisely. Keep all key facts. Cut filler.',
    'expand': 'Expand the text with helpful detail, while staying on-topic and clear.',
    'fix': 'Fix grammar, spelling, and punctuation. Keep the original tone and meaning.',
}

_REWRITE_SYSTEM = (
    "You are an email rewriting assistant. Return ONLY the rewritten text — no preamble, no quotes, no markdown."
)


async def rewrite_text(text: str, mode: str = 'professional') -> str:
    instr = _REWRITE_MODES.get(mode, _REWRITE_MODES['professional'])
    prompt = f"{instr}\n\n--- TEXT ---\n{text}\n--- END ---"
    out = await _ask_claude(_REWRITE_SYSTEM, prompt, session_id='w-rewrite')
    return (out or '').strip().strip('`').strip('"')


# -------------------- Subject suggestions --------------------
_SUBJECT_SYSTEM = (
    "You generate short, specific email subject lines (4–10 words). "
    "Output STRICT JSON: {\"subjects\": [\"...\", \"...\", \"...\"]} — nothing else."
)


async def suggest_subjects(body: str) -> List[str]:
    raw = await _ask_claude(_SUBJECT_SYSTEM, f"Email body:\n{body}\n\nSuggest 3 subjects.", session_id='w-subject')
    data = _extract_json(raw) or {}
    arr = data.get('subjects') if isinstance(data, dict) else None
    if not isinstance(arr, list):
        return []
    return [str(s).strip().strip('"\'') for s in arr if str(s).strip()][:3]


# -------------------- Thread summarizer --------------------
_SUMMARIZE_SYSTEM = (
    "You summarize email threads for a busy user. Be tight and concrete. "
    "Output STRICT JSON: {\"summary\": \"2-3 sentence recap\", \"action_items\": [\"...\", \"...\"]}. "
    "Action items are things the USER needs to do (or decide). If none, return an empty array."
)


async def summarize_thread(messages: List[dict]) -> dict:
    """Summarize a list of email dicts (each having from_addr/subject/body/created_at)."""
    if not messages:
        return {'summary': '', 'action_items': []}
    blocks = []
    for i, m in enumerate(messages[-30:]):
        sender = m.get('from_name') or m.get('from_addr') or 'Unknown'
        when = (m.get('created_at') or '')[:19].replace('T', ' ')
        body = (m.get('body') or '').strip()
        if len(body) > 2000:
            body = body[:2000] + ' …'
        blocks.append(f"[{i+1}] {sender} on {when}:\n{body}")
    prompt = (
        f"Subject: {messages[0].get('subject') or '(no subject)'}\n"
        f"{len(messages)} messages in thread.\n\n"
        + '\n\n'.join(blocks)
        + '\n\nReturn the JSON now.'
    )
    raw = await _ask_claude(_SUMMARIZE_SYSTEM, prompt, session_id='w-summary', max_chars_in=18000)
    data = _extract_json(raw) or {}
    summary = str(data.get('summary') or '').strip()
    items = data.get('action_items') if isinstance(data, dict) else None
    if not isinstance(items, list):
        items = []
    items = [str(x).strip().lstrip('-• ').strip() for x in items if str(x).strip()][:6]
    return {'summary': summary, 'action_items': items}
