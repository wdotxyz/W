import React, { useState } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView, TextInput,
  ActivityIndicator, Alert, Platform, KeyboardAvoidingView,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { api } from "../src/api";
import { useAuth } from "../src/auth";
import { colors, radius, space } from "../src/theme";

type Faq = { q: string; a: string; icon: any };

const FAQS: Faq[] = [
  {
    icon: "mail",
    q: "What is Ghost Mail?",
    a: "Ghost Mail is Snapchat-style email — messages auto-delete forever the moment you finish reading them. You can turn it on in Settings → Mail → Ghost Mail. Upgrade to Plus or Pro to save important Ghost messages to your storage before they vanish.",
  },
  {
    icon: "sparkles",
    q: "How does the AI Assistant work?",
    a: "W AI scans your recent inbox to surface action items, suggest smart replies, summarize threads, and let you dictate emails by voice. Nothing is shared outside W — your conversations are processed securely through our AI providers.",
  },
  {
    icon: "shield-checkmark",
    q: "Is two-step verification (2FA) recommended?",
    a: "Yes. With 2FA on, every new sign-in requires a one-time code sent to your phone, even if someone learns your password. Enable it under Settings → Account → Two-step verification.",
  },
  {
    icon: "at",
    q: "Can I use my own domain (e.g. you@yourbrand.com)?",
    a: "Yes — Pro users can connect a custom domain and W will deliver to that address. From Settings → Custom domain, follow the DNS verification steps. Mail through your handle@w.xyz also keeps working.",
  },
  {
    icon: "videocam",
    q: "How are voice & video calls handled?",
    a: "We use Daily.co under the hood. Calls are end-to-end encrypted while in transit and rooms expire automatically 30 minutes after the call ends. Recording is opt-in only.",
  },
  {
    icon: "card",
    q: "How does billing work?",
    a: "Free includes 1 GB storage and core messaging. W Plus ($4.99/mo) raises storage to 50 GB and unlocks the 5-letter handles. W Pro ($9.99/mo) gives 100 GB, AI Smart Auto-Reply, premium 4-letter handles, custom domains and more.",
  },
  {
    icon: "trash",
    q: "How do I delete my account?",
    a: "Go to Settings → Account → Deactivate. You can pause your account (chats kept, sign back in anytime) or delete forever (everything erased permanently, cannot be undone).",
  },
  {
    icon: "phone-portrait",
    q: "Do I need a separate app for iPhone & Android?",
    a: "No — W is built once with Expo, so the same app runs natively on iOS and Android with the same features, identical UI, and synced chats and mail.",
  },
];

const CATEGORIES = [
  { id: "general", label: "General", icon: "chatbubble-ellipses" },
  { id: "bug", label: "Bug report", icon: "bug" },
  { id: "billing", label: "Billing", icon: "card" },
  { id: "feature", label: "Feature request", icon: "bulb" },
  { id: "account", label: "Account", icon: "person-circle" },
];

