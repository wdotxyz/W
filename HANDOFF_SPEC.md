# W — Feature Handoff Document

## 1. App Overview

**W** is a privacy-first, AI-native, cross-platform (iOS/Android/Web) messaging and webmail platform. Users get a premium `@w.xyz` email address (or bring their own domain), send/receive end-to-end encrypted 1-on-1 chats and group messages, hold voice/video calls, and interact with a built-in AI assistant ("W AI"). The product's defining feature is **Ghost Mail**: every incoming and outgoing email auto-deletes 24 hours after arrival unless explicitly saved, giving users an ephemeral-by-default inbox. The mobile app uses a touch-first tab layout; the web build renders a dedicated Gmail-style desktop UI when the viewport is ≥ 720 px wide.

## 2. Tech Stack

### Frontend
- **Runtime:** Expo SDK 54 (React Native 0.81, React 19), Expo Router 6 for file-based routing, TypeScript
- **Web build:** react-native-web 0.21 (single codebase, platform + width detection to swap layouts)
- **Storage:** `@react-native-async-storage/async-storage` (tokens, drafts, cache), `expo-secure-store` (E2EE private keys)
- **Media:** `expo-audio` (voice notes), `expo-image`, `expo-image-picker`, `expo-file-system`, `expo-clipboard`, `expo-haptics`
- **Animation & gestures:** `react-native-reanimated`, `react-native-gesture-handler`, `react-native-worklets`
- **Crypto:** `tweetnacl` + `tweetnacl-util` (X25519 + XSalsa20-Poly1305 for chat E2EE)
- **Icons:** `@expo/vector-icons` (Ionicons)
- **HTTP:** hand-rolled `src/api.ts` wrapper around `fetch`
- **Realtime:** native WebSocket connection to `/api/ws`
- **Web-specific:** `react-native-webview`, `expo-web-browser`

### Backend
- **Framework:** FastAPI 0.110 + Uvicorn 0.25 on `0.0.0.0:8001`
- **DB driver:** Motor 3.3 (async MongoDB)
- **Auth:** `bcrypt` password hashing + `pyjwt` HS256 tokens
- **Crypto:** `cryptography` (Fernet for at-rest email body encryption)
- **Emails (system + user):** `sendgrid-python` (via `emergentintegrations` wrapper for inbound); SendGrid Inbound Parse for incoming mail
- **SMS/OTP:** Twilio REST API
- **Payments:** Stripe (via `emergentintegrations.payments.stripe.checkout`)
- **Video/audio calls:** Daily.co REST API
- **LLM & speech:** `emergentintegrations` (Claude Sonnet 4.5 + OpenAI Whisper-1 via Emergent Universal LLM Key)
- **HTTP client:** `httpx`

### Database
- **MongoDB** (single database, name from `DB_NAME`)

### Deployment
- Supervisor-managed processes: `backend` (uvicorn), `expo` (metro dev server)
- Kubernetes ingress: `/*` → port 3000 (Expo), `/api/*` → port 8001 (FastAPI)

---

## 3. Pages / Routes

### Auth (unauthenticated) — `app/(auth)/`
| Route | Purpose |
|---|---|
| `welcome.tsx` | Marketing splash, "Get started" CTA |
| `phone.tsx` | Phone number entry to request an OTP |
| `otp.tsx` | 6-digit OTP entry to verify phone |
| `profile-setup.tsx` | New user picks display name + avatar |
| `signin.tsx` | Email + password sign-in, links to forgot / signup |
| `forgot-password.tsx` | Request password reset OTP by email |
| `two-factor.tsx` | 2FA code entry mid-sign-in |

### Main tabs (mobile-first) — `app/(tabs)/`
| Route | Purpose |
|---|---|
| `mail.tsx` | Inbox home — multi-folder view, multi-select bulk actions, FAB compose |
| `updates.tsx` | "Watch" feed — status updates from contacts |
| `settings.tsx` | Settings root — profile card, notifications, help, mail, account, refer |

### Mail deep routes — `app/mail/`
| Route | Purpose |
|---|---|
| `compose.tsx` | Full-screen compose editor (AI, voice-to-email, attachments, drafts, scheduled/deferred send) |
| `[id].tsx` | Single email reader (rich HTML, tracker-blocked badge, reply/delete/star) |
| `thread/[threadId].tsx` | Full conversation thread reader with star-thread action |

### Chat deep routes
| Route | Purpose |
|---|---|
| `chats.tsx` | Chat list (mobile) |
| `chat/[id].tsx` | 1-on-1 or group chat screen (text + voice + image, E2EE) |
| `new-chat.tsx` | Start a new chat by W email or invite by external email |
| `new-group.tsx` | Create a group chat (pick members, name, avatar) |
| `contacts.tsx` | Contacts hub — list contacts + invite by email |

