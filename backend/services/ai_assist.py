"""Reusable Claude helpers for AI Smart Reply, Compose/Rewrite, Summarize.

Kept separate from `services/ai.py` (which is the chat-assistant conversation handler)
because these are one-shot transactional prompts, not multi-turn sessions.
"""
import base64
import os
import tempfile
from typing import Dict, List, Optional
import json
import re

from emergentintegrations.llm.chat import LlmChat, UserMessage
from emergentintegrations.llm.openai.speech_to_text import OpenAISpeechToText

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



# -------------------- Voice → Email (Whisper STT + Claude polish) --------------------
_AUDIO_EXT_BY_MIME = {
    'audio/m4a': 'm4a', 'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a',
    'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/mpga': 'mpga',
    'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/wave': 'wav',
    'audio/webm': 'webm', 'audio/ogg': 'webm', 'audio/aac': 'm4a',
}


async def transcribe_audio_b64(audio_b64: str, mime_type: str = 'audio/m4a') -> str:
    """Decode base64 audio, write to a temp file, transcribe with Whisper."""
    if not EMERGENT_LLM_KEY:
        return ''
    if not audio_b64:
        return ''
    if audio_b64.startswith('data:'):
        audio_b64 = audio_b64.split(',', 1)[-1]
    try:
        raw = base64.b64decode(audio_b64)
    except Exception:
        raise ValueError('Audio payload is not valid base64.')
    ext = _AUDIO_EXT_BY_MIME.get((mime_type or '').lower(), 'm4a')
    tmp = tempfile.NamedTemporaryFile(prefix='w-voice-', suffix=f'.{ext}', delete=False)
    try:
        tmp.write(raw)
        tmp.flush()
        tmp.close()
        stt = OpenAISpeechToText(api_key=EMERGENT_LLM_KEY)
        # NOTE: Pass an opened file handle — emergentintegrations / litellm's
        # OpenAI client expects bytes/IO, not a path string. Passing a string
        # path triggers: "Expected entry at `file` to be bytes, io.IOBase…".
        with open(tmp.name, 'rb') as fh:
            resp = await stt.transcribe(file=fh, model='whisper-1', response_format='json')
        text = getattr(resp, 'text', None)
        if text is None and isinstance(resp, dict):
            text = resp.get('text')
        return (text or '').strip()
    finally:
        try:
            os.unlink(tmp.name)
        except Exception:
            pass


_VOICE_TO_EMAIL_SYSTEM = (
    "You take a quickly-spoken voice memo and turn it into a polished email. "
    "Fix grammar, remove filler words, structure into 1-3 short paragraphs. "
    "Output STRICT JSON: {\"subject\": \"...\", \"body\": \"...\"}."
)


async def voice_to_email(transcript: str) -> dict:
    if not transcript or not transcript.strip():
        return {'subject': '', 'body': '', 'transcript': transcript}
    raw = await _ask_claude(_VOICE_TO_EMAIL_SYSTEM, f"Voice memo:\n{transcript}", session_id='w-voice-to-email')
    data = _extract_json(raw) or {}
    return {
        'subject': str(data.get('subject') or '').strip()[:200],
        'body': str(data.get('body') or transcript).strip(),
        'transcript': transcript,
    }


# -------------------- Smart Auto-Reply (Pro) --------------------
_AI_AUTOREPLY_SYSTEM = (
    "You are writing a polite, concise auto-reply on behalf of the user. "
    "Acknowledge the incoming message in 1-2 short paragraphs. "
    "If a clear action is requested, briefly say when the user will respond or what to expect. "
    "Don't make up facts or commitments. "
    "Output ONLY the reply text — no JSON, no preamble."
)


