# Wave - WhatsApp Clone PRD

## Vision
**Wave** — an AI-native messaging app with an ocean-inspired teal/blue aesthetic. WhatsApp-class chat experience plus a built-in AI assistant available in every conversation.

## Stack
- **Frontend**: Expo SDK 54, React Native, Expo Router (file-based), AsyncStorage, expo-image-picker, expo-audio, expo-file-system
- **Backend**: FastAPI + MongoDB (motor), JWT auth, WebSockets for realtime
- **AI**: Claude Sonnet 4.5 via emergentintegrations + EMERGENT_LLM_KEY

## Implemented Features (MVP)
- Phone + OTP auth (DEV MODE — OTP returned in API + autofilled in UI; Twilio swap-in ready)
- Profile setup (name + base64 avatar)
- Tab nav: **Chats, Mail, Calls (placeholder), Settings**
- 1-on-1 chats, Group chats (create with name + members)
- Real-time messaging via WebSocket (auto-reconnect)
- Text, image (base64), and voice-note (base64 m4a) messages
- Typing indicators, online/last-seen, unread badges
- Wave AI assistant — pinned/auto-created in chats, replies in any chat that includes it
- Notification Settings: master mute, message/group sounds, preview toggle, vibration
- In-app notification banner with WebAudio chime
- **Wave Mail (@w.xyz webmail)**: pick unique handle (reserved list enforced), Inbox + Sent folders, full-screen compose with To/Subject/Body + photo/file attachments, mail detail with Reply, **real send via SendGrid API** (when key configured), **real receive via SendGrid Inbound Parse webhook** at `/api/mail/inbound`, graceful fallback to "saved_no_provider" when key absent so the UI works end-to-end immediately.
- Sign out

## Color Palette (Wave)
- Primary `#0B3B60`, Accent `#0A7A90`, Glow `#00B4D8`, Surface `#FFFFFF`, Surface2 `#F0F4F8`

## Smart Business Enhancement
**AI-as-a-Contact**: Wave AI is treated as a regular contact, accessible from any chat (including groups) — instantly increases per-user engagement, message volume, and stickiness vs. plain WhatsApp clones, and creates a clear path to monetize "AI Pro" tier (image gen, longer memory, file tools).

## Next Action Items
- Plug in real Twilio creds for production OTP
- Add status/stories feature
- Add voice/video calls (WebRTC)
- Push notifications
