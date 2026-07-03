/**
 * Gmail-style floating compose panel.
 *
 * Sits absolutely positioned at the bottom-right of the /web viewport.
 * Header actions: Expand (jumps to the full /mail/compose editor for
 * attachments/AI/voice), Close (dismisses the panel and its draft).
 *
 * MVP scope: to / subject / body / send. Advanced features (AI, voice,
 * attachments, drafts) live in the full-screen /mail/compose route.
 */
import React, { useState } from "react";
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity,
  ActivityIndicator, Alert, Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { api } from "../../src/api";
import { useWebCompose } from "../../src/webCompose";
import { colors, radius } from "../../src/theme";

export default function WebComposePanel() {
  const { open, prefill, closeCompose } = useWebCompose();
  const router = useRouter();
  const [to, setTo] = useState(prefill.to || "");
  const [subject, setSubject] = useState(prefill.subject || "");
  const [body, setBody] = useState(prefill.body || "");
  const [sending, setSending] = useState(false);

  // Reset the fields whenever the panel re-opens with new prefill.
  React.useEffect(() => {
    if (open) {
      setTo(prefill.to || "");
      setSubject(prefill.subject || "");
      setBody(prefill.body || "");
    }
  }, [open, prefill.to, prefill.subject, prefill.body]);

  if (!open) return null;

  const onSend = async () => {
    if (sending) return;
    if (!to.trim() || !body.trim()) {
      Alert.alert("Missing fields", "Please add at least a recipient and message.");
      return;
    }
    setSending(true);
    try {
      await api("/mail/compose", {
        method: "POST",
        body: JSON.stringify({
          to_addrs: to.split(",").map((s) => s.trim()).filter(Boolean),
          subject: subject.trim(),
          body: body,
          in_reply_to: prefill.inReplyTo || null,
          thread_id: prefill.threadId || null,
        }),
      });
      closeCompose();
    } catch (e: any) {
      Alert.alert("Send failed", e?.message || "Please try again.");
    } finally {
      setSending(false);
    }
  };

  const onExpand = () => {
    // Hand off current draft to the full-screen editor.
    closeCompose();
    router.push({
      pathname: "/mail/compose",
      params: {
        to,
        subject,
        body,
        inReplyTo: prefill.inReplyTo || "",
        threadId: prefill.threadId || "",
      },
    });
  };

  return (
    <View style={styles.wrap} testID="web-compose-panel" pointerEvents="box-none">
      <View style={styles.panel}>
        <View style={styles.header}>
          <Text style={styles.headerText}>New message</Text>
          <View style={{ flexDirection: "row", gap: 4 }}>
            <TouchableOpacity onPress={onExpand} style={styles.headerBtn} testID="compose-expand">
              <Ionicons name="expand-outline" size={16} color="#fff" />
            </TouchableOpacity>
            <TouchableOpacity onPress={closeCompose} style={styles.headerBtn} testID="compose-close">
              <Ionicons name="close" size={18} color="#fff" />
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.body}>
          <View style={styles.field}>
            <Text style={styles.fieldLabel}>To</Text>
            <TextInput
              value={to}
              onChangeText={setTo}
              placeholder="recipients"
              placeholderTextColor={colors.textMuted}
              style={styles.fieldInput}
              autoCapitalize="none"
              testID="compose-to"
            />
          </View>
          <View style={styles.field}>
            <TextInput
              value={subject}
              onChangeText={setSubject}
              placeholder="Subject"
              placeholderTextColor={colors.textMuted}
              style={[styles.fieldInput, { paddingLeft: 0, fontWeight: "600" }]}
              testID="compose-subject"
            />
          </View>

          <TextInput
            value={body}
            onChangeText={setBody}
            placeholder="Write your message…"
            placeholderTextColor={colors.textMuted}
            style={styles.bodyInput}
            multiline
            textAlignVertical="top"
            testID="compose-body"
          />
        </View>

        <View style={styles.footer}>
          <TouchableOpacity
            onPress={onSend}
            style={[styles.sendBtn, sending && { opacity: 0.6 }]}
            disabled={sending}
            testID="compose-send"
            activeOpacity={0.85}
          >
            {sending ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <>
                <Text style={styles.sendTxt}>Send</Text>
                <Ionicons name="paper-plane" size={14} color="#fff" />
              </>
            )}
          </TouchableOpacity>
          <View style={{ flex: 1 }} />
          <TouchableOpacity onPress={closeCompose} style={styles.discardBtn} testID="compose-discard">
            <Ionicons name="trash-outline" size={16} color={colors.textMuted} />
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

const PANEL_W = 540;
const PANEL_H = 540;

const styles = StyleSheet.create({
  wrap: {
    position: "absolute" as any,
    right: 24,
    bottom: 0,
    zIndex: 10000,
    ...(Platform.OS === "web" ? ({ pointerEvents: "box-none" } as any) : {}),
  },
  panel: {
    width: PANEL_W,
    maxWidth: "95vw" as any,
    height: PANEL_H,
    maxHeight: "80vh" as any,
    backgroundColor: colors.surface,
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
    ...(Platform.OS === "web"
      ? ({ boxShadow: "0 8px 32px rgba(11,59,96,0.28)" } as any)
      : {}),
    overflow: "hidden",
  },
  header: {
    backgroundColor: "#0B3B60",
    paddingHorizontal: 16,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
  },
  headerText: { color: "#fff", fontSize: 14, fontWeight: "700", flex: 1 },
  headerBtn: {
    width: 26, height: 26, borderRadius: 4,
    alignItems: "center", justifyContent: "center",
    ...(Platform.OS === "web" ? ({ cursor: "pointer" } as any) : {}),
  },
  body: { flex: 1, paddingHorizontal: 16, paddingTop: 4 },
  field: {
    flexDirection: "row",
    alignItems: "center",
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingVertical: 6,
  },
  fieldLabel: { fontSize: 13, color: colors.textMuted, marginRight: 10, width: 24 },
  fieldInput: {
    flex: 1,
    fontSize: 14,
    color: colors.text,
    paddingVertical: 6,
    ...(Platform.OS === "web" ? ({ outlineStyle: "none" } as any) : {}),
  },
  bodyInput: {
    flex: 1,
    fontSize: 14,
    color: colors.text,
    paddingVertical: 12,
    ...(Platform.OS === "web" ? ({ outlineStyle: "none" } as any) : {}),
  },
  footer: {
    flexDirection: "row",
    alignItems: "center",
    padding: 12,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    gap: 8,
  },
  sendBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingHorizontal: 20,
    paddingVertical: 8,
  },
  sendTxt: { color: "#fff", fontWeight: "700", fontSize: 14 },
  discardBtn: {
    width: 34, height: 34, borderRadius: 17,
    alignItems: "center", justifyContent: "center",
  },
});