### Web layout (desktop) — `app/web/` (only mounted when viewport ≥ 720 px on web)
| Route | Purpose |
|---|---|
| `_layout.tsx` | Gmail-style shell (top bar + optional sidebar); hosts floating compose panel |
| `_ComposePanel.tsx` | Bottom-right floating compose overlay with Expand→full-screen |
| `index.tsx` | Redirect to `/web/inbox` |
| `inbox.tsx` | 2-column mail (list + reader), Gmail-style folders (Inbox/Starred/Snoozed/Sent/Drafts/Promos/Spam) |
| `chats.tsx` | WhatsApp Web-style 2-column chat (chat list + active pane, text-only + E2EE) |
| `contacts.tsx` | Reuses mobile contacts screen inside the web shell |
| `settings.tsx` | Reuses mobile settings screen inside the web shell |
| `watch.tsx` | Reuses mobile Watch screen (hidden from top nav on web MVP) |

### Settings sub-screens (shared between mobile + web)
| Route | Purpose |
|---|---|
| `settings/account.tsx` | 2FA, Change password, Change phone, About, Deactivate/Delete |
| `settings/change-password.tsx` | Current + new password form |
| `settings/change-phone.tsx` | Update phone number (OTP-gated) |
| `settings/mail.tsx` | Ghost Mail toggle link, signature, auto-reply, recovery email |
| `settings/passkeys.tsx` | Passkey management (placeholder / hidden) |
| `two-factor-settings.tsx` | Enable/disable 2FA |
| `notification-settings.tsx` | Sound, preview, vibration, mute-all toggles |
| `signature.tsx` | Email signature editor |
| `auto-reply.tsx` | Vacation responder (with optional AI-personalized replies) |
| `ghost-mail.tsx` | Ghost Mail info + toggle (24-hour auto-delete) |
| `recovery-email.tsx` | Set a fallback external email for account recovery |
| `domain-setup.tsx` | Configure custom domain (DNS records display + verify) |
| `about.tsx` | About W screen |
| `actions.tsx` | AI-extracted action items across all mail |
| `help.tsx` | Help center + support contact form |

### Billing — `app/billing/`
| Route | Purpose |
|---|---|
| `upgrade.tsx` | Show tiered plans (Essentials/Plus/Pro), launch Stripe checkout |
| `success.tsx` | Stripe checkout success landing |
| `cancel.tsx` | Stripe checkout cancel landing |

### Legal — `app/legal/`
| Route | Purpose |
|---|---|
| `privacy.tsx`, `terms.tsx` | Static legal pages |

### Admin — `app/admin/`
| Route | Purpose |
|---|---|
| `stats.tsx` | Support-user-only app-wide stats dashboard |

### Root
| Route | Purpose |
|---|---|
| `_layout.tsx` | Providers (SafeArea, Gesture, Auth, StatusBar), root Stack |
| `index.tsx` | Router: signed-out → `/(auth)/signin`; desktop web → `/web/inbox`; else → `/(tabs)/mail`; hostname starts with `mail.` → `/web/inbox` |

---

## 4. Features Grouped by Area

### Authentication
- **Phone + OTP sign-up:** User enters phone → Twilio SMS-delivered 6-digit OTP → verify → set password → claim `@w.xyz` handle.
- **Email + password sign-in:** Standard flow; supports 2FA (SMS OTP as second factor). Failed-login lockout after N attempts within a window.
- **Forgot password:** Enter W email → OTP sent to registered phone OR recovery email → set new password.
- **Recovery email:** Optional external email as fallback for password reset (verified with a 6-digit OTP sent via SendGrid).
- **Two-factor (2FA):** Toggle in Account settings; requires password + OTP to enable/disable; forces OTP challenge at every sign-in when on.
- **Deactivate / delete:** Deactivate pauses account (data preserved, re-sign-in reactivates). Delete permanently erases user + all their mail/chats.

