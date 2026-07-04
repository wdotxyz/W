/**
 * Gmail-style inbox (web only).
 *
 * Layout:
 *   ┌─ mail list ─┐┌─ reader pane ──────┐
 *   │ row           ││ subject           │
 *   │ row           ││ from  →  to      │
 *   │ row           ││ body…             │
 *   └───────────────┘└──────────────────┘
 *
 * Reads the ?folder= query so the sidebar labels (Starred, Sent, Promos, …)
 * change which endpoint is hit. Defaults to inbox.
 *
 * NOTE: This file is only mounted for the web build. The native mobile
 * app never imports it.
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity, FlatList, ActivityIndicator,
  ScrollView, Platform,
} from "react-native";
import { useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { api } from "../../src/api";
import { colors, radius } from "../../src/theme";
import { useWebCompose } from "../../src/webCompose";

type Mail = {
  id: string;
  from_name?: string;
  from_addr?: string;
  from_tier?: string;
  to_addrs?: string[];
  subject?: string;
  body?: string;
  body_html?: string;
  snippet?: string;
  read?: boolean;
  starred?: boolean;
  created_at: string;
  thread_id?: string;
  attachments?: any[];
  delivery_status?: string;
};

const FOLDER_ENDPOINTS: Record<string, string> = {
  inbox: "/mail/inbox",
  starred: "/mail/starred",
  sent: "/mail/sent",
  drafts: "/mail/drafts",
  promotions: "/mail/promotions",
  spam: "/mail/spam",
  snoozed: "/mail/snoozed",
};

const FOLDER_TITLES: Record<string, string> = {
  inbox: "Inbox",
  starred: "Starred",
  sent: "Sent",
  drafts: "Drafts",
  promotions: "Promos",
  spam: "Spam",
  snoozed: "Snoozed",
};

export default function WebInbox() {
  const { openCompose } = useWebCompose();
  const params = useLocalSearchParams<{ folder?: string; open?: string }>();
  const folder = (params.folder as string) || "inbox";
  const openId = (params.open as string) || null;

  const [mails, setMails] = useState<Mail[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Mail | null>(null);
  const [readerLoading, setReaderLoading] = useState(false);

  const endpoint = FOLDER_ENDPOINTS[folder] || "/mail/inbox";
  const title = FOLDER_TITLES[folder] || "Inbox";

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api<Mail[]>(endpoint);
      setMails(data || []);
    } catch {
      setMails([]);
    } finally {
      setLoading(false);
    }
  }, [endpoint]);

  useEffect(() => { load(); }, [load]);

  // Clear selection when the folder changes.
  useEffect(() => { setSelected(null); }, [folder]);

  // Deep-link ?open=<id> — auto-open a specific message.
  useEffect(() => {
    if (!openId) return;
    (async () => {
      setReaderLoading(true);
      try {
        const m = await api<Mail>(`/mail/${openId}`);
        setSelected(m);
      } catch { /* ignore */ }
      finally { setReaderLoading(false); }
    })();
  }, [openId]);

  const onSelect = async (m: Mail) => {
    setSelected(m);
    setReaderLoading(true);
    try {
      const full = await api<Mail>(`/mail/${m.id}`);
      setSelected(full);
      // mark read locally
      if (!m.read) {
        setMails((prev) => prev.map((x) => x.id === m.id ? { ...x, read: true } : x));
        api(`/mail/${m.id}/read`, { method: "PATCH" }).catch(() => {});
      }
    } catch { /* keep the row-level object */ }
    finally { setReaderLoading(false); }
  };

  const onReply = () => {
    if (!selected) return;
    openCompose({
      to: selected.from_addr || "",
      subject: selected.subject?.toLowerCase().startsWith("re:") ? selected.subject : `Re: ${selected.subject || ""}`,
      inReplyTo: selected.thread_id || "",
    });
  };

  const onDelete = async () => {
    if (!selected) return;
    if (Platform.OS === "web" && typeof window !== "undefined" && !window.confirm("Delete this email?")) return;
    try {
      await api(`/mail/${selected.id}`, { method: "DELETE" });
      setMails((p) => p.filter((x) => x.id !== selected.id));
      setSelected(null);
    } catch { /* ignore */ }
  };

  const onStar = async () => {
    if (!selected) return;
    const next = !selected.starred;
    setSelected({ ...selected, starred: next });
    setMails((p) => p.map((x) => x.id === selected.id ? { ...x, starred: next } : x));
    try { await api(`/mail/${selected.id}/star`, { method: "PATCH" }); } catch { /* ignore */ }
  };

  const listData = useMemo(() => mails, [mails]);

  return (
    <View style={styles.root} testID="web-inbox-root">
      {/* Toolbar --------------------------------------------------------- */}
      <View style={styles.toolbar}>
        <Text style={styles.title}>{title}</Text>
        <View style={{ flex: 1 }} />
        <TouchableOpacity onPress={load} style={styles.toolBtn} testID="web-refresh">
          <Ionicons name="refresh" size={18} color={colors.textMuted} />
        </TouchableOpacity>
        <Text style={styles.counter}>{listData.length}</Text>
      </View>

      {/* Two-column body ------------------------------------------------- */}
      <View style={styles.body}>
        <View style={[styles.listCol, !!selected && styles.listColNarrow]}>
          {loading ? (
            <ActivityIndicator color={colors.accent} style={{ marginTop: 40 }} />
          ) : (
            <FlatList
              data={listData}
              keyExtractor={(m) => m.id}
              renderItem={({ item }) => (
                <MailRow
                  mail={item}
                  active={selected?.id === item.id}
                  onPress={() => onSelect(item)}
                />
              )}
              ListEmptyComponent={<Text style={styles.empty}>Nothing here yet.</Text>}
            />
          )}
        </View>

        {selected && (
          <View style={styles.readerCol}>
            <MailReader
              mail={selected}
              loading={readerLoading}
              onReply={onReply}
              onDelete={onDelete}
              onStar={onStar}
              onClose={() => setSelected(null)}
            />
          </View>
        )}
      </View>
    </View>
  );
}

