import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator,
  Image, Linking, Platform, Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams, useNavigation } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as FileSystem from "expo-file-system";
import { api } from "../../../src/api";
import BlueCheck from "../../../src/components/BlueCheck";
import { colors, radius, space } from "../../../src/theme";

type Mail = any;

export default function ThreadView() {
  const { threadId } = useLocalSearchParams<{ threadId: string }>();
  const router = useRouter();
  const navigation = useNavigation();
  const [messages, setMessages] = useState<Mail[]>([]);
  const [loading, setLoading] = useState(true);
  const [starred, setStarred] = useState(false);
  const [ghostMail, setGhostMail] = useState(true);
  const [closing, setClosing] = useState(false);
  const closedRef = useRef(false);

  const load = useCallback(async () => {
    try {
      const res = await api<any>(`/mail/thread/${threadId}`);
      setMessages(res.messages || []);
      setStarred(!!res.is_starred);
      setGhostMail(!!res.ghost_mail_enabled);
    } catch (e: any) { Alert.alert("Couldn't open thread", e.message); router.back(); }
    finally { setLoading(false); }
  }, [threadId, router]);

  useEffect(() => { load(); }, [load]);

  // Ghost-Mail close hook: fired ONCE when navigating away.
  const fireClose = useCallback(async () => {
    if (closedRef.current) return;
    closedRef.current = true;
    if (!ghostMail || starred) return;
    try {
      await api(`/mail/thread/${threadId}/close`, { method: "POST" });
    } catch (e) { /* best-effort */ }
  }, [ghostMail, starred, threadId]);

  useEffect(() => {
    const unsub = navigation.addListener("beforeRemove", () => {
      // Don't block navigation; fire-and-forget
      fireClose();
    });
    return unsub;
  }, [navigation, fireClose]);

  const onStar = async () => {
    try {
      const path = starred ? `/mail/thread/${threadId}/unstar` : `/mail/thread/${threadId}/star`;
      await api(path, { method: "POST" });
      setStarred(!starred);
    } catch (e: any) { Alert.alert("Couldn't update", e.message); }
  };

  const onReply = (m: Mail) => {
    router.push({
      pathname: "/mail/compose",
      params: {
        to: m.from_addr,
        subject: m.subject?.toLowerCase().startsWith("re:") ? m.subject : `Re: ${m.subject}`,
        inReplyTo: m.message_id || "",
        threadId: m.thread_id || threadId,
      },
    });
  };

  const downloadAttachment = async (a: any) => {
    if (Platform.OS === "web") {
      try {
        const link = (document as any).createElement("a");
        link.href = `data:${a.type || "application/octet-stream"};base64,${a.content_b64}`;
        link.download = a.filename;
        link.click();
      } catch (e: any) { Alert.alert("Download failed", e.message); }
      return;
    }
    try {
      const dest = (FileSystem.cacheDirectory || "") + a.filename;
      await FileSystem.writeAsStringAsync(dest, a.content_b64, { encoding: FileSystem.EncodingType.Base64 });
      Alert.alert("Saved", `Saved to ${dest}`);
    } catch (e: any) { Alert.alert("Download failed", e.message); }
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn}><Ionicons name="chevron-back" size={26} color={colors.text} /></TouchableOpacity>
        </View>
        <ActivityIndicator color={colors.accent} style={{ marginTop: 40 }} />
      </SafeAreaView>
    );
  }

  if (!messages.length) {
    return (
      <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn}><Ionicons name="chevron-back" size={26} color={colors.text} /></TouchableOpacity>
        </View>
        <Text style={styles.empty}>Conversation no longer available.</Text>
      </SafeAreaView>
    );
  }

  const subject = messages[0]?.subject || "(no subject)";
  const showGhost = ghostMail && !starred;

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn} testID="thread-back">
          <Ionicons name="chevron-back" size={26} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>{subject}</Text>
        <TouchableOpacity
          onPress={onStar}
          style={[styles.starBtn, starred && styles.starBtnOn]}
          testID="thread-star"
          activeOpacity={0.75}
        >
          <Ionicons name={starred ? "star" : "star-outline"} size={18} color={starred ? "#fff" : colors.primary} />
          <Text style={[styles.starText, starred && { color: "#fff" }]}>{starred ? "Saved" : "Save"}</Text>
        </TouchableOpacity>
      </View>

      {showGhost && (
        <View style={styles.ghostBanner} testID="ghost-banner">
          <Text style={styles.ghostEmoji}>👻</Text>
          <View style={{ flex: 1 }}>
            <Text style={styles.ghostTitle}>Ghost Mail</Text>
            <Text style={styles.ghostSub}>This thread vanishes when you close it. Tap <Text style={styles.ghostBold}>Save</Text> to keep it.</Text>
          </View>
        </View>
      )}

      <ScrollView contentContainerStyle={{ padding: space.xl, paddingBottom: 60 }}>
        <Text style={styles.subject}>{subject}</Text>
        <Text style={styles.threadCount}>{messages.length} {messages.length === 1 ? "message" : "messages"} in thread</Text>

        {messages.map((m, i) => (
          <View key={m.id} style={[styles.msgCard, i > 0 && { marginTop: 14 }]} testID={`thread-msg-${i}`}>
            <View style={styles.metaRow}>
              <View style={styles.avatar}><Text style={styles.avatarTxt}>{(m.from_name || m.from_addr || "?").charAt(0).toUpperCase()}</Text></View>
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: "row", alignItems: "center" }}>
                  <Text style={styles.fromName}>{m.from_name || m.from_addr}</Text>
                  <BlueCheck tier={m.from_tier} size={13} />
                </View>
                <Text style={styles.fromAddr}>{m.from_addr}</Text>
                <Text style={styles.toLine}>to {(m.to_addrs || []).join(", ")}</Text>
              </View>
              <Text style={styles.time}>{new Date(m.created_at).toLocaleString([], { day: "2-digit", month: "short", hour: "numeric", minute: "2-digit" })}</Text>
            </View>

            {!!m.body_html && Platform.OS === "web" ? (
              // @ts-ignore — sanitized HTML on web only
              React.createElement("div", {
                style: { marginTop: 14, fontSize: 15, color: colors.text, lineHeight: 1.55, wordBreak: "break-word" },
                dangerouslySetInnerHTML: { __html: m.body_html },
              })
            ) : (
              <Text style={styles.body}>{m.body}</Text>
            )}

            {!!m.attachments?.length && (
              <View style={styles.atts}>
                {m.attachments.map((a: any, idx: number) => (
                  <TouchableOpacity key={idx} style={styles.attRow} onPress={() => downloadAttachment(a)}>
                    {a.type?.startsWith("image/") && a.content_b64 ? (
                      <Image source={{ uri: `data:${a.type};base64,${a.content_b64}` }} style={styles.attThumb} />
                    ) : (
                      <View style={[styles.attThumb, { alignItems: "center", justifyContent: "center", backgroundColor: colors.surface2 }]}>
                        <Ionicons name="document" size={20} color={colors.accent} />
                      </View>
                    )}
                    <Text style={styles.attName} numberOfLines={1}>{a.filename}</Text>
                    <Ionicons name="download" size={18} color={colors.accent} />
                  </TouchableOpacity>
                ))}
              </View>
            )}

            <TouchableOpacity onPress={() => onReply(m)} style={styles.replyBtn} testID={`reply-${i}`}>
              <Ionicons name="arrow-undo" size={16} color={colors.primary} />
              <Text style={styles.replyText}>Reply</Text>
            </TouchableOpacity>
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: "row", alignItems: "center", padding: space.md, gap: 8, borderBottomWidth: 1, borderBottomColor: colors.border },
  iconBtn: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  headerTitle: { flex: 1, fontSize: 16, fontWeight: "800", color: colors.text },
  starBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.pill, backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.border },
  starBtnOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  starText: { fontWeight: "700", color: colors.primary, fontSize: 13 },
  ghostBanner: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: "#FFF4E5", padding: 12, marginHorizontal: space.lg, marginTop: 10, borderRadius: radius.lg, borderWidth: 1, borderColor: "#FFE0B2" },
  ghostEmoji: { fontSize: 26 },
  ghostTitle: { fontSize: 14, fontWeight: "800", color: "#7A4A00" },
  ghostSub: { fontSize: 12.5, color: "#8A5A1A", marginTop: 2, lineHeight: 17 },
  ghostBold: { fontWeight: "800" },
  subject: { fontSize: 22, fontWeight: "800", color: colors.text, letterSpacing: -0.3, lineHeight: 28 },
  threadCount: { color: colors.textMuted, fontSize: 12, marginTop: 4 },
  msgCard: { marginTop: 18, backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: 14 },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  avatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.primaryLight, alignItems: "center", justifyContent: "center" },
  avatarTxt: { color: "#fff", fontWeight: "800", fontSize: 16 },
  fromName: { fontSize: 14, fontWeight: "700", color: colors.text },
  fromAddr: { fontSize: 12, color: colors.textMuted },
  toLine: { fontSize: 11, color: colors.textMuted, marginTop: 2 },
  time: { fontSize: 11, color: colors.textMuted },
  body: { marginTop: 14, fontSize: 15, color: colors.text, lineHeight: 22 },
  atts: { marginTop: 14, gap: 6 },
  attRow: { flexDirection: "row", alignItems: "center", gap: 10, padding: 8, backgroundColor: colors.surface2, borderRadius: radius.md },
  attThumb: { width: 36, height: 36, borderRadius: 6 },
  attName: { flex: 1, fontSize: 13, color: colors.text },
  replyBtn: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 12, alignSelf: "flex-start", paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.pill, backgroundColor: colors.surface2 },
  replyText: { fontWeight: "700", color: colors.primary, fontSize: 13 },
  empty: { textAlign: "center", marginTop: 60, color: colors.textMuted },
});