async def ai_compose_reply(owner: dict, incoming_subject: str, incoming_body: str,
                            note: Optional[str] = None) -> str:
    name = (owner or {}).get('name') or 'the recipient'
    prompt = (
        f"Write the reply on behalf of {name}.\n"
        + (f"User's note (optional context): {note}\n" if note else '')
        + f"\n--- Incoming subject ---\n{incoming_subject}\n"
        + f"\n--- Incoming body ---\n{(incoming_body or '')[:6000]}\n\n"
        + 'Now write the reply.'
    )
    out = await _ask_claude(_AI_AUTOREPLY_SYSTEM, prompt, session_id='w-ai-autoreply')
    return (out or '').strip().strip('`').strip('"')


# -------------------- Action Extractor --------------------
_ACTIONS_SYSTEM = (
    "You scan a user's email threads and extract concrete action items they need to do.\n"
    "For each action, infer a due_date if mentioned (ISO 8601, e.g. 2026-07-15 or 2026-07-15T14:00:00). "
    "Set type to 'task', 'meeting', or 'deadline'.\n"
    "Skip newsletters, marketing emails, and FYI-only messages. "
    "Output STRICT JSON: {\"actions\": [{\"title\":\"...\",\"due_date\":\"...\"|null,\"type\":\"...\",\"source_thread_id\":\"...\",\"source_subject\":\"...\"}]}"
)


async def extract_actions(threads: List[Dict]) -> List[Dict]:
    """Given a list of {thread_id, subject, messages:[{from_addr,body}]}, return action items."""
    if not threads:
        return []
    blocks = []
    for t in threads[:15]:
        msg_summary = []
        for m in (t.get('messages') or [])[:4]:
            body = (m.get('body') or '').strip()[:1200]
            msg_summary.append(f"From {m.get('from_addr') or 'unknown'}: {body}")
        blocks.append(
            f"---\nthread_id: {t.get('thread_id')}\nsubject: {t.get('subject') or '(no subject)'}\n"
            + '\n\n'.join(msg_summary)
        )
    prompt = '\n\n'.join(blocks) + '\n\nReturn the JSON now.'
    raw = await _ask_claude(_ACTIONS_SYSTEM, prompt, session_id='w-actions', max_chars_in=24000)
    data = _extract_json(raw) or {}
    items = data.get('actions') if isinstance(data, dict) else None
    if not isinstance(items, list):
        return []
    cleaned: List[Dict] = []
    for it in items[:20]:
        if not isinstance(it, dict):
            continue
        title = str(it.get('title') or '').strip()
        if not title:
            continue
        cleaned.append({
            'title': title[:240],
            'due_date': (str(it.get('due_date')).strip() if it.get('due_date') else None),
            'type': str(it.get('type') or 'task').lower(),
            'source_thread_id': str(it.get('source_thread_id') or '').strip(),
            'source_subject': str(it.get('source_subject') or '').strip()[:200],
        })
    return cleaned