/* ------------------------------------------------------------- MailRow -- */

function MailRow({ mail, active, onPress }: { mail: Mail; active: boolean; onPress: () => void }) {
  const name = mail.from_name || mail.from_addr || "(no sender)";
  const preview = mail.snippet || mail.body?.slice(0, 120) || "";
  const when = new Date(mail.created_at);
  const timeText = isToday(when)
    ? when.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : when.toLocaleDateString([], { day: "2-digit", month: "short" });

  return (
    <TouchableOpacity
      onPress={onPress}
      style={[
        styles.row,
        !mail.read && styles.rowUnread,
        active && styles.rowActive,
      ]}
      testID={`web-mail-row-${mail.id}`}
      activeOpacity={0.7}
    >
      <Ionicons
        name={mail.starred ? "star" : "star-outline"}
        size={16}
        color={mail.starred ? "#F5C518" : colors.border}
        style={{ marginRight: 10 }}
      />
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={styles.rowTop}>
          <Text style={[styles.rowName, !mail.read && styles.rowNameUnread]} numberOfLines={1}>{name}</Text>
          <Text style={styles.rowTime}>{timeText}</Text>
        </View>
        <Text style={[styles.rowSubject, !mail.read && styles.rowSubjectUnread]} numberOfLines={1}>
          {mail.subject || "(no subject)"}
        </Text>
        {!!preview && <Text style={styles.rowSnippet} numberOfLines={1}>{preview}</Text>}
      </View>
    </TouchableOpacity>
  );
}

function isToday(d: Date) {
  const n = new Date();
  return d.getDate() === n.getDate() && d.getMonth() === n.getMonth() && d.getFullYear() === n.getFullYear();
}

/* ---------------------------------------------------------- MailReader -- */