### Mail (Webmail)
- **Multi-folder inbox:** Inbox, Starred (Saved), Snoozed, Sent, Drafts, Promotions, Spam, Archived, Scheduled — all separate API endpoints.
- **Threading:** Inbound/outbound emails linked via `thread_id` (derived from `In-Reply-To` / `References` headers).
- **Compose:** Rich text body, multiple recipients, attachments (base64), reply-to-thread, AI-generated subject suggestions, AI compose ("write this for me"), voice-to-email (Whisper transcript), scheduled send (`send_at`) and deferred send (`defer_seconds` for "Undo Send" window).
- **Undo Send:** 15-second delay after "Send" — email sits in a scheduled queue that a background sweeper flushes. During the delay, a snackbar lets user cancel.
- **Ghost Mail (24-hour auto-delete):** Background loop every 5 min deletes any email older than 24 h where `starred != true` (and not archived/snoozed). Broadcasts `mail_deleted` over WebSocket to all open sessions of that owner.
- **Save (Star):** Star icon in reader flips `starred = true`, exempting the email from Ghost Mail sweep.
- **AI triage:** `/ai/scan-inbox-spam` classifies inbound mail into Inbox / Promos / Spam. Learns from user's spam/not-spam actions and stores sender-classification hints.
- **Tracker pixel blocking:** Every inbound HTML email is scanned by `_strip_trackers()` in `services/helpers.py`. Removes 1×1 hidden pixels, known tracker hosts (Mailchimp, HubSpot, Google Analytics, SendGrid tracking, etc.), suspicious pixel paths (`/open/`, `/beacon/`, etc.), and background-image URLs pointing at tracker hosts. Message doc stores `trackers_blocked` count; frontend shows a 🛡️ badge.
- **At-rest encryption:** Email `body`, `body_html`, and `subject` are Fernet-encrypted before insertion (`services/crypto.py`) and decrypted on read.
- **Bulk actions:** Long-press a row → multi-select → Delete / Archive / Read / Unread / Mark Spam.
- **Search:** `/mail/search?q=` full-text over subject + body (decrypted server-side).
- **Snooze:** `PATCH /mail/{id}/snooze` with an ISO timestamp; snoozed mail is hidden from Inbox until that time.
- **AI action items:** `/ai/actions` extracts to-dos, follow-ups, dates from mail (rendered on `actions.tsx`).
- **Thread summaries:** `/ai/summarize-thread/{id}` produces a 3-bullet AI summary of any conversation.
- **Signature:** Per-user signature (`user.signature` string), auto-appended to composed emails when `include_signature: true`.
- **Auto-reply / vacation responder:** Enabled on a schedule; optional AI-personalized replies per sender.

### Custom Domain
- Users can attach their own domain (e.g. `mail.mycompany.com`). `/api/domain/dns-records` returns the MX/SPF/DKIM records the user needs to publish; `/api/domain/verify` checks them.

### Chats (Messaging)
- **W-to-W 1-on-1 chats with true E2EE:** Client generates an X25519 keypair on login (private key in `expo-secure-store` / AsyncStorage-web-fallback, public key published to `/api/keys/publish`). Text, image, and voice payloads are encrypted with `nacl.box(msg, nonce, peerPub, mySecret)`. Server stores only `ciphertext + nonce + algo`; `content` field is empty. Recipient decrypts locally. Header shows lock badge and "End-to-end encrypted" subtitle; WhatsApp-style yellow banner above the message list.
- **Group chats:** Currently unencrypted (MVP scope). Members list, name, avatar. WebSocket broadcasts `new_message` events.
- **AI chat (Wave AI):** Every user auto-gets a chat with the seeded AI user (`AI_USER_ID`). Messages there hit `_handle_ai_reply` which calls Claude Sonnet 4.5 via `emergentintegrations`, storing a session id per chat for multi-turn context.
- **Voice notes:** Recorded via `expo-audio`, base64-encoded, sent as `type: "voice"` message (encrypted if 1-on-1).
- **Photos:** Picked via `expo-image-picker`, base64, sent as `type: "image"`.
- **WebSocket realtime:** Client subscribes on connect; `subscribe()` from `useAuth()` returns an unsubscribe fn. Server broadcasts `new_message`, `mail_deleted`, `typing`, and per-user notifications.
- **Contacts + invites:** `/chats/contacts` returns only peers you have chatted with. Inviting a non-W user sends a real SendGrid invite email that lands in that user's Sent folder.

### Calls (Video/Audio)
- **Daily.co-backed rooms:** `/calls/start` creates a Daily room (`_daily_request()` in `services/calls.py`), returns `room_url` + `token`. The other party joins via `/calls/join`. `/calls/end` closes the room. Frontend uses `react-native-webview` to embed the Daily prebuilt UI on native/web.

### Statuses ("Watch")
- **Status posts:** `/statuses` (POST) creates a text/image status with `expires_at = now + 24h`. Feed on the "Watch" tab shows a stitched carousel of contacts' active statuses.

