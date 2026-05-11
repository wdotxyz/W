import React, { useEffect, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Image, Linking, Platform, Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as FileSystem from "expo-file-system";
import { api } from "../../src/api";
import { colors, radius, space } from "../../src/theme";

export default function MailDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [mail, setMail] = useState<any>(null);
  const [showHtml, setShowHtml] = useState(true);

  useEffect(() => {
    api<any>(`/mail/${id}`).then(setMail).catch(() => setMail(null));
  }, [id]);

  const onReply = () => {
    if (!mail) return;
    router.push({
      pathname: "/mail/compose",
      params: {
        to: mail.from_addr,
        subject: mail.subject?.toLowerCase().startsWith("re:") ? mail.subject : `Re: ${mail.subject}`,
        inReplyTo: mail.message_id || "",
        threadId: mail.thread_id || "",
      },
    });
  };

  const downloadAttachment = async (a: any) => {
    if (Platform.OS === "web") {
      try {
        const link = document.createElement("a");
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

  if (!mail) {
    return (
      <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}><Ionicons name="chevron-back" size={26} color={colors.text} /></TouchableOpacity>
        </View>
        <ActivityIndicator color={colors.accent} style={{ marginTop: 40 }} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} testID="mail-back">
          <Ionicons name="chevron-back" size={26} color={colors.text} />
        </TouchableOpacity>
        <TouchableOpacity onPress={onReply} style={styles.replyBtn} testID="mail-reply">
          <Ionicons name="arrow-undo" size={18} color={colors.primary} />
          <Text style={styles.replyText}>Reply</Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={{ padding: space.xl, paddingBottom: 60 }}>
        <Text style={styles.subject} testID="mail-subject">{mail.subject}</Text>

        <View style={styles.metaRow}>
          <View style={styles.avatar}><Text style={styles.avatarTxt}>{(mail.from_name || mail.from_addr || "?").charAt(0).toUpperCase()}</Text></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.fromName}>{mail.from_name || mail.from_addr}</Text>
            <Text style={styles.fromAddr}>{mail.from_addr}</Text>
            <Text style={styles.toLine}>to {(mail.to_addrs || []).join(", ")}</Text>
          </View>
          <Text style={styles.time}>{new Date(mail.created_at).toLocaleString([], { day: "2-digit", month: "short", hour: "numeric", minute: "2-digit" })}</Text>
        </View>

        {mail.delivery_status === "saved_no_provider" && (
          <View style={styles.banner} testID="mail-not-sent-banner">
            <Ionicons name="information-circle" size={18} color={colors.accent} />
            <Text style={styles.bannerText}>{mail.delivery_error}</Text>
          </View>
        )}

        {!!mail.body_html && Platform.OS === "web" ? (
          <View style={styles.htmlToggleRow}>
            <TouchableOpacity onPress={() => setShowHtml(true)} style={[styles.htmlTab, showHtml && styles.htmlTabOn]} testID="html-tab-rich">
              <Text style={[styles.htmlTabText, showHtml && styles.htmlTabTextOn]}>Rich</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setShowHtml(false)} style={[styles.htmlTab, !showHtml && styles.htmlTabOn]} testID="html-tab-plain">
              <Text style={[styles.htmlTabText, !showHtml && styles.htmlTabTextOn]}>Plain</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {showHtml && !!mail.body_html && Platform.OS === "web" ? (
          // @ts-ignore — RN-Web renders div; use innerHTML for sanitized HTML body.
          React.createElement("div", {
            "data-testid": "mail-body-html",
            style: { marginTop: 20, fontSize: 15, color: colors.text, lineHeight: 1.55, wordBreak: "break-word" },
            dangerouslySetInnerHTML: { __html: mail.body_html },
          })
        ) : (
          <Text style={styles.body} testID="mail-body">{mail.body}</Text>
        )}

        {!!mail.attachments?.length && (
          <View style={styles.atts}>
            <Text style={styles.attsTitle}>Attachments</Text>
            {mail.attachments.map((a: any, i: number) => (
              <TouchableOpacity key={i} style={styles.attRow} onPress={() => downloadAttachment(a)} testID={`att-${i}`}>
                {a.type?.startsWith("image/") && a.content_b64 ? (
                  <Image source={{ uri: `data:${a.type};base64,${a.content_b64}` }} style={styles.attThumb} />
                ) : (
                  <View style={[styles.attThumb, { alignItems: "center", justifyContent: "center", backgroundColor: colors.surface2 }]}>
                    <Ionicons name="document" size={22} color={colors.accent} />
                  </View>
                )}
                <View style={{ flex: 1 }}>
                  <Text style={styles.attName} numberOfLines={1}>{a.filename}</Text>
                  <Text style={styles.attSize}>{prettySize(a.size)}</Text>
                </View>
                <Ionicons name="download" size={20} color={colors.accent} />
              </TouchableOpacity>
            ))}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function prettySize(n?: number) {
  if (!n) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 8, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: colors.border },
  backBtn: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  replyBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 14, paddingVertical: 8, borderRadius: radius.pill, backgroundColor: colors.surface2 },
  replyText: { fontWeight: "700", color: colors.primary },
  subject: { fontSize: 22, fontWeight: "800", color: colors.text, letterSpacing: -0.3, lineHeight: 28 },
  metaRow: { flexDirection: "row", alignItems: "center", marginTop: 18, gap: 12 },
  avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.primaryLight, alignItems: "center", justifyContent: "center" },
  avatarTxt: { color: "#fff", fontWeight: "800", fontSize: 18 },
  fromName: { fontSize: 15, fontWeight: "700", color: colors.text },
  fromAddr: { fontSize: 13, color: colors.textMuted },
  toLine: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  time: { fontSize: 12, color: colors.textMuted },
  banner: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 16, padding: 12, borderRadius: radius.md, backgroundColor: "#E8F5F7" },
  bannerText: { flex: 1, fontSize: 12, color: colors.text },
  htmlToggleRow: { flexDirection: "row", gap: 6, marginTop: 18 },
  htmlTab: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.pill, backgroundColor: colors.surface2 },
  htmlTabOn: { backgroundColor: colors.primary },
  htmlTabText: { fontSize: 12, color: colors.textMuted, fontWeight: "700" },
  htmlTabTextOn: { color: "#fff" },
  body: { marginTop: 22, fontSize: 15, color: colors.text, lineHeight: 23 },
  atts: { marginTop: 24, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 16 },
  attsTitle: { fontSize: 12, fontWeight: "800", color: colors.textMuted, letterSpacing: 1.2, textTransform: "uppercase", marginBottom: 10 },
  attRow: { flexDirection: "row", alignItems: "center", gap: 10, padding: 10, backgroundColor: colors.surface2, borderRadius: radius.md, marginBottom: 8 },
  attThumb: { width: 44, height: 44, borderRadius: 8 },
  attName: { fontSize: 14, color: colors.text, fontWeight: "600" },
  attSize: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
});