function MailReader({
  mail, loading, onReply, onDelete, onStar, onClose,
}: {
  mail: Mail; loading: boolean; onReply: () => void; onDelete: () => void; onStar: () => void; onClose: () => void;
}) {
  return (
    <View style={styles.reader}>
      <View style={styles.readerBar}>
        <TouchableOpacity onPress={onClose} style={styles.readerBtn} testID="web-reader-close">
          <Ionicons name="arrow-back" size={18} color={colors.textMuted} />
        </TouchableOpacity>
        <View style={{ flex: 1 }} />
        <TouchableOpacity onPress={onStar} style={styles.readerBtn} testID="web-reader-star">
          <Ionicons name={mail.starred ? "star" : "star-outline"} size={18} color={mail.starred ? "#F5C518" : colors.textMuted} />
        </TouchableOpacity>
        <TouchableOpacity onPress={onDelete} style={styles.readerBtn} testID="web-reader-delete">
          <Ionicons name="trash-outline" size={18} color={colors.textMuted} />
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={{ padding: 28, paddingBottom: 80 }}>
        <Text style={styles.subject} selectable>{mail.subject || "(no subject)"}</Text>

        <View style={styles.metaRow}>
          <View style={styles.avatar}>
            <Text style={styles.avatarLetter}>{(mail.from_name || mail.from_addr || "?").charAt(0).toUpperCase()}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.fromName}>{mail.from_name || mail.from_addr}</Text>
            <Text style={styles.fromAddr}>{mail.from_addr}</Text>
            <Text style={styles.toLine}>to {(mail.to_addrs || []).join(", ")}</Text>
          </View>
          <Text style={styles.timeText}>
            {new Date(mail.created_at).toLocaleString([], { day: "2-digit", month: "short", hour: "numeric", minute: "2-digit" })}
          </Text>
        </View>

        {loading ? (
          <ActivityIndicator color={colors.accent} style={{ marginTop: 20 }} />
        ) : (
          <View style={{ marginTop: 20 }}>
            {!!mail.body_html && Platform.OS === "web"
              // @ts-ignore
              ? React.createElement("div", {
                  "data-testid": "web-mail-body-html",
                  style: {
                    fontSize: 15,
                    color: colors.text,
                    lineHeight: 1.6,
                    wordBreak: "break-word",
                    maxWidth: 720,
                  },
                  dangerouslySetInnerHTML: { __html: mail.body_html },
                })
              : <Text style={styles.body}>{mail.body || ""}</Text>}
          </View>
        )}

        <View style={{ height: 24 }} />
        <TouchableOpacity onPress={onReply} style={styles.replyBtn} testID="web-reader-reply" activeOpacity={0.85}>
          <Ionicons name="arrow-undo" size={16} color="#fff" />
          <Text style={styles.replyText}>Reply</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const LIST_MAX = 460;

const styles = StyleSheet.create({
  root: { flex: 1 },
  toolbar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 24,
    paddingTop: 20,
    paddingBottom: 12,
    gap: 10,
  },
  title: { fontSize: 20, fontWeight: "700", color: colors.text, letterSpacing: -0.3 },
  toolBtn: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center" },
  counter: { fontSize: 12, color: colors.textMuted, marginLeft: 4, marginRight: 6 },

  body: { flex: 1, flexDirection: "row", minHeight: 0 },

  listCol: {
    flex: 1,
    borderRightWidth: 1,
    borderRightColor: colors.border,
    ...(Platform.OS === "web" ? ({ overflowY: "auto" } as any) : {}),
  },
  listColNarrow: {
    flex: 0,
    width: LIST_MAX,
    minWidth: 380,
  },

  readerCol: {
    flex: 1,
    backgroundColor: colors.surface,
    ...(Platform.OS === "web" ? ({ overflowY: "auto" } as any) : {}),
  },
  readerColEmpty: {
    flex: 1,
    backgroundColor: colors.surface,
    ...(Platform.OS === "web" ? ({ overflowY: "auto" } as any) : {}),
  },

  emptyReader: { flex: 1, alignItems: "center", justifyContent: "center", gap: 8 },
  emptyReaderText: { color: colors.textMuted, fontSize: 14 },

  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    ...(Platform.OS === "web" ? ({ cursor: "pointer" } as any) : {}),
  },
  rowUnread: { backgroundColor: colors.surface },
  rowActive: { backgroundColor: "#EBF4F6" },
  rowTop: { flexDirection: "row", alignItems: "center", gap: 8 },
  rowName: { flex: 1, fontSize: 13, color: colors.textMuted },
  rowNameUnread: { color: colors.text, fontWeight: "700" },
  rowTime: { fontSize: 11, color: colors.textMuted },
  rowSubject: { fontSize: 13, color: colors.textMuted, marginTop: 2 },
  rowSubjectUnread: { color: colors.text, fontWeight: "600" },
  rowSnippet: { fontSize: 12, color: colors.textMuted, marginTop: 2 },

  empty: { textAlign: "center", color: colors.textMuted, marginTop: 60, fontSize: 14 },

  reader: { flex: 1 },
  readerBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.surface,
    gap: 4,
  },
  readerBtn: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center" },
  subject: { fontSize: 24, fontWeight: "700", color: colors.text, letterSpacing: -0.4, lineHeight: 30 },
  metaRow: { flexDirection: "row", alignItems: "center", marginTop: 18, gap: 12 },
  avatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.primaryLight, alignItems: "center", justifyContent: "center" },
  avatarLetter: { color: "#fff", fontWeight: "800", fontSize: 15 },
  fromName: { fontSize: 14, fontWeight: "700", color: colors.text },
  fromAddr: { fontSize: 12, color: colors.textMuted },
  toLine: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  timeText: { fontSize: 12, color: colors.textMuted },

  replyBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: colors.primary,
    borderRadius: radius.pill,
    paddingHorizontal: 20,
    paddingVertical: 10,
    alignSelf: "flex-start",
  },
  replyText: { color: "#fff", fontWeight: "700", fontSize: 14 },
});
