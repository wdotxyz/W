import React, { useEffect, useState, useCallback } from "react";
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, RefreshControl,
  ActivityIndicator, TextInput, KeyboardAvoidingView, Platform, Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { api } from "../../src/api";
import { useAuth } from "../../src/auth";
import { colors, radius, space } from "../../src/theme";

export default function MailScreen() {
  const router = useRouter();
  const { user, setUser, subscribe } = useAuth();
  const [folder, setFolder] = useState<"inbox" | "sent">("inbox");
  const [emails, setEmails] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const hasHandle = !!user?.email_address;

  const load = useCallback(async () => {
    if (!hasHandle) { setLoading(false); return; }
    try {
      const data = await api<any[]>(`/mail/${folder}`);
      setEmails(data);
    } catch (e) { console.warn(e); }
    finally { setLoading(false); setRefreshing(false); }
  }, [folder, hasHandle]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  useEffect(() => {
    return subscribe((m: any) => {
      if (m.type === "new_email" && folder === "inbox") load();
    });
  }, [subscribe, folder, load]);

  if (!hasHandle) return <HandlePicker onClaimed={(u) => setUser(u)} />;

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Mail</Text>
          <Text style={styles.addr} testID="my-email-addr">{user.email_address}</Text>
        </View>
        <TouchableOpacity style={styles.composeFab} onPress={() => router.push("/mail/compose")} testID="compose-fab">
          <Ionicons name="create" size={22} color="#fff" />
        </TouchableOpacity>
      </View>

      <View style={styles.tabs}>
        <FolderTab label="Inbox" active={folder === "inbox"} onPress={() => setFolder("inbox")} testID="mail-tab-inbox" />
        <FolderTab label="Sent" active={folder === "sent"} onPress={() => setFolder("sent")} testID="mail-tab-sent" />
      </View>

      {loading ? (
        <ActivityIndicator color={colors.accent} style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={emails}
          keyExtractor={(m) => m.id}
          renderItem={({ item }) => <MailRow mail={item} folder={folder} onPress={() => router.push(`/mail/${item.id}`)} />}
          ItemSeparatorComponent={() => <View style={styles.sep} />}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Ionicons name={folder === "inbox" ? "mail-open-outline" : "send-outline"} size={48} color={colors.textMuted} />
              <Text style={styles.emptyTitle}>{folder === "inbox" ? "Inbox empty" : "No sent mail"}</Text>
              <Text style={styles.emptySub}>
                {folder === "inbox"
                  ? `Send emails to ${user.email_address} from any provider. They'll appear here once SendGrid Inbound Parse is configured.`
                  : "Tap the pencil to compose."}
              </Text>
            </View>
          }
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.accent} />}
          contentContainerStyle={{ paddingBottom: 40 }}
        />
      )}
    </SafeAreaView>
  );
}

const FolderTab = ({ label, active, onPress, testID }: any) => (
  <TouchableOpacity onPress={onPress} style={[styles.foldBtn, active && styles.foldBtnOn]} testID={testID}>
    <Text style={[styles.foldText, active && styles.foldTextOn]}>{label}</Text>
  </TouchableOpacity>
);

const MailRow = ({ mail, folder, onPress }: any) => {
  const unread = folder === "inbox" && !mail.read;
  const who = folder === "inbox" ? (mail.from_name || mail.from_addr) : (mail.to_addrs?.join(", ") || "—");
  const preview = (mail.body || "").replace(/\s+/g, " ").slice(0, 90);
  return (
    <TouchableOpacity onPress={onPress} style={styles.row} testID={`mail-row-${mail.id}`} activeOpacity={0.7}>
      <View style={[styles.dot, unread ? { backgroundColor: colors.accent } : { backgroundColor: "transparent" }]} />
      <View style={{ flex: 1 }}>
        <View style={styles.rowTop}>
          <Text style={[styles.who, unread && { fontWeight: "800" }]} numberOfLines={1}>{who}</Text>
          <Text style={styles.time}>{formatDate(mail.created_at)}</Text>
        </View>
        <Text style={[styles.subj, unread && { fontWeight: "700", color: colors.text }]} numberOfLines={1}>{mail.subject}</Text>
        <Text style={styles.preview} numberOfLines={1}>{preview}</Text>
        {!!mail.attachments?.length && (
          <View style={styles.attachRow}>
            <Ionicons name="attach" size={14} color={colors.textMuted} />
            <Text style={styles.attachTxt}>{mail.attachments.length} attachment{mail.attachments.length > 1 ? "s" : ""}</Text>
          </View>
        )}
      </View>
    </TouchableOpacity>
  );
};

function formatDate(iso?: string) {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString())
    return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return d.toLocaleDateString([], { day: "2-digit", month: "short" });
}

