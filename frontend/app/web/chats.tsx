/**
 * WhatsApp Web–style chat page for the /web build.
 *
 * Layout:
 *   ┌────────────┬─────────────────────────────┐
 *   │ chat list  │  active chat pane           │
 *   │ (search    │  (header, messages, input)  │
 *   │  + rows)   │                             │
 *   └────────────┴─────────────────────────────┘
 *
 * Supports text messages with E2EE (reuses `src/crypto`). Voice and image
 * are intentionally omitted here for the MVP — the mobile app remains the
 * best place for those. This screen is only mounted on the web build.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity, FlatList,
  ActivityIndicator, Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { api } from "../../src/api";
import { useAuth } from "../../src/auth";
import {
  encryptForPeer, decryptFromPeer, getPeerPublicKey,
} from "../../src/crypto";
import { colors, radius } from "../../src/theme";

const AI_USER_ID = "ai-assistant-wave";

type Chat = {
  id: string;
  display_name?: string;
  display_avatar?: string;
  display_tier?: string;
  member_ids?: string[];
  is_group?: boolean;
  unread?: number;
  last_message?: any;
};

type Message = {
  id: string;
  sender_id: string;
  sender_name?: string;
  type: string;
  content: string;
  created_at: string;
  e2ee?: boolean;
  ciphertext?: string;
  nonce?: string;
};

export default function WebChats() {
  const { user, subscribe } = useAuth();
  const [chats, setChats] = useState<Chat[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [activeId, setActiveId] = useState<string | null>(null);

  const loadChats = useCallback(async () => {
    try {
      const data = await api<Chat[]>("/chats");
      // Ensure the AI chat is present
      const hasAi = data.some((c) => c.member_ids?.includes(AI_USER_ID));
      if (!hasAi) {
        try {
          const aiChat = await api<Chat>("/ai/start-chat", { method: "POST" });
          data.unshift(aiChat);
        } catch { /* ignore */ }
      }
      setChats(data);
      if (!activeId && data.length) setActiveId(data[0].id);
    } catch {
      // silent
    } finally { setLoading(false); }
  }, [activeId]);

  useEffect(() => { loadChats(); }, [loadChats]);

  // WS: when a new message lands, refresh chat list to update previews.
  useEffect(() => {
    return subscribe((msg: any) => {
      if (msg.type === "new_message") loadChats();
    });
  }, [subscribe, loadChats]);

  const activeChat = useMemo(() => chats.find((c) => c.id === activeId) || null, [chats, activeId]);

  const filtered = useMemo(() => {
    if (!q.trim()) return chats;
    const nq = q.trim().toLowerCase();
    return chats.filter((c) => (c.display_name || "").toLowerCase().includes(nq));
  }, [chats, q]);

  return (
    <View style={styles.root} testID="web-chats-root">
      {/* ------- LEFT: chat list ------------------------------------------- */}
      <View style={styles.listCol}>
        <View style={styles.listHeader}>
          <Text style={styles.listTitle}>Chat</Text>
        </View>
        <View style={styles.searchWrap}>
          <Ionicons name="search" size={16} color={colors.textMuted} />
          <TextInput
            value={q}
            onChangeText={setQ}
            placeholder="Search chats"
            placeholderTextColor={colors.textMuted}
            style={styles.searchInput}
            testID="web-chat-search"
          />
        </View>

        {loading ? (
          <ActivityIndicator color={colors.accent} style={{ marginTop: 40 }} />
        ) : (
          <FlatList
            data={filtered}
            keyExtractor={(c) => c.id}
            renderItem={({ item }) => (
              <ChatRow
                chat={item}
                active={activeId === item.id}
                onPress={() => setActiveId(item.id)}
              />
            )}
            ListEmptyComponent={
              <Text style={styles.emptyList}>No chats yet. Invite a contact to start.</Text>
            }
          />
        )}
      </View>

      {/* ------- RIGHT: active chat pane ----------------------------------- */}
      <View style={styles.chatCol}>
        {activeChat ? (
          <ChatPane key={activeChat.id} chat={activeChat} me={user} />
        ) : (
          <EmptyPane />
        )}
      </View>
    </View>
  );
}

/* --------------------------------------------------------------- ChatRow */