### AI features summary (`/api/ai/*`)
- Smart Reply chip suggestions for both mail and chats.
- One-shot AI compose (`/ai/compose-mail`), rewrite (`/ai/rewrite`), and subject suggestion (`/ai/subject`).
- Voice-to-email (`/ai/voice-to-email` — audio in, Whisper transcript → auto-compose).
- Inbox spam scan (`/ai/scan-inbox-spam` + `/ai/verify-spam`).
- Action-item extractor (`/ai/actions`).
- Thread summarizer (`/ai/summarize-thread/{thread_id}`).
- AI chat multi-turn (via `/api/chats/{ai_chat_id}/messages`, dispatched to Claude).

### Billing
- Tiers: **Essentials** (free, 10 MB, blue-check off), **Plus** (paid, 50 GB, blue check, AI assistant), **Pro** (paid, 100 GB, 4- and 5-char handles available).
- Stripe Checkout session creation (`/billing/checkout`); webhook (`/billing/webhook`) records paid events. MVP flat-cap storage is enforced (`MVP_STORAGE_BYTES`) instead of per-tier until paid launch.

### Support
- In-app ticket submission (`/support/contact`) stored in `db.support_tickets`. Support-team user (`support@w.xyz`, seeded on boot) receives replies. `/support/my-tickets` lists user's own tickets.

### Admin
- Support-flagged users can view `/admin/stats` — user counts, mail volume, etc.

---

## 5. Data Model (MongoDB collections)

All documents include `id: str (uuid4)` as the primary key (except `otps` which uses `phone`). No auto-generated Mongo `_id` is used in API responses.

### `users`
```
id: str (uuid4) — primary key
phone: str (unique, E.164)
name: str
avatar: str (URL or base64)
about: str
handle: str                       — pre-@ portion, e.g. "peter"
email_handle: str (unique, sparse) — normalized handle
email_address: str                — full "peter@w.xyz"
fallback_address: str             — the @w.xyz address even if custom_domain set
custom_domain: str | None
domain_verified: bool
password_hash: str (bcrypt)
tier: "free" | "plus" | "pro"
tier_expires_at: ISO str | None
storage_used_bytes: int
signature: str
ghost_mail_enabled: bool          — default true
two_factor_enabled: bool
notification_settings: {message_sounds, group_sounds, show_preview, vibration, mute_all}
auto_reply: {enabled, subject, body, start_at, end_at, ai_enabled}
recovery_email: str | None
recovery_email_pending: str | None
recovery_email_verified: bool
recovery_email_otp / recovery_email_otp_at: OTP tracking
failed_logins: int
failed_login_window_started_at: ISO str
lock_until: ISO str | None
password_reset_otp / password_reset_otp_at: OTP tracking
is_ai: bool                       — true for the "W AI" seeded user
is_support: bool                  — true for the "W Support" seeded user
deactivated: bool
created_at / last_seen: ISO str
online: bool
```

### `emails`
```
id, owner_id (→ users.id)
folder: "inbox" | "sent" | "drafts" | "spam" | "promotions" | "archived" | "scheduled"
thread_id: str                    — groups conversation
in_reply_to: str | None           — Message-ID of the parent
message_id: str | None            — RFC-2822 Message-ID (for inbound)
from_name / from_addr / from_tier
to_addrs: [str]
subject: str (Fernet-encrypted)
body: str (Fernet-encrypted, plain text)
body_html: str (Fernet-encrypted, sanitized HTML with trackers stripped)
attachments: [{filename, type, content_b64, size}]
snippet: str
read: bool
opened_at: ISO str | None
starred: bool                     — "Saved" flag, exempts from Ghost Mail
starred_at: ISO str
archived: bool
snoozed_until: ISO str | None
trackers_blocked: int
signature: str                    — copy attached at send-time
delivery_status: "queued" | "delivered" | "failed" | "cancelled"
delivery_error: str | None
scheduled_at: ISO str             — for deferred/scheduled sends
created_at: ISO str
```
Indexes: `(owner_id, folder, created_at desc)`, `to_addrs`, `thread_id`, `message_id`, `scheduled_at`.

### `chats`
```
id, is_group: bool
name: str                         — group only
avatar: str
member_ids: [user.id]
created_at, created_by
last_message: {content, type, created_at, e2ee, sender_id}
```
Indexes: `id`, `member_ids`.

### `messages`
```
id, chat_id (→ chats.id)
sender_id (→ users.id)
sender_name: str
type: "text" | "image" | "voice"
content: str                      — "" when e2ee=true
duration: int | None              — voice notes
ciphertext, nonce, algo: str | None  — E2EE payload
e2ee: bool
created_at: ISO str
```
Index: `(chat_id, created_at asc)`.