export default function HelpSupportScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const [open, setOpen] = useState<number | null>(null);
  const [category, setCategory] = useState("general");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const s = subject.trim();
    const m = message.trim();
    if (s.length < 3) { Alert.alert("Add a subject", "Please add a short subject (3+ characters)."); return; }
    if (m.length < 10) { Alert.alert("Tell us a bit more", "Please describe your issue (at least 10 characters)."); return; }
    setBusy(true);
    try {
      const res = await api<{ ok: boolean; message: string }>("/support/contact", {
        method: "POST",
        body: JSON.stringify({ subject: s, message: m, category }),
      });
      Alert.alert("Message sent", res?.message || "Thanks — we'll be in touch soon.");
      setSubject("");
      setMessage("");
    } catch (e: any) {
      Alert.alert("Couldn't send", e?.message || "Please try again in a moment.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn} testID="help-back">
          <Ionicons name="chevron-back" size={26} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.title}>Help & Support</Text>
        <View style={{ width: 40 }} />
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          {/* Hero */}
          <View style={styles.hero}>
            <View style={styles.heroIcon}><Ionicons name="help-buoy" size={28} color={colors.accent} /></View>
            <Text style={styles.heroTitle}>How can we help?</Text>
            <Text style={styles.heroSub}>Browse common questions or send our team a message. We usually reply within 1 business day.</Text>
          </View>

          {/* FAQ */}
          <Text style={styles.sectionLabel}>Frequently asked questions</Text>
          <View style={styles.faqGroup} testID="faq-group">
            {FAQS.map((f, i) => {
              const isOpen = open === i;
              return (
                <View key={f.q} style={styles.faqItem}>
                  <TouchableOpacity
                    onPress={() => setOpen(isOpen ? null : i)}
                    activeOpacity={0.7}
                    style={styles.faqHeader}
                    testID={`faq-toggle-${i}`}
                  >
                    <View style={styles.faqIcon}><Ionicons name={f.icon} size={16} color={colors.accent} /></View>
                    <Text style={styles.faqQ} numberOfLines={2}>{f.q}</Text>
                    <Ionicons name={isOpen ? "chevron-up" : "chevron-down"} size={18} color={colors.textMuted} />
                  </TouchableOpacity>
                  {isOpen && (
                    <View style={styles.faqBody} testID={`faq-answer-${i}`}>
                      <Text style={styles.faqA}>{f.a}</Text>
                    </View>
                  )}
                </View>
              );
            })}
          </View>

          {/* Contact form */}
          <Text style={styles.sectionLabel}>Still need help? Contact us</Text>
          <View style={styles.form}>
            <Text style={styles.fieldLabel}>Category</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
              {CATEGORIES.map((c) => {
                const active = category === c.id;
                return (
                  <TouchableOpacity
                    key={c.id}
                    onPress={() => setCategory(c.id)}
                    style={[styles.chip, active && styles.chipActive]}
                    activeOpacity={0.7}
                    testID={`category-chip-${c.id}`}
                  >
                    <Ionicons name={c.icon as any} size={14} color={active ? "#fff" : colors.accent} />
                    <Text style={[styles.chipText, active && { color: "#fff" }]}>{c.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>

            <Text style={styles.fieldLabel}>Subject</Text>
            <TextInput
              value={subject}
              onChangeText={setSubject}
              style={styles.input}
              placeholder="Quick summary of your issue"
              placeholderTextColor={colors.textMuted}
              maxLength={200}
              testID="support-subject"
            />

            <Text style={styles.fieldLabel}>Message</Text>
            <TextInput
              value={message}
              onChangeText={setMessage}
              style={[styles.input, styles.inputMulti]}
              placeholder="Tell us what's happening so we can help…"
              placeholderTextColor={colors.textMuted}
              multiline
              numberOfLines={6}
              maxLength={5000}
              textAlignVertical="top"
              testID="support-message"
            />
            <Text style={styles.helper}>
              We'll reply to {user?.email_address || user?.fallback_address || "your account email"}.
            </Text>

            <TouchableOpacity
              onPress={submit}
              disabled={busy}
              activeOpacity={0.85}
              style={[styles.submit, busy && { opacity: 0.6 }]}
              testID="support-submit"
            >
              {busy ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <>
                  <Ionicons name="paper-plane" size={18} color="#fff" />
                  <Text style={styles.submitText}>Send message</Text>
                </>
              )}
            </TouchableOpacity>
          </View>

          <Text style={styles.foot}>Or email us at support@w.xyz — we'd love to hear from you.</Text>
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
  scroll: { padding: space.xl, gap: 16, paddingBottom: 40 },
  hero: { backgroundColor: colors.surface2, borderRadius: radius.xl, padding: 18, alignItems: "center" },
  heroIcon: { width: 56, height: 56, borderRadius: 28, backgroundColor: "#E8F5F7", alignItems: "center", justifyContent: "center", marginBottom: 10 },
  heroTitle: { fontSize: 18, fontWeight: "800", color: colors.text, textAlign: "center", letterSpacing: -0.3 },
  heroSub: { fontSize: 13.5, color: colors.textMuted, lineHeight: 19, textAlign: "center", marginTop: 6 },
  sectionLabel: { fontSize: 12, color: colors.textMuted, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.5, marginTop: 8 },
  faqGroup: { backgroundColor: colors.surface2, borderRadius: radius.xl, overflow: "hidden" },
  faqItem: { borderBottomWidth: 1, borderBottomColor: colors.border },
  faqHeader: { flexDirection: "row", alignItems: "center", padding: 14, gap: 12 },
  faqIcon: { width: 32, height: 32, borderRadius: 16, backgroundColor: "#E8F5F7", alignItems: "center", justifyContent: "center" },
  faqQ: { flex: 1, fontSize: 14.5, color: colors.text, fontWeight: "700", lineHeight: 20 },
  faqBody: { paddingHorizontal: 14, paddingBottom: 14, paddingTop: 0, paddingLeft: 58 },
  faqA: { fontSize: 13.5, color: colors.textMuted, lineHeight: 20 },
  form: { backgroundColor: colors.surface2, borderRadius: radius.xl, padding: 16, gap: 10 },
  fieldLabel: { fontSize: 12, color: colors.textMuted, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.5, marginTop: 6 },
  chips: { gap: 8, paddingVertical: 2 },
  chip: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: colors.surface, borderRadius: 999, borderWidth: 1, borderColor: colors.border },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { fontSize: 13, color: colors.text, fontWeight: "700" },
  input: { backgroundColor: colors.surface, borderRadius: radius.lg, paddingHorizontal: 14, paddingVertical: Platform.OS === "ios" ? 12 : 10, fontSize: 15, color: colors.text, borderWidth: 1, borderColor: colors.border },
  inputMulti: { minHeight: 130, paddingTop: 12 },
  helper: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  submit: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: colors.primary, borderRadius: radius.xl, paddingVertical: 14, marginTop: 8 },
  submitText: { color: "#fff", fontWeight: "800", fontSize: 15 },
  foot: { fontSize: 12, color: colors.textMuted, textAlign: "center", marginTop: 4, lineHeight: 17 },
});