function ChatRow({ chat, active, onPress }: { chat: Chat; active: boolean; onPress: () => void }) {
  const isAi = chat.member_ids?.includes(AI_USER_ID);
  const last = chat.last_message;
  const preview = !last
    ? (isAi ? "Tap to chat with W AI" : "Say hi 👋")
    : last.e2ee ? "🔒 Encrypted message"
    : last.type === "image" ? "📷 Photo"
    : last.type === "voice" ? "🎤 Voice note"
    : last.content;
  return (
    <TouchableOpacity
      style={[styles.row, active && styles.rowActive]}
      onPress={onPress}
      testID={`web-chat-row-${chat.id}`}
      activeOpacity={0.75}
    >
      <View style={[styles.avatar, isAi && { backgroundColor: colors.accent }]}>
        <Text style={styles.avatarLetter}>
          {(chat.display_name || "?").charAt(0).toUpperCase()}
        </Text>
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={styles.rowTop}>
          <Text style={styles.rowName} numberOfLines={1}>
            {chat.display_name || "Chat"}
            {isAi && <Text style={styles.aiTag}>  · AI</Text>}
          </Text>
          {!!last?.created_at && <Text style={styles.rowTime}>{formatTime(last.created_at)}</Text>}
        </View>
        <View style={styles.rowBot}>
          <Text style={styles.rowPreview} numberOfLines={1}>{preview}</Text>
          {!!chat.unread && chat.unread > 0 && (
            <View style={styles.badge}><Text style={styles.badgeText}>{chat.unread}</Text></View>
          )}
        </View>
      </View>
    </TouchableOpacity>
  );
}

/* -------------------------------------------------------------- ChatPane */

function ChatPane({ chat, me }: { chat: Chat; me: any }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [peerPub, setPeerPub] = useState<string | null>(null);
  const [plain, setPlain] = useState<Record<string, string>>({});
  const listRef = useRef<FlatList>(null);
  const isAi = chat.member_ids?.includes(AI_USER_ID);
  const peerId = chat.member_ids?.find((m) => m !== me?.id && m !== AI_USER_ID);
  const isE2EE = !!peerPub && !isAi && !chat.is_group;

  // Fetch peer's public key
  useEffect(() => {
    if (!peerId || isAi) return;
    let cancel = false;
    getPeerPublicKey(peerId).then((pk) => { if (!cancel) setPeerPub(pk); });
    return () => { cancel = true; };
  }, [peerId, isAi]);

  // Load messages when the chat changes
  useEffect(() => {
    (async () => {
      try {
        const msgs = await api<Message[]>(`/chats/${chat.id}/messages`);
        setMessages(msgs);
        setTimeout(() => listRef.current?.scrollToEnd({ animated: false }), 50);
      } catch { setMessages([]); }
    })();
  }, [chat.id]);

  // Decrypt any E2EE messages we haven't cached yet.
  useEffect(() => {
    if (!peerPub) return;
    const need = messages.filter((m) => m.e2ee && m.ciphertext && m.nonce && !(m.id in plain));
    if (!need.length) return;
    let cancel = false;
    (async () => {
      const patch: Record<string, string> = {};
      for (const m of need) {
        try {
          const p = await decryptFromPeer(m.ciphertext!, m.nonce!, peerPub!);
          patch[m.id] = p ?? "";
        } catch { patch[m.id] = ""; }
      }
      if (!cancel) setPlain((prev) => ({ ...prev, ...patch }));
    })();
    return () => { cancel = true; };
  }, [messages, peerPub, plain]);

  // Subscribe to WebSocket for real-time
  const { subscribe } = useAuth();
  useEffect(() => {
    return subscribe((msg: any) => {
      if (msg.type === "new_message" && msg.chat_id === chat.id) {
        setMessages((prev) => prev.some((x) => x.id === msg.message.id) ? prev : [...prev, msg.message]);
      }
    });
  }, [subscribe, chat.id]);

  const send = async () => {
    if (!text.trim() || sending) return;
    const t = text;
    setText("");
    setSending(true);
    try {
      let payload: any = { chat_id: chat.id, type: "text", content: t };
      if (isE2EE && peerPub) {
        const enc = await encryptForPeer(t, peerPub);
        payload = { chat_id: chat.id, type: "text", content: "", ...enc };
      }
      const msg = await api<Message>(`/chats/${chat.id}/messages`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      if (msg?.e2ee && msg?.id) setPlain((p) => ({ ...p, [msg.id]: t }));
      setMessages((prev) => prev.some((x) => x.id === msg.id) ? prev : [...prev, msg]);
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 50);
    } catch {
      // silent for now
    } finally { setSending(false); }
  };

  const displayText = (m: Message) => {
    if (m.e2ee) return plain[m.id] ?? "🔒 Decrypting…";
    return m.content;
  };

  return (
    <View style={styles.paneRoot}>
      {/* Header ---------------------------------------------------------- */}
      <View style={styles.paneHeader}>
        <View style={[styles.paneAvatar, isAi && { backgroundColor: colors.accent }]}>
          <Text style={styles.avatarLetter}>{(chat.display_name || "?").charAt(0).toUpperCase()}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.paneName}>{chat.display_name || "Chat"}</Text>
          <Text style={styles.paneSub}>
            {isAi ? "Always available" : isE2EE ? "End-to-end encrypted" : "online"}
          </Text>
        </View>
        {isE2EE && (
          <Ionicons name="lock-closed" size={14} color={colors.textMuted} testID="web-chat-lock" />
        )}
      </View>

      {/* Messages -------------------------------------------------------- */}
      <View style={styles.msgsWrap}>
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={(m) => m.id}
          contentContainerStyle={{ padding: 20, paddingBottom: 12 }}
          renderItem={({ item }) => {
            const mine = item.sender_id === me?.id;
            const decrypting = item.e2ee && !(item.id in plain);
            return (
              <View style={[styles.bubRow, mine ? styles.bubRowMine : styles.bubRowTheirs]}>
                <View style={[styles.bubble, mine ? styles.bubMine : styles.bubTheir]}>
                  {item.type === "text" && (
                    <Text style={[styles.bubText, mine && { color: "#fff" }]}>
                      {decrypting ? "🔒 Decrypting…" : displayText(item)}
                    </Text>
                  )}
                  {item.type !== "text" && (
                    <Text style={[styles.bubText, mine && { color: "#fff" }, { fontStyle: "italic" }]}>
                      {item.type === "image" ? "📷 Photo (open in mobile app)" : "🎤 Voice note (open in mobile app)"}
                    </Text>
                  )}
                  <View style={styles.bubMeta}>
                    {item.e2ee && <Ionicons name="lock-closed" size={9} color={mine ? "rgba(255,255,255,0.6)" : colors.textMuted} />}
                    <Text style={[styles.bubTime, mine && { color: "rgba(255,255,255,0.75)" }]}>
                      {formatTime(item.created_at)}
                    </Text>
                  </View>
                </View>
              </View>
            );
          }}
          ListEmptyComponent={
            <View style={styles.paneEmpty}>
              <Ionicons name="chatbubble-outline" size={38} color={colors.border} />
              <Text style={styles.paneEmptyText}>
                {isAi ? "Say hi to W AI 👋" : "No messages yet — send the first one!"}
              </Text>
            </View>
          }
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
        />
      </View>

      {/* Composer -------------------------------------------------------- */}
      <View style={styles.composer}>
        <View style={styles.composerBox}>
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder="Type a message"
            placeholderTextColor={colors.textMuted}
            style={styles.composerInput}
            onSubmitEditing={send}
            returnKeyType="send"
            testID="web-chat-input"
            multiline
          />
        </View>
        <TouchableOpacity
          style={[styles.sendBtn, (!text.trim() || sending) && { opacity: 0.4 }]}
          onPress={send}
          disabled={!text.trim() || sending}
          testID="web-chat-send"
        >
          {sending
            ? <ActivityIndicator color="#fff" size="small" />
            : <Ionicons name="send" size={18} color="#fff" />}
        </TouchableOpacity>
      </View>
    </View>
  );
}