### `user_keys` (E2EE public keys)
```
user_id (unique), public_key (base64), algo ("x25519-xsalsa20-poly1305"), created_at
```

### `otps`
```
phone (primary), otp: str, created_at
```

### `statuses` (Watch feed)
```
id, user_id, type: "text" | "image", content, background, created_at, expires_at (now+24h)
```
Indexes: `(user_id, created_at desc)`, `expires_at`.

### `invitations`
```
id, inviter_id, to_email, sent_at, accepted_at | None
```

### `calls`
```
id, chat_id, started_by, started_at, ended_at, room_url, participants: [user_id]
```

### `payments` / `billing_events`
```
id, user_id, session_id, tier, interval, amount, currency, status, created_at
```

### `support_tickets`
```
id, user_id, subject, body, status: "open" | "closed", created_at
```

### `auto_reply_log`
```
id, user_id, to_addr, subject, sent_at   — dedupe key to avoid replying to same sender repeatedly in a window
```

**Relationships:** all foreign references are string UUIDs, no enforced FKs (MongoDB). Ownership is enforced in every query via `owner_id == current_user.id`.

---

## 6. API Endpoints

All prefixed with `/api`. Auth-gated endpoints expect `Authorization: Bearer <JWT>`.

### Auth (`routers/auth.py`)
| Method | Path | Purpose |
|---|---|---|
| POST | `/auth/send-otp` | `{phone}` → sends SMS OTP via Twilio, returns `{success, dev_otp?}` |
| POST | `/auth/verify-otp` | `{phone, otp, password?, domain?}` → creates or signs in user, returns `{token, user}` |
| POST | `/auth/login` | `{email, password, otp?}` → returns `{token, user}` or `{two_factor_required: true}` |
| POST | `/auth/2fa` | `{enable, password, otp?}` → toggles 2FA |
| POST | `/auth/set-password` | `{password, current_password?}` — for signed-in users |
| POST | `/auth/forgot-password` | `{email}` → sends OTP via SMS/recovery email |
| POST | `/auth/reset-password` | `{email, otp, new_password}` |
| POST | `/auth/profile` | `{name, avatar?, about?}` |
| GET | `/auth/me` | Returns the current user object (no `password_hash`) |
| POST | `/auth/deactivate` | Pauses account |
| DELETE | `/auth/me` | Permanent deletion (cascades to mail, chats, keys) |
| PATCH | `/auth/notification-settings` | `NotifSettingsReq` |
| PATCH | `/auth/signature` | `{signature}` |
| POST | `/auth/recovery-email/set` | `{email}` — sends verification OTP |
| POST | `/auth/recovery-email/verify` | `{otp}` |
| DELETE | `/auth/recovery-email` | Remove recovery email |
| GET/PATCH | `/auth/auto-reply` | Vacation responder |
| GET/PATCH | `/auth/ghost-mail` | Toggle Ghost Mail (default enabled) |

### Mail (`routers/mail.py`)
| Method | Path | Purpose |
|---|---|---|
| GET | `/mail/check-handle/{handle}` | Availability check for `@w.xyz` handle |
| POST | `/mail/claim-handle` | Claim your `@w.xyz` handle at signup |
| GET | `/domain/dns-records` | Required DNS records for a custom domain |
| POST | `/domain/verify` | Verify DNS is configured correctly |
| GET | `/mail/inbox`, `/starred`, `/spam`, `/promotions`, `/archived`, `/snoozed`, `/sent`, `/drafts`, `/scheduled` | Folder listing (decrypted) |
| GET | `/mail/search?q=` | Full-text search across subject + body |
| GET | `/mail/{id}` | Single mail (with decrypted body_html) |
| POST | `/mail/compose` | Send email — supports `defer_seconds`, `send_at`, attachments, threading |
| GET | `/mail/thread/{thread_id}` | All messages in a thread + marks unread as read |
| POST | `/mail/thread/{id}/star` / `/unstar` | Save/unsave the whole thread |
| POST | `/mail/thread/{id}/close` | (No-op since 24h Ghost Mail) |
| PATCH | `/mail/{id}/{star,archive,snooze,read,unread}` | Per-mail actions |
| POST | `/mail/{id}/{spam,not-spam,promotions,not-promotions}` | Move to/from |
| DELETE | `/mail/{id}` | Hard delete |
| POST | `/mail/drafts` | Upsert draft |
| POST | `/mail/{id}/cancel-send` | Cancel a scheduled/deferred send |
| POST | `/mail/inbound` | **Public SendGrid Inbound Parse webhook** (no auth) — parses multipart, matches `to` addresses ending `@MAIL_DOMAIN`, strips trackers, stores in recipient's inbox |