async def ai_classify_email(email: Dict) -> Optional[Dict]:
    """Classify a single incoming email into one of: inbox | spam | promotions.

    Returns {category, confidence, reason} or None if classification failed.
    Used by the inbound webhook to auto-route mail. Conservative — defaults to
    inbox for anything uncertain.
    """
    if not EMERGENT_LLM_KEY or not email:
        return None
    payload = {
        'from': f"{email.get('from_name') or ''} <{email.get('from_addr') or ''}>".strip(),
        'subject': (email.get('subject') or '')[:200],
        'preview': (email.get('body') or '').replace('\n', ' ')[:600],
    }
    system = (
        "You are a careful email triage assistant. Read ONE email and decide which "
        "folder it belongs in: 'inbox', 'spam', or 'promotions'.\n\n"
        "RULES:\n"
        "- 'spam'        → phishing, scams, fake delivery / billing fraud, crypto "
        "                  schemes, lookalike domains, sender impersonation, obvious junk.\n"
        "- 'promotions'  → legitimate but commercial: newsletters, marketing blasts, "
        "                  product launches, sales/discount/coupon emails, deals, "
        "                  recommendation digests, referral campaigns, brand updates.\n"
        "- 'inbox'       → personal mail, transactional (receipts, invoices, account "
        "                  alerts, OTPs, shipping confirmations), threaded replies, "
        "                  anything that needs the user's attention.\n\n"
        "Be conservative. When uncertain, prefer 'inbox'. Return ONLY this JSON:\n"
        '{"category": "inbox"|"spam"|"promotions", "confidence": 0.0-1.0, "reason": "<short>"}'
    )
    prompt = f"Classify this email:\n\n{json.dumps(payload, ensure_ascii=False)}"
    try:
        raw = await _ask_claude(system, prompt, session_id='w-ai-triage', max_chars_in=4000)
    except Exception as e:
        logger.error(f'ai_classify_email failed: {type(e).__name__}: {str(e)[:120]}')
        return None
    if not raw:
        return None
    m = re.search(r'\{[\s\S]*\}', raw)
    if not m:
        return None
    try:
        parsed = json.loads(m.group(0))
    except Exception:
        return None
    cat = str(parsed.get('category') or 'inbox').lower().strip()
    if cat not in ('inbox', 'spam', 'promotions'):
        cat = 'inbox'
    try:
        conf = float(parsed.get('confidence') or 0.0)
    except Exception:
        conf = 0.0
    return {
        'category': cat,
        'confidence': max(0.0, min(1.0, conf)),
        'reason': str(parsed.get('reason') or '')[:200],
    }


async def ai_spam_check(emails: List[Dict]) -> List[Dict]:
    """Classify a batch of emails as spam or not_spam using Claude.

    Each input email should have keys: id, from_addr, from_name, subject, body.
    Returns a list of {id, is_spam, confidence, reason} for each email Claude
    can confidently classify; emails it doesn't return are treated as not_spam.
    """
    if not EMERGENT_LLM_KEY or not emails:
        return []

    items = []
    for e in emails[:25]:  # keep prompts small
        items.append({
            'id': str(e.get('id') or ''),
            'from': f"{e.get('from_name') or ''} <{e.get('from_addr') or ''}>".strip(),
            'subject': (e.get('subject') or '')[:160],
            'preview': (e.get('body') or '').replace('\n', ' ')[:400],
        })

    system = (
        "You are a friendly, accurate email spam classifier. Flag obvious junk: "
        "phishing attempts, sketchy crypto/financial schemes, fake delivery / "
        "billing scams, bulk marketing the user clearly didn't sign up for, "
        "lookalike domains, sender impersonation. Do NOT flag legitimate "
        "newsletters the user might be subscribed to, transactional receipts, "
        "personal mail, or anything you're not sure about. Be conservative — "
        "when in doubt, mark not_spam.\n\n"
        "Return ONLY valid JSON in this exact shape:\n"
        '{"results": [{"id": "<email-id>", "is_spam": true|false, "confidence": 0.0-1.0, "reason": "<short>"}]}\n'
        "Include EVERY email id you were given."
    )
    prompt = f"Classify these {len(items)} emails:\n\n{json.dumps(items, ensure_ascii=False)}"

    try:
        raw = await _ask_claude(system, prompt, session_id='w-ai-spam', max_chars_in=12000)
    except Exception as e:
        logger.error(f'ai_spam_check failed: {type(e).__name__}: {str(e)[:120]}')
        return []
    if not raw:
        return []

    # extract first JSON object
    m = re.search(r'\{[\s\S]*\}', raw)
    if not m:
        return []
    try:
        parsed = json.loads(m.group(0))
    except Exception:
        return []

    out: List[Dict] = []
    for r in (parsed.get('results') or [])[:30]:
        eid = str(r.get('id') or '').strip()
        if not eid:
            continue
        try:
            conf = float(r.get('confidence') or 0.0)
        except Exception:
            conf = 0.0
        out.append({
            'id': eid,
            'is_spam': bool(r.get('is_spam')),
            'confidence': max(0.0, min(1.0, conf)),
            'reason': str(r.get('reason') or '')[:200],
        })
    return out
