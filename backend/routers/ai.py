"""AI assist endpoints: smart-reply, compose, rewrite, summarize-thread.

Uses the Emergent LLM key + Claude Sonnet 4.5.
"""
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from core.db import db
from services.crypto import decrypt_mail_list, decrypt_mail_record
from core.security import get_current_user, now_iso
from services.ai_assist import (
    ai_spam_check, compose_email, extract_actions, rewrite_text,
    smart_reply_suggestions, suggest_subjects, summarize_thread,
    transcribe_audio_b64, voice_to_email,
)

router = APIRouter()


class SmartReplyMsg(BaseModel):
    role: str  # 'me' or 'them'
    text: str


class SmartReplyReq(BaseModel):
    messages: List[SmartReplyMsg]
    mode: str = 'chat'  # 'chat' | 'mail'


class ComposeMailReq(BaseModel):
    prompt: str
    tone: Optional[str] = 'professional'


class RewriteReq(BaseModel):
    text: str
    mode: str = 'professional'  # professional | friendly | shorten | expand | fix


class SubjectReq(BaseModel):
    body: str


@router.post('/ai/smart-reply')
async def smart_reply(req: SmartReplyReq, user=Depends(get_current_user)):
    convo = [m.dict() for m in req.messages]
    suggestions = await smart_reply_suggestions(convo, mode=req.mode)
    return {'suggestions': suggestions}


@router.post('/ai/smart-reply/chat/{chat_id}')
async def smart_reply_for_chat(chat_id: str, user=Depends(get_current_user)):
    """Auto-load the last N messages from a chat and suggest 3 replies."""
    chat = await db.chats.find_one({'id': chat_id, 'member_ids': user['id']}, {'_id': 0})
    if not chat:
        raise HTTPException(404, 'Chat not found')
    msgs = await db.messages.find(
        {'chat_id': chat_id, 'type': 'text'}, {'_id': 0}
    ).sort('created_at', -1).to_list(12)
    msgs.reverse()
    if not msgs:
        return {'suggestions': []}
    convo = [
        {'role': 'me' if m.get('sender_id') == user['id'] else 'them',
         'text': m.get('content', '')}
        for m in msgs
    ]
    suggestions = await smart_reply_suggestions(convo, mode='chat')
    return {'suggestions': suggestions}


@router.post('/ai/compose-mail')
async def ai_compose_mail(req: ComposeMailReq, user=Depends(get_current_user)):
    if not req.prompt or len(req.prompt.strip()) < 3:
        raise HTTPException(400, 'Please describe what to write (3+ characters).')
    out = await compose_email(req.prompt.strip(), tone=req.tone or 'professional')
    if not out.get('body'):
        raise HTTPException(502, "AI couldn't generate a draft right now. Try again.")
    return out


@router.post('/ai/rewrite')
async def ai_rewrite(req: RewriteReq, user=Depends(get_current_user)):
    if not req.text or len(req.text.strip()) < 1:
        raise HTTPException(400, 'No text to rewrite.')
    out = await rewrite_text(req.text, mode=req.mode)
    if not out:
        raise HTTPException(502, "AI couldn't rewrite that right now. Try again.")
    return {'text': out}


@router.post('/ai/subject')
async def ai_subjects(req: SubjectReq, user=Depends(get_current_user)):
    if not req.body or len(req.body.strip()) < 5:
        raise HTTPException(400, 'Write a little body content first.')
    subjects = await suggest_subjects(req.body)
    return {'subjects': subjects}


@router.post('/ai/summarize-thread/{thread_id}')
async def ai_summarize_thread(thread_id: str, user=Depends(get_current_user)):
    addr = (user.get('email_address') or '').lower()
    fb = (user.get('fallback_address') or '').lower()
    addrs = [a for a in [addr, fb] if a]
    q = {'thread_id': thread_id,
         '$or': [{'owner_id': user['id']}, {'to_addrs': {'$in': addrs or [None]}}]}
    msgs = decrypt_mail_list(await db.emails.find(q, {'_id': 0}).sort('created_at', 1).to_list(50))
    if not msgs:
        raise HTTPException(404, 'Thread not found')
    out = await summarize_thread(msgs)
    return out


# -------------------- Voice → Email --------------------
class VoiceReq(BaseModel):
    audio_b64: str
    mime_type: Optional[str] = 'audio/m4a'
    polish: bool = True  # Run Claude polish after Whisper