### Chats (`routers/chats.py`)
| Method | Path | Purpose |
|---|---|---|
| GET | `/chats` | Current user's chat list (with `unread`, `last_message`, resolved display data) |
| POST | `/chats` | `CreateChatReq` → create a new chat |
| GET | `/chats/{id}/messages` | Messages in a chat (ciphertext preserved for E2EE) |
| POST | `/chats/{id}/messages` | `SendMessageReq` (text or ciphertext); broadcasts via WS |
| GET | `/chats/contacts` | Peers you've chatted with (excludes AI + self) |
| POST | `/chats/invite` | `{to}` — start chat with W handle or invite external email (via SendGrid) |
| POST | `/ai/start-chat` | Ensure the current user has a chat with W AI, return it |

### Keys (`routers/keys.py`)
| Method | Path | Purpose |
|---|---|---|
| POST | `/keys/publish` | `{public_key}` — upserts caller's X25519 pubkey (idempotent) |
| GET | `/keys/peer/{user_id}` | Fetch a peer's public key |
| POST | `/keys/peers` | Batch fetch multiple |
| GET | `/keys/me` | Whether caller has published a key |

### AI (`routers/ai.py`)
| Method | Path | Purpose |
|---|---|---|
| POST | `/ai/smart-reply` | Mail-context reply chip suggestions |
| POST | `/ai/smart-reply/chat/{chat_id}` | Chat-context reply chips |
| POST | `/ai/compose-mail` | Generate full email from a short prompt |
| POST | `/ai/rewrite` | Rewrite text (formal / casual / shorter) |
| POST | `/ai/subject` | Suggest 3 subject lines for a body |
| POST | `/ai/summarize-thread/{thread_id}` | 3-bullet summary of a mail thread |
| POST | `/ai/voice-to-email` | Whisper transcript → composed email |
| GET | `/ai/actions` | Extracted action items across all mail |
| POST | `/ai/scan-inbox-spam` | AI classifier over recent inbox (moves to Promos / Spam) |
| POST | `/ai/verify-spam` | User confirms/denies a spam classification (learning) |

### Statuses (`routers/statuses.py`)
| Method | Path | Purpose |
|---|---|---|
| POST | `/statuses` | Create a 24h status |
| GET | `/statuses` | Global feed (people you know) |
| GET | `/statuses/{user_id}` | One user's active statuses |
| DELETE | `/statuses/{status_id}` | Delete own status |

### Calls (`routers/calls.py`)
| Method | Path | Purpose |
|---|---|---|
| POST | `/calls/start` | `{chat_id, call_type}` → creates Daily room, returns `{room_url, token}` |
| POST | `/calls/join` | `{room_url}` → returns meeting token |
| POST | `/calls/end` | Close room, record call.ended_at |

### Billing (`routers/billing.py`)
| Method | Path | Purpose |
|---|---|---|
| GET | `/billing/plans` | Plan catalog with prices, storage, perks |
| GET | `/billing/me` | Current tier + storage usage |
| POST | `/billing/checkout` | `{tier, interval}` → Stripe Checkout session URL |
| GET | `/billing/status/{session_id}` | Poll session status |
| POST | `/billing/webhook` | Stripe webhook — records paid events, upgrades user tier |

### Support (`routers/support.py`)
| Method | Path | Purpose |
|---|---|---|
| POST | `/support/contact` | Submit help ticket |
| GET | `/support/my-tickets` | List own tickets |

### Admin (`routers/admin.py`)
| Method | Path | Purpose |
|---|---|---|
| GET | `/admin/stats` | Support-user-only global stats |

### WebSocket
| Path | Purpose |
|---|---|
| `WS /api/ws?token=<JWT>` | Real-time push. Server → client events: `new_message`, `mail_deleted`, `typing`, plus arbitrary user notifications. |

---

## 7. External Integrations & Env Vars