// ---------- Handle Picker (shown when user hasn't claimed @w.xyz address) ----------
const HandlePicker = ({ onClaimed }: { onClaimed: (u: any) => void }) => {
  const [handle, setHandle] = useState("");
  const [status, setStatus] = useState<{ available?: boolean; reason?: string; checking?: boolean }>({});
  const [claiming, setClaiming] = useState(false);

  useEffect(() => {
    if (handle.length < 3) { setStatus({}); return; }
    setStatus({ checking: true });
    const t = setTimeout(async () => {
      try {
        const res = await api<any>(`/mail/check-handle/${encodeURIComponent(handle)}`);
        setStatus({ available: res.available, reason: res.reason });
      } catch { setStatus({}); }
    }, 350);
    return () => clearTimeout(t);
  }, [handle]);

  const onClaim = async () => {
    setClaiming(true);
    try {
      const u = await api<any>("/mail/claim-handle", {
        method: "POST",
        body: JSON.stringify({ handle: handle.trim().toLowerCase() }),
      });
      onClaimed(u);
    } catch (e: any) {
      Alert.alert("Couldn't claim", e.message || "Try a different handle.");
    } finally { setClaiming(false); }
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : "height"}>
        <View style={styles.pickWrap}>
          <View style={styles.heroIcon}><Ionicons name="mail" size={36} color="#fff" /></View>
          <Text style={styles.pickTitle}>Claim your @w.xyz address</Text>
          <Text style={styles.pickSub}>Pick a handle that's yours. Real email — send to anyone, receive from anyone.</Text>

          <View style={styles.handleRow}>
            <TextInput
              style={styles.handleInput}
              placeholder="yourhandle"
              placeholderTextColor={colors.textMuted}
              value={handle}
              onChangeText={(t) => setHandle(t.toLowerCase().replace(/[^a-z0-9._-]/g, "").slice(0, 32))}
              autoCapitalize="none"
              autoCorrect={false}
              autoFocus
              testID="handle-input"
            />
            <Text style={styles.domain}>@w.xyz</Text>
          </View>
          {status.checking && <Text style={styles.statusLine}>Checking…</Text>}
          {!status.checking && status.available === true && <Text style={[styles.statusLine, { color: colors.success }]}>✓ Available</Text>}
          {!status.checking && status.available === false && <Text style={[styles.statusLine, { color: colors.danger }]}>✕ {status.reason || "Taken"}</Text>}

          <TouchableOpacity
            style={[styles.claimBtn, (!status.available || claiming) && { opacity: 0.5 }]}
            disabled={!status.available || claiming}
            onPress={onClaim}
            testID="claim-handle-btn"
          >
            {claiming ? <ActivityIndicator color="#fff" /> : <Text style={styles.claimText}>Claim {handle}@w.xyz</Text>}
          </TouchableOpacity>

          <Text style={styles.legal}>Reserved handles (admin, support, etc.) are not allowed.</Text>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.surface },
  header: { paddingHorizontal: space.xl, paddingVertical: space.md, flexDirection: "row", alignItems: "center" },
  title: { fontSize: 30, fontWeight: "800", color: colors.primary, letterSpacing: -0.5 },
  addr: { color: colors.textMuted, fontSize: 13, marginTop: 2 },
  composeFab: {
    width: 48, height: 48, borderRadius: 24, backgroundColor: colors.primary,
    alignItems: "center", justifyContent: "center",
    shadowColor: colors.primary, shadowOpacity: 0.25, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 5,
  },
  tabs: { flexDirection: "row", gap: 8, paddingHorizontal: space.xl, marginBottom: 8 },
  foldBtn: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: radius.pill, backgroundColor: colors.surface2 },
  foldBtnOn: { backgroundColor: colors.primary },
  foldText: { color: colors.textMuted, fontWeight: "700", fontSize: 13 },
  foldTextOn: { color: "#fff" },
  row: { flexDirection: "row", alignItems: "flex-start", paddingHorizontal: space.xl, paddingVertical: 12, gap: 10 },
  dot: { width: 10, height: 10, borderRadius: 5, marginTop: 7 },
  rowTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  who: { fontSize: 15, fontWeight: "700", color: colors.text, flex: 1 },
  time: { fontSize: 12, color: colors.textMuted, marginLeft: 8 },
  subj: { fontSize: 14, color: colors.text, marginTop: 2 },
  preview: { fontSize: 13, color: colors.textMuted, marginTop: 2 },
  attachRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 4 },
  attachTxt: { fontSize: 12, color: colors.textMuted },
  sep: { height: 1, backgroundColor: colors.border, marginLeft: 50 },
  empty: { alignItems: "center", marginTop: 60, paddingHorizontal: 40 },
  emptyTitle: { fontSize: 18, fontWeight: "700", color: colors.text, marginTop: 12 },
  emptySub: { color: colors.textMuted, marginTop: 4, textAlign: "center", lineHeight: 19 },

  pickWrap: { flex: 1, padding: space.xl, justifyContent: "center" },
  heroIcon: {
    width: 72, height: 72, borderRadius: 22, backgroundColor: colors.primary,
    alignItems: "center", justifyContent: "center", marginBottom: 18,
    shadowColor: colors.primary, shadowOpacity: 0.3, shadowRadius: 20, shadowOffset: { width: 0, height: 8 }, elevation: 6,
  },
  pickTitle: { fontSize: 26, fontWeight: "800", color: colors.text, letterSpacing: -0.5 },
  pickSub: { fontSize: 14, color: colors.textMuted, marginTop: 6, marginBottom: 24, lineHeight: 20 },
  handleRow: { flexDirection: "row", alignItems: "center", backgroundColor: colors.surface2, borderRadius: radius.lg, paddingHorizontal: 14 },
  handleInput: { flex: 1, fontSize: 18, color: colors.text, paddingVertical: 16, fontWeight: "600" },
  domain: { fontSize: 16, color: colors.accent, fontWeight: "700" },
  statusLine: { marginTop: 10, fontSize: 13, color: colors.textMuted, fontWeight: "600" },
  claimBtn: { marginTop: 22, backgroundColor: colors.primary, padding: 16, borderRadius: radius.xl, alignItems: "center" },
  claimText: { color: "#fff", fontSize: 16, fontWeight: "700" },
  legal: { textAlign: "center", color: colors.textMuted, fontSize: 12, marginTop: 14 },
});
