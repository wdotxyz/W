"""Pydantic request schemas shared across routers."""
from typing import Any, Dict, List, Optional
from pydantic import BaseModel


class SendOtpReq(BaseModel):
    phone: str


class VerifyOtpReq(BaseModel):
    phone: str
    otp: str
    password: Optional[str] = None
    domain: Optional[str] = None


class CheckoutReq(BaseModel):
    tier: str
    interval: str


class StartCallReq(BaseModel):
    chat_id: str
    call_type: str = 'video'


class JoinCallReq(BaseModel):
    room_url: str


class LoginReq(BaseModel):
    email: str
    password: str
    otp: Optional[str] = None


class TwoFactorToggleReq(BaseModel):
    enable: bool
    password: str
    otp: Optional[str] = None


class SetPasswordReq(BaseModel):
    password: str
    current_password: Optional[str] = None


class ForgotPasswordReq(BaseModel):
    email: str


class ResetPasswordReq(BaseModel):
    email: str
    otp: str
    new_password: str


class ProfileReq(BaseModel):
    name: str
    avatar: Optional[str] = None
    about: Optional[str] = "Hey there! I'm using Wave."


class NotifSettingsReq(BaseModel):
    message_sounds: Optional[bool] = None
    group_sounds: Optional[bool] = None
    show_preview: Optional[bool] = None
    vibration: Optional[bool] = None
    mute_all: Optional[bool] = None


class SignatureReq(BaseModel):
    signature: str = ''


class CreateChatReq(BaseModel):
    member_ids: List[str]
    is_group: bool = False
    name: Optional[str] = None
    avatar: Optional[str] = None


class SendMessageReq(BaseModel):
    chat_id: str
    type: str = 'text'
    content: str
    duration: Optional[int] = None


class AiChatReq(BaseModel):
    message: str
    session_id: Optional[str] = None


class ComposeMailReq(BaseModel):
    to: List[str]
    subject: str = ''
    body: str = ''
    attachments: Optional[List[Dict[str, Any]]] = None
    draft_id: Optional[str] = None
    in_reply_to: Optional[str] = None
    thread_id: Optional[str] = None


class DraftReq(BaseModel):
    id: Optional[str] = None
    to: List[str] = []
    subject: str = ''
    body: str = ''
    attachments: Optional[List[Dict[str, Any]]] = None


class ClaimHandleReq(BaseModel):
    handle: str
    domain: Optional[str] = None


class StatusReq(BaseModel):
    type: str = 'text'
    content: str
    background: Optional[str] = None