/* -------------------------------------------------------------- EmptyPane */

function EmptyPane() {
  return (
    <View style={styles.paneEmpty}>
      <Ionicons name="chatbubbles" size={64} color={colors.border} />
      <Text style={styles.paneEmptyTitle}>Select a chat</Text>
      <Text style={styles.paneEmptyText}>Choose a conversation from the list to start reading.</Text>
    </View>
  );
}

/* -------------------------------------------------------------- helpers */

function formatTime(iso: string) {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }
  const diff = (now.getTime() - d.getTime()) / 86400000;
  if (diff < 7) return d.toLocaleDateString([], { weekday: "short" });
  return d.toLocaleDateString([], { day: "2-digit", month: "short" });
}

/* -------------------------------------------------------------- styles */

const LIST_W = 340;
const CHAT_BG = "#EFF6F8";

const styles = StyleSheet.create({
  root: { flex: 1, flexDirection: "row", minHeight: 0 },

  /* ---- list column ---- */
  listCol: {
    width: LIST_W,
    borderRightWidth: 1,
    borderRightColor: colors.border,
    backgroundColor: colors.surface,
    ...(Platform.OS === "web" ? ({ overflowY: "hidden" } as any) : {}),
  },
  listHeader: {
    paddingHorizontal: 20, paddingTop: 20, paddingBottom: 10,
  },
  listTitle: { fontSize: 20, fontWeight: "800", color: colors.text, letterSpacing: -0.3 },
  searchWrap: {
    flexDirection: "row", alignItems: "center", gap: 8,
    marginHorizontal: 16, marginBottom: 8,
    paddingHorizontal: 12, paddingVertical: 8,
    borderRadius: radius.md,
    backgroundColor: colors.surface2,
  },
  searchInput: {
    flex: 1, fontSize: 13, color: colors.text,
    ...(Platform.OS === "web" ? ({ outlineStyle: "none" } as any) : {}),
  },
  row: {
    flexDirection: "row", alignItems: "center", gap: 12,
    paddingHorizontal: 16, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: colors.border,
    ...(Platform.OS === "web" ? ({ cursor: "pointer" } as any) : {}),
  },
  rowActive: { backgroundColor: "#EBF4F6" },
  avatar: {
    width: 42, height: 42, borderRadius: 21,
    backgroundColor: colors.primaryLight,
    alignItems: "center", justifyContent: "center",
  },
  avatarLetter: { color: "#fff", fontWeight: "800", fontSize: 15 },
  rowTop: { flexDirection: "row", alignItems: "center", gap: 8 },
  rowName: { flex: 1, fontSize: 14, fontWeight: "700", color: colors.text },
  aiTag: { color: colors.accent, fontWeight: "800", fontSize: 11 },
  rowTime: { fontSize: 11, color: colors.textMuted },
  rowBot: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 2 },
  rowPreview: { flex: 1, fontSize: 12, color: colors.textMuted },
  badge: {
    backgroundColor: colors.accent, minWidth: 18, height: 18, borderRadius: 9,
    paddingHorizontal: 5, alignItems: "center", justifyContent: "center",
  },
  badgeText: { color: "#fff", fontWeight: "800", fontSize: 10 },
  emptyList: { textAlign: "center", color: colors.textMuted, marginTop: 40, fontSize: 13, paddingHorizontal: 30 },

  /* ---- chat pane column ---- */
  chatCol: {
    flex: 1,
    backgroundColor: CHAT_BG,
    minWidth: 0,
  },
  paneRoot: { flex: 1, minHeight: 0 },
  paneHeader: {
    flexDirection: "row", alignItems: "center", gap: 12,
    paddingHorizontal: 20, paddingVertical: 12,
    backgroundColor: colors.surface,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  paneAvatar: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: colors.primaryLight,
    alignItems: "center", justifyContent: "center",
  },
  paneName: { fontSize: 15, fontWeight: "800", color: colors.text },
  paneSub: { fontSize: 12, color: colors.textMuted, marginTop: 1 },

  msgsWrap: {
    flex: 1, minHeight: 0,
    ...(Platform.OS === "web" ? ({ overflowY: "auto" } as any) : {}),
  },

  bubRow: { flexDirection: "row", marginBottom: 8 },
  bubRowMine: { justifyContent: "flex-end" },
  bubRowTheirs: { justifyContent: "flex-start" },
  bubble: { maxWidth: "72%", paddingHorizontal: 12, paddingVertical: 8, borderRadius: 12 },
  bubMine: { backgroundColor: colors.primary, borderBottomRightRadius: 4 },
  bubTheir: { backgroundColor: "#fff", borderBottomLeftRadius: 4, borderWidth: 1, borderColor: colors.border },
  bubText: { fontSize: 14, color: colors.text, lineHeight: 20 },
  bubMeta: {
    flexDirection: "row", alignItems: "center", gap: 4,
    alignSelf: "flex-end", marginTop: 4,
  },
  bubTime: { fontSize: 10, color: colors.textMuted },

  composer: {
    flexDirection: "row", alignItems: "flex-end", gap: 8,
    padding: 12,
    backgroundColor: colors.surface,
    borderTopWidth: 1, borderTopColor: colors.border,
  },
  composerBox: {
    flex: 1,
    backgroundColor: colors.surface2,
    borderRadius: 22,
    paddingHorizontal: 16, paddingVertical: 8,
    minHeight: 40, maxHeight: 140,
    justifyContent: "center",
  },
  composerInput: {
    fontSize: 14, color: colors.text, lineHeight: 20,
    ...(Platform.OS === "web" ? ({ outlineStyle: "none" } as any) : {}),
  },
  sendBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: colors.primary,
    alignItems: "center", justifyContent: "center",
  },

  paneEmpty: {
    flex: 1, alignItems: "center", justifyContent: "center", gap: 8, padding: 40,
  },
  paneEmptyTitle: { fontSize: 18, fontWeight: "800", color: colors.text, marginTop: 12 },
  paneEmptyText: { fontSize: 13, color: colors.textMuted, textAlign: "center" },
});
