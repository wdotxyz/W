"""AI assistant reply generator (background task)."""
import uuid
from typing import List

from emergentintegrations.llm.chat import LlmChat, UserMessage

from core.config import AI_USER_ID, EMERGENT_LLM_KEY
from core.db import db, logger
from core.security import now_iso
from core.ws import ws_manager


async def _handle_ai_reply(chat_id: str, member_ids: List[str], user_text: str):
    try:
        await ws_manager.broadcast_to_users(
            member_ids, {'type': 'typing', 'chat_id': chat_id, 'user_id': AI_USER_ID, 'is_typing': True}
        )
        prior = await db.messages.find({'chat_id': chat_id}, {'_id': 0}).sort('created_at', -1).to_list(12)
        prior.reverse()
        chat = LlmChat(
            api_key=EMERGENT_LLM_KEY,
            session_id=f'chat-{chat_id}',
            system_message=(
                'You are W AI, a friendly and helpful AI assistant inside the W messaging app. '
                'Reply concisely (1-3 short paragraphs), be warm, helpful, and conversational. Use plain text.'
            ),
        ).with_model('anthropic', 'claude-sonnet-4-5-20250929')

        context = '\n'.join(
            f"{'User' if m['sender_id'] != AI_USER_ID else 'You'}: {m['content']}"
            for m in prior[:-1] if m.get('type') == 'text'
        )
        prompt = (context + '\n\nUser: ' + user_text) if context else user_text

        reply_text = await chat.send_message(UserMessage(text=prompt))

        ai_msg = {
            'id': str(uuid.uuid4()),
            'chat_id': chat_id,
            'sender_id': AI_USER_ID,
            'sender_name': 'W AI',
            'type': 'text',
            'content': str(reply_text).strip(),
            'duration': None,
            'read_by': [AI_USER_ID],
            'created_at': now_iso(),
        }
        await db.messages.insert_one(dict(ai_msg))
        await ws_manager.broadcast_to_users(
            member_ids, {'type': 'typing', 'chat_id': chat_id, 'user_id': AI_USER_ID, 'is_typing': False}
        )
        await ws_manager.broadcast_to_users(
            member_ids, {'type': 'new_message', 'chat_id': chat_id, 'message': ai_msg}
        )
    except Exception as e:
        logger.exception(f'AI reply failed: {e}')
        err_msg = {
            'id': str(uuid.uuid4()),
            'chat_id': chat_id,
            'sender_id': AI_USER_ID,
            'sender_name': 'W AI',
            'type': 'text',
            'content': "Sorry, I couldn't process that right now. Please try again.",
            'duration': None,
            'read_by': [AI_USER_ID],
            'created_at': now_iso(),
        }
        await db.messages.insert_one(dict(err_msg))
        await ws_manager.broadcast_to_users(
            member_ids, {'type': 'new_message', 'chat_id': chat_id, 'message': err_msg}
        )