@router.post('/ai/voice-to-email')
async def ai_voice_to_email(req: VoiceReq, user=Depends(get_current_user)):
    if not req.audio_b64:
        raise HTTPException(400, 'No audio payload.')
    try:
        transcript = await transcribe_audio_b64(req.audio_b64, req.mime_type or 'audio/m4a')
    except ValueError as ve:
        raise HTTPException(400, str(ve))
    except Exception as e:
        raise HTTPException(502, f'Transcription failed: {str(e)[:160]}')
    transcript = (transcript or '').strip()
    if not transcript:
        raise HTTPException(422, "Couldn't transcribe that — please try again.")
    if not req.polish:
        return {'transcript': transcript, 'subject': '', 'body': transcript}
    polished = await voice_to_email(transcript)
    return polished


# -------------------- Action Extractor --------------------
@router.get('/ai/actions')
async def ai_actions(user=Depends(get_current_user)):
    addr = (user.get('email_address') or '').lower()
    fb = (user.get('fallback_address') or '').lower()
    addrs = [a for a in [addr, fb] if a]
    if not addrs:
        return {'actions': []}
    # Pull most recent inbox + starred — 25 emails max, then group by thread
    emails = decrypt_mail_list(await db.emails.find(
        {'to_addrs': {'$in': addrs}, 'folder': 'inbox',
         'archived': {'$ne': True}, '$or': [{'snoozed_until': {'$exists': False}}, {'snoozed_until': None}]},
        {'_id': 0},
    ).sort('created_at', -1).to_list(25))
    threads: dict = {}
    for m in emails:
        tid = m.get('thread_id') or m.get('id')
        if tid not in threads:
            threads[tid] = {'thread_id': tid, 'subject': m.get('subject') or '(no subject)', 'messages': []}
        threads[tid]['messages'].append({'from_addr': m.get('from_addr'), 'body': m.get('body')})
    actions = await extract_actions(list(threads.values()))
    return {'actions': actions}


# --- Spam scanning ----------------------------------------------------------
async def _user_addrs(user: dict) -> list:
    addr = (user.get('email_address') or '').lower()
    fb = (user.get('fallback_address') or '').lower()
    return [a for a in [addr, fb] if a]


@router.post('/ai/scan-inbox-spam')
async def scan_inbox_for_spam(user=Depends(get_current_user)):
    """Run Claude over the last ~25 inbox emails and move spam to the spam folder."""
    addrs = await _user_addrs(user)
    if not addrs:
        return {'scanned': 0, 'moved': 0, 'results': []}
    msgs = decrypt_mail_list(await db.emails.find(
        {'to_addrs': {'$in': addrs}, 'folder': 'inbox', 'archived': {'$ne': True}, 'starred': {'$ne': True}},
        {'_id': 0, 'id': 1, 'from_addr': 1, 'from_name': 1, 'subject': 1, 'body': 1},
    ).sort('created_at', -1).to_list(25))

    if not msgs:
        return {'scanned': 0, 'moved': 0, 'results': []}

    results = await ai_spam_check(msgs)
    moved_ids = [r['id'] for r in results if r.get('is_spam') and r.get('confidence', 0) >= 0.65]
    if moved_ids:
        # Build a reason map for each spam id
        reason_map = {r['id']: r.get('reason', '') for r in results if r.get('is_spam')}
        # Update one at a time so we can set per-mail reason
        for mid in moved_ids:
            await db.emails.update_one(
                {'id': mid, 'to_addrs': {'$in': addrs}},
                {'$set': {'folder': 'spam', 'spam_marked_at': now_iso(), 'spam_reason': reason_map.get(mid, ''), 'spam_by_ai': True}},
            )

    return {'scanned': len(msgs), 'moved': len(moved_ids), 'results': results}


@router.post('/ai/verify-spam')
async def verify_spam_folder(user=Depends(get_current_user)):
    """Scan the user's spam folder and release any false positives back to the inbox."""
    addrs = await _user_addrs(user)
    if not addrs:
        return {'scanned': 0, 'released': 0, 'results': []}
    msgs = decrypt_mail_list(await db.emails.find(
        {'to_addrs': {'$in': addrs}, 'folder': 'spam'},
        {'_id': 0, 'id': 1, 'from_addr': 1, 'from_name': 1, 'subject': 1, 'body': 1},
    ).sort('created_at', -1).to_list(25))
    if not msgs:
        return {'scanned': 0, 'released': 0, 'results': []}

    results = await ai_spam_check(msgs)
    # Anything Claude flags as NOT spam with confidence >= 0.65 → release back to inbox
    release_ids = [r['id'] for r in results if (not r.get('is_spam')) and r.get('confidence', 0) >= 0.65]
    if release_ids:
        await db.emails.update_many(
            {'id': {'$in': release_ids}, 'to_addrs': {'$in': addrs}},
            {'$set': {'folder': 'inbox'}, '$unset': {'spam_marked_at': '', 'spam_reason': '', 'spam_by_ai': ''}},
        )
    return {'scanned': len(msgs), 'released': len(release_ids), 'results': results}