| Service | Purpose | Backend env vars |
|---|---|---|
| **MongoDB** | Primary DB | `MONGO_URL`, `DB_NAME` |
| **JWT** | Auth token signing (HS256) | `JWT_SECRET` |
| **Emergent Universal LLM Key** | Claude Sonnet 4.5 (chat/AI text), OpenAI Whisper-1 (voice-to-email) via `emergentintegrations` | `EMERGENT_LLM_KEY` |
| **SendGrid** | Outbound mail send + Inbound Parse webhook | `SENDGRID_API_KEY`, `MAIL_DOMAIN`, `MAIL_FROM_DEFAULT` |
| **Twilio** | SMS OTP delivery | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER` |
| **Stripe** | Payments (Checkout + webhook) via `emergentintegrations` proxy | `STRIPE_API_KEY` |
| **Daily.co** | Video/audio calls | `DAILY_API_KEY`, `DAILY_SUBDOMAIN` |
| **App URL** | Public URL used in webhook callbacks + invite links | `APP_PUBLIC_URL` |
| **Fernet** | At-rest email encryption key (must be set for production; auto-generated for dev if unset) | `MAIL_ENCRYPTION_KEY` (referenced in `services/crypto.py`) |
| **Support seed** | Initial password for `support@w.xyz` seed user | `SUPPORT_SEED_PASSWORD` |

**Frontend env vars** (`/app/frontend/.env`, all protected — do NOT modify):
- `EXPO_PUBLIC_BACKEND_URL` — public URL the app hits for `/api/*`
- `EXPO_PACKAGER_PROXY_URL`, `EXPO_PACKAGER_HOSTNAME`, `EXPO_TUNNEL_SUBDOMAIN`, `EXPO_USE_FAST_RESOLVER`, `METRO_CACHE_ROOT` — dev server config

---

## 8. Background Jobs / Scheduled Tasks

Both are `asyncio.create_task` loops started on FastAPI's `startup` event (`server.py`).

| Task | Interval | Purpose |
|---|---|---|
| `_scheduled_send_loop()` | 5 s | Find `emails` where `folder='scheduled'` AND `scheduled_at <= now` → move to `sent`, dispatch via SendGrid, record delivery status. Powers "Undo Send" (15s defer) and "Send Later". |
| `_ghost_mail_sweep_loop()` | 5 min | Delete every email older than 24 h where `starred != true` AND `archived != true` AND not currently snoozed. Broadcasts `mail_deleted` over WebSocket per owner. |

There are also **on-demand cleanups**:
- Statuses auto-expire based on `expires_at` (query filter excludes expired; no dedicated sweeper).
- OTPs are deleted immediately after successful verification.
- Auto-reply dedupe uses `auto_reply_log` to avoid re-replying to the same sender within a window.

---

## 9. UI/UX Conventions

### Design system
- **Colors** (`src/theme.ts`):
  - Primary: `#0B3B60` (deep navy)
  - Primary light: `#1B6194`
  - Accent: `#0A7A90` (teal), Accent glow: `#00B4D8`
  - Surface: `#FFFFFF`, Surface2: `#F0F4F8` (backgrounds), Border: `#E2E8F0`
  - Text: `#06152B`, Text muted: `#5B7083`
  - Bubbles: sent `#D6F0F4`, received `#FFFFFF`
  - AI gradient: `#00B4D8` → `#0A7A90`
  - Danger `#FF3B30`, Success `#34C759`
- **Radii:** `sm 8 / md 12 / lg 16 / xl 22 / pill 999`
- **Spacing (8-pt grid):** `xs 4 / sm 8 / md 12 / lg 16 / xl 24 / xxl 32`

### Component library
No external UI library — everything is hand-built with React Native primitives (`View`, `Text`, `TouchableOpacity`, `FlatList`) and `StyleSheet.create`. Reusable components live under `src/components/`:
- `BrandMark` — W logo mark
- `BlueCheck` — verified badge (Plus/Pro tier)
- `LegalPage` — wrapper for privacy/terms
- `SmartReplyChips` — AI reply chip row
- `NotificationBanner` — top-of-app toast for WS notifications

### Styling conventions
- **Every screen uses `SafeAreaView` from `react-native-safe-area-context`.**
- **Web-only escape hatch:** `Platform.OS === "web"` guarded style casts (e.g. `boxShadow`, `cursor: "pointer"`, `outlineStyle: "none"`, `overflowY: "auto"`).
- **Confirmation dialogs on web:** RN's `Alert.alert` with 3+ buttons breaks on web; use custom overlays or `window.confirm()` fallback.
- **Icons:** Ionicons throughout (`@expo/vector-icons`).
- **Touch targets:** ≥ 44 px on mobile.
- **Responsive breakpoint:** `useIsDesktop()` returns true only on web when `window.innerWidth >= 720`. Root `index.tsx` redirects desktop web to `/web/inbox`; the app tree renders mobile UI otherwise.
- **Back navigation safety:** `smartBack(router)` helper (`src/utils/nav.ts`) — falls back to inbox root if there's no history (fixes deep-link stranding on web).
- **Compose UX:** On mobile, full-screen compose route. On web, a Gmail-style floating bottom-right panel via `WebComposePanel` + `WebComposeProvider` context; the panel has an "Expand" button that hands the current draft off to the full `/mail/compose` route.
- **Global providers** (`app/_layout.tsx`, in order): `GestureHandlerRootView` → `SafeAreaProvider` → `AuthProvider` (JWT + user + WS subscription API) → `Stack`.

### Chat visual language
- 1-on-1 E2EE chats: yellow WhatsApp-style banner above the message list, lock icon in the header, "End-to-end encrypted" subtitle, tiny lock next to timestamp on each ciphertext bubble.
- Own message bubbles: dark navy background, white text, aligned right.
- Others' bubbles: white with border, aligned left.
- AI chat: teal accent avatar + "· AI" tag.

---

## 10. Known Limitations & In-Progress Work

### Known limitations
- **Group chats are not E2EE** — MVP shipped 1-on-1 encryption only. Group messages travel plaintext to the server.
- **AI chats are plaintext by design** — the AI needs to read messages to reply.
- **Voice notes and photos over web chat show a placeholder** — the WhatsApp Web-style chat renders "📷 Photo (open in mobile app)" / "🎤 Voice note (open in mobile app)". Rendering happens on mobile only.
- **`storage_used_bytes` is enforced via a flat MVP cap**, not per-tier limits, until paid plans launch.
- **Tracker blocking is HTML-only** — it doesn't affect text/plain emails (which usually have no trackers anyway).
- **Ghost Mail sweep runs every 5 min** — an email could theoretically live up to ~24 h 5 min. Acceptable for the ephemeral UX; not a security guarantee.
- **Custom domain flow (`domain-setup.tsx`)** shows DNS records but full end-to-end verification depends on SendGrid domain authentication being manually completed by the operator.
- **Watch (statuses)** is hidden from the web top nav for MVP but still fully functional on mobile.
- **Passkeys settings page** is stubbed (no WebAuthn wired up yet).
- **Push notifications** are not implemented — planned via Emergent-managed FCM/APNs, requires a real native build.
- **Bright-mode only** — no dark theme yet (theme constants exist but no dark palette is defined).

### Deprecated / removed
- The old close-thread Ghost Mail deletion is now a **no-op** — replaced by the 24 h time-based sweep. The `/mail/thread/{id}/close` endpoint still exists for API compatibility but doesn't delete anything.
- The old `/web/compose` route was removed; the web compose is now context-driven (via `WebComposeProvider`).

### In-progress / near-term backlog
1. **AI Image Generation in Chats** — `/image` slash command via Gemini Nano Banana.
2. **AI Meeting Summary from Daily.co recordings** — trigger post-call, produce structured notes.
3. **AI Semantic Search for Inbox** — "Ask your mail" natural-language query over user's own mail.
4. **Export AI action items to `.ics`** for Apple/Google Calendar.
5. **Gmail-style web polish**:
   - Search bar in the top nav wired to `/api/mail/search`
   - Keyboard shortcuts (⌘K palette, `e` archive, `r` reply, `#` delete)
   - Dedicated web-native Chats layout (currently reuses simplified 2-column MVP)
   - Signed-out marketing landing page at `/`
6. **Refactor** the two large screens `app/(tabs)/mail.tsx` (~700 lines) and `app/chat/[id].tsx` (~450 lines) into smaller components.
7. **Push notifications** via Emergent-managed FCM/APNs (requires user-provided `google-services.json` and a real build).
8. **Migrate to AWS SES** once outbound mail exceeds ~30–50 k/month (SendGrid pricing tips over at that scale).
9. **Custom-domain claim UI** — currently only `@w.xyz` handles can be issued; the domain-setup screen exists but the user-facing "pick your domain at signup" flow is not fully wired.
10. **Unhide "Premium" settings, Theme picker, Passkeys, AI Assistant switch** (currently gated by `SHOW_PREMIUM` flag in `src/featureFlags.ts`).

### Test coverage
Pytest suite lives under `/app/backend/tests/` — covers auth flow, E2EE key exchange + ciphertext preservation, mail management, voice compose, autoreply/signature, refactor verification, and support tickets. No frontend unit tests; QA is done through the `testing_agent` harness (Playwright-driven).

### Test credentials
`/app/memory/test_credentials.md` — `peter@w.xyz / PeterW2026!` and the seed support account `support@w.xyz`.

---

**End of handoff.** Every entry above was walked from the actual code (no guesses). The most authoritative source when in doubt: `server.py` for lifecycle, `models/schemas.py` for request shapes, individual `routers/*.py` files for behavior, and `src/theme.ts` + `src/hooks/useIsDesktop.ts` for the mobile-vs-desktop split.
