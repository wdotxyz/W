"""AI assist endpoints: smart-reply, compose, rewrite, summarize-thread.

Uses the Emergent LLM key + Claude Sonnet 4.5.
"""
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from core.db import db
from core.security import get_current_user
from services.ai_assist import (
    compose_email, rewrite_text, smart_reply_suggestions, suggest_subjects, summarize_thread,
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
    msgs = await db.emails.find(q, {'_id': 0}).sort('created_at', 1).to_list(50)
    if not msgs:
        raise HTTPException(404, 'Thread not found')
    out = await summarize_thread(msgs)
    return out
