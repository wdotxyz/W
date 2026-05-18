# W - WhatsApp Clone PRD

## Vision
**W** — an AI-native messaging app with an ocean-inspired teal/blue aesthetic. WhatsApp-class chat experience plus built-in AI assistant, real webmail on @w.xyz, and a Status/Updates feed.

## Stack
- **Frontend**: Expo SDK 54, React Native, Expo Router (file-based), AsyncStorage, expo-image-picker, expo-audio, expo-file-system, expo-document-picker
- **Backend**: FastAPI + MongoDB (motor), JWT auth, WebSockets for realtime
- **AI**: Claude Sonnet 4.5 via emergentintegrations + EMERGENT_LLM_KEY
- **Mail**: SendGrid v3 send API + Inbound Parse webhook

## Implemented Features (MVP)
- Phone + OTP auth (DEV MODE — OTP returned in API + autofilled in UI)
- Profile setup (name + base64 avatar)
- **Tab nav: Chats · Updates · Mail · Settings** (4 tabs)
- **Chats tab** has internal segment toggle (Chats / Calls) — calls placeholder accessible without leaving the tab
- 1-on-1 chats, Group chats, real-time WS messaging, text/image/voice notes, typing indicators
- **W AI** assistant (Claude Sonnet 4.5) auto-pinned and reply-on-mention in any chat
- **Updates** (WhatsApp Status-style): post text with color background OR photo, 24h auto-expiry, ringed avatar grid, full-screen story-style viewer with auto-advance + tap navigation, mark-as-viewed
- **W Mail** (@w.xyz webmail): handle picker, Inbox/Drafts/Sent + Search, full-screen compose with auto-save drafts + attachments, HTML rendering (sanitized), threading by Message-ID / In-Reply-To, signatures, real send + receive via SendGrid (mocked w/o key)
- Notification settings (mute, sounds, preview, vibration) + in-app banner with chime
- Sign out

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
- **Wave Mail (@w.xyz webmail)**: pick unique handle (reserved list enforced), **Inbox + Drafts + Sent** folders, **search** (subject/body/from/to with regex), full-screen compose with To/Subject/Body + photo/file attachments, **auto-save drafts** + manual save button, **mail detail** with HTML rendering (sanitized, rich/plain toggle on web) + Reply, **threading by Message-ID + In-Reply-To headers** (groups in list with thread count badge), **email signature** (per-user, auto-appended on send), **real send via SendGrid API** (when key configured), **real receive via SendGrid Inbound Parse webhook** at `/api/mail/inbound` with proper header parsing, graceful fallback to "saved_no_provider" when key absent.
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
