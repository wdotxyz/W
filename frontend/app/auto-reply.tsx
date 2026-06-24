import React, { useEffect, useState } from "react";
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity, ScrollView, Switch,
  KeyboardAvoidingView, Platform, ActivityIndicator, Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { api } from "../src/api";
import { colors, radius, space } from "../src/theme";

type AutoReply = {
  enabled: boolean;
  subject: string;
  body: string;
  start_at?: string | null;
  end_at?: string | null;
  ai_enabled?: boolean;
};

const DEFAULT_SUBJECT = "Out of office";
const DEFAULT_BODY = "Thanks for reaching out — I'm currently away and will reply when I'm back. For anything urgent, please try again later.\n\n— Sent automatically by W";

export default function AutoReplyScreen() {
  const router = useRouter();
  const [enabled, setEnabled] = useState(false);
  const [aiEnabled, setAiEnabled] = useState(false);
  const [subject, setSubject] = useState(DEFAULT_SUBJECT);
  const [body, setBody] = useState(DEFAULT_BODY);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [tier, setTier] = useState<string>("free");

  useEffect(() => {
    (async () => {
      try {
        const ar = await api<any>("/auth/auto-reply");
        setEnabled(!!ar.enabled);
        setAiEnabled(!!ar.ai_enabled);
        setSubject(ar.subject || DEFAULT_SUBJECT);
        setBody(ar.body || DEFAULT_BODY);
      } catch (e) { /* ignore */ }
      try {
        const me = await api<{ tier: string }>("/billing/me");
        setTier(me.tier || "free");
      } catch (_) { /* ignore */ }
      finally { setLoading(false); }
    })();
  }, []);

  const canUseAi = tier === "plus" || tier === "pro";

  const onSave = async () => {
    if (enabled && !aiEnabled && !body.trim()) { Alert.alert("Add a reply message or enable Smart Auto-Reply."); return; }
    setSaving(true);
    try {
      const payload = {
        enabled,
        ai_enabled: aiEnabled,
        subject: subject.trim() || DEFAULT_SUBJECT,
        body: body.trim(),
      };
      await api("/auth/auto-reply", { method: "PATCH", body: JSON.stringify(payload) });
      Alert.alert(
        enabled ? "Auto-reply on" : "Auto-reply off",
        enabled
          ? (aiEnabled ? "W AI will reply to incoming mail for you." : "We'll reply to incoming mail for you.")
          : "Auto-replies are now disabled."
      );
      router.back();
    } catch (e: any) { Alert.alert("Couldn't save", e.message); }
    finally { setSaving(false); }
  };

  const toggleAi = (v: boolean) => {
    if (v && !canUseAi) {
      Alert.alert("Plus or Pro required", "Smart Auto-Reply uses W AI to write personalized replies. Upgrade to enable it.", [
        { text: "Cancel", style: "cancel" },
        { text: "Upgrade", onPress: () => router.push("/billing/upgrade") },
      ]);
      return;
    }
    setAiEnabled(v);
  };

  if (loading) {
    return (
      <SafeAreaView style={[styles.safe, { alignItems: "center", justifyContent: "center" }]} edges={["top", "bottom"]}>
        <ActivityIndicator color={colors.primary} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn} testID="auto-reply-back">
            <Ionicons name="chevron-back" size={26} color={colors.text} />
          </TouchableOpacity>
          <Text style={styles.title}>Auto-reply</Text>
          <TouchableOpacity onPress={onSave} disabled={saving} style={styles.saveBtn} testID="auto-reply-save">
            {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveText}>Save</Text>}
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <View style={styles.toggleRow} testID="auto-reply-toggle-row">
            <View style={{ flex: 1 }}>
              <Text style={styles.toggleLabel}>Auto-reply enabled</Text>
              <Text style={styles.toggleHint}>Sent automatically to anyone who emails you. Max 1 reply per sender per day.</Text>
            </View>
            <Switch
              value={enabled}
              onValueChange={setEnabled}
              trackColor={{ false: "#CBD5E0", true: colors.accent }}
              thumbColor="#fff"
              testID="auto-reply-switch"
            />
          </View>

          <View style={[styles.toggleRow, !canUseAi && { opacity: 0.85 }]} testID="auto-reply-ai-row">
            <View style={{ flex: 1 }}>
              <Text style={styles.toggleLabel}>✨ Smart Auto-Reply {!canUseAi && <Text style={{ color: colors.accent, fontSize: 11 }}> · Plus / Pro</Text>}</Text>
              <Text style={styles.toggleHint}>
                {aiEnabled
                  ? "W AI reads each incoming email and writes a personalized reply for you."
                  : "Let W AI personalize each reply using the incoming message. Your text below becomes optional context."}
              </Text>
            </View>
            <Switch
              value={aiEnabled}
              onValueChange={toggleAi}
              trackColor={{ false: "#CBD5E0", true: colors.accent }}
              thumbColor="#fff"
              testID="auto-reply-ai-switch"
            />
          </View>

          <Text style={styles.label}>Subject</Text>
          <View style={styles.inputBox}>
            <Ionicons name="reader-outline" size={18} color={colors.textMuted} />
            <TextInput
              style={styles.input}
              value={subject}
              onChangeText={setSubject}
              placeholder={DEFAULT_SUBJECT}
              placeholderTextColor={colors.textMuted}
              maxLength={200}
              testID="auto-reply-subject"
            />
          </View>

          <Text style={styles.label}>Message</Text>
          <TextInput
            style={styles.area}
            value={body}
            onChangeText={setBody}
            placeholder={DEFAULT_BODY}
            placeholderTextColor={colors.textMuted}
            multiline
            textAlignVertical="top"
            maxLength={4000}
            testID="auto-reply-body"
          />
          <Text style={styles.counter}>{body.length}/4000</Text>

          <View style={styles.tipsCard}>
            <Ionicons name="sparkles" size={16} color={colors.accent} />
            <Text style={styles.tipsText}>
              We won't auto-reply to mailer-daemons, unsubscribe addresses, or anyone you've already replied to today.
            </Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: "row", alignItems: "center", padding: space.md, gap: 8, borderBottomWidth: 1, borderBottomColor: colors.border },
  iconBtn: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  title: { flex: 1, fontSize: 18, fontWeight: "800", color: colors.text },
  saveBtn: { backgroundColor: colors.primary, paddingHorizontal: 16, paddingVertical: 10, borderRadius: radius.pill },
  saveText: { color: "#fff", fontWeight: "700" },
  scroll: { padding: space.lg, gap: 10 },
  toggleRow: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14, backgroundColor: colors.surface2, borderRadius: radius.xl, marginBottom: 6 },
  toggleLabel: { fontSize: 15, fontWeight: "800", color: colors.text },
  toggleHint: { fontSize: 12.5, color: colors.textMuted, marginTop: 4, lineHeight: 18 },
  label: { fontSize: 12, color: colors.textMuted, fontWeight: "700", marginTop: 10 },
  inputBox: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: colors.surface2, borderRadius: radius.lg, paddingHorizontal: 14 },
  input: { flex: 1, fontSize: 16, color: colors.text, paddingVertical: 14, fontWeight: "500" },
  area: { padding: 14, backgroundColor: colors.surface2, borderRadius: radius.lg, fontSize: 15, color: colors.text, minHeight: 160, lineHeight: 22 },
  counter: { textAlign: "right", color: colors.textMuted, fontSize: 12, marginTop: -4 },
  tipsCard: { flexDirection: "row", gap: 8, padding: 12, backgroundColor: "#E8F5F7", borderRadius: radius.lg, marginTop: 14 },
  tipsText: { flex: 1, color: colors.text, fontSize: 12.5, lineHeight: 18 },
});
