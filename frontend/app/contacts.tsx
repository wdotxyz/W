import React, { useEffect, useMemo, useState } from "react";
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator,
  TextInput, Modal, Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { api } from "../src/api";
import { Avatar } from "./chats";
import { colors, radius, space } from "../src/theme";

const isEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());

export default function ContactsScreen() {
  const router = useRouter();
  const [contacts, setContacts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<any | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    api<any[]>("/chats/contacts")
      .then((r) => { if (alive) setContacts(r || []); })
      .catch(() => { if (alive) setContacts([]); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  const query = q.trim().toLowerCase();
  const filtered = useMemo(() => {
    if (!query) return contacts;
    return contacts.filter((u) => {
      const hay = `${u.name || ""} ${u.email_address || ""} ${u.email || ""} ${u.about || ""}`.toLowerCase();
      return hay.includes(query);
    });
  }, [contacts, query]);

  const showInviteCTA =
    !!query && isEmail(q.trim()) &&
    !contacts.some((u) => [u.email_address, u.email].filter(Boolean).some((e: string) => e.toLowerCase() === query));

  const goEmail = () => {
    if (!picked) return;
    const to = picked.email_address || picked.email;
    if (!to) { Alert.alert("No email", "This contact doesn't have an email address yet."); return; }
    setPicked(null);
    router.push({ pathname: "/mail/compose", params: { to } });
  };

  const goChat = async () => {
    if (!picked) return;
    setBusy(true);
    try {
      const c = await api<any>("/chats", {
        method: "POST",
        body: JSON.stringify({ member_ids: [picked.id], is_group: false }),
      });
      setPicked(null);
      router.push(`/chat/${c.id}`);
    } catch (e: any) {
      Alert.alert("Couldn't open chat", e?.message || "Please try again.");
    } finally { setBusy(false); }
  };

  const inviteByEmail = async () => {
    const addr = q.trim().toLowerCase();
    if (!isEmail(addr)) return;
    setBusy(true);
    try {
      const res = await api<any>("/chats/invite", {
        method: "POST",
        body: JSON.stringify({ to: addr }),
      });
      if (res?.invited === false && res?.chat?.id) {
        router.push(`/chat/${res.chat.id}`);
        return;
      }
      Alert.alert(
        "Invite sent",
        `We emailed ${addr} an invite from your @w.xyz address. A copy is in your Sent folder.`,
      );
      setQ("");
    } catch (e: any) {
      Alert.alert("Couldn't send invite", e?.message || "Please try again.");
    } finally { setBusy(false); }
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn} testID="contacts-back">
          <Ionicons name="chevron-back" size={26} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.title}>Contacts</Text>
        <View style={{ flex: 1 }} />
        <TouchableOpacity onPress={() => router.push("/chats")} style={styles.iconBtn} testID="contacts-open-chats">
          <Ionicons name="chatbubbles" size={22} color={colors.primary} />
        </TouchableOpacity>
      </View>

      <View style={styles.searchWrap}>
        <Ionicons name="search" size={18} color={colors.textMuted} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search or type an email to invite"
          placeholderTextColor={colors.textMuted}
          value={q}
          onChangeText={setQ}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          testID="contacts-search"
        />
        {!!q && (
          <TouchableOpacity onPress={() => setQ("")} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name="close-circle" size={18} color={colors.textMuted} />
          </TouchableOpacity>
        )}
      </View>

      {showInviteCTA && (
        <TouchableOpacity onPress={inviteByEmail} style={styles.invite} testID="invite-row" activeOpacity={0.85} disabled={busy}>
          <View style={styles.inviteIcon}>
            {busy ? <ActivityIndicator size="small" color="#fff" /> : <Ionicons name="paper-plane" size={20} color="#fff" />}
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.inviteTitle}>Invite {q.trim().toLowerCase()}</Text>
            <Text style={styles.inviteSub}>We'll email them a sign-up link from your @w.xyz address.</Text>
          </View>
          <Ionicons name="arrow-forward" size={18} color={colors.accent} />
        </TouchableOpacity>
      )}

      {loading ? (
        <ActivityIndicator color={colors.accent} style={{ marginTop: 30 }} />
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(u) => u.id}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item }) => (
            <TouchableOpacity
              style={styles.row}
              onPress={() => setPicked(item)}
              testID={`contact-${item.id}`}
              activeOpacity={0.7}
            >
              <Avatar uri={item.avatar} name={item.name || item.email_address} ai={item.is_ai} size={48} />
              <View style={{ marginLeft: 12, flex: 1 }}>
                <Text style={styles.name} numberOfLines={1}>{item.name || item.email_address || "(no name)"}</Text>
                <Text style={styles.handle} numberOfLines={1}>{item.email_address || item.email || ""}</Text>
                {!!item.about && <Text style={styles.about} numberOfLines={1}>{item.about}</Text>}
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
            </TouchableOpacity>
          )}
          ItemSeparatorComponent={() => <View style={{ height: 1, backgroundColor: colors.border, marginLeft: 76 }} />}
          ListEmptyComponent={
            <Text style={styles.empty}>
              {query
                ? (isEmail(q.trim()) ? "Not in your contacts — tap above to invite them." : "No matches. Type a full email to invite someone.")
                : "No contacts yet. Type an email above to invite a friend."}
            </Text>
          }
        />
      )}

      {/* Action sheet: pick Email or Chat */}
      <Modal visible={!!picked} transparent animationType="fade" onRequestClose={() => setPicked(null)}>
        <TouchableOpacity activeOpacity={1} style={styles.modalBackdrop} onPress={() => setPicked(null)}>
          <TouchableOpacity activeOpacity={1} style={styles.sheet} onPress={() => {}}>
            <View style={styles.sheetHandle} />
            <View style={styles.sheetHeader}>
              <Avatar uri={picked?.avatar} name={picked?.name || picked?.email_address} ai={picked?.is_ai} size={44} />
              <View style={{ marginLeft: 12, flex: 1 }}>
                <Text style={styles.sheetName} numberOfLines={1}>{picked?.name || picked?.email_address || "(no name)"}</Text>
                <Text style={styles.sheetSub} numberOfLines={1}>{picked?.email_address || picked?.email || ""}</Text>
              </View>
              <TouchableOpacity onPress={() => setPicked(null)} testID="picked-close">
                <Ionicons name="close" size={22} color={colors.textMuted} />
              </TouchableOpacity>
            </View>
            <TouchableOpacity onPress={goEmail} style={styles.action} disabled={busy} testID="action-email" activeOpacity={0.8}>
              <View style={styles.actionIcon}><Ionicons name="mail" size={22} color="#fff" /></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.actionTitle}>Send email</Text>
                <Text style={styles.actionSub}>Opens Compose with this contact's address.</Text>
              </View>
              <Ionicons name="arrow-forward" size={18} color={colors.accent} />
            </TouchableOpacity>
            <TouchableOpacity onPress={goChat} style={styles.action} disabled={busy} testID="action-chat" activeOpacity={0.8}>
              <View style={[styles.actionIcon, { backgroundColor: "#1A8F4A" }]}>
                {busy ? <ActivityIndicator size="small" color="#fff" /> : <Ionicons name="chatbubbles" size={22} color="#fff" />}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.actionTitle}>Send direct message</Text>
                <Text style={styles.actionSub}>Opens a W chat — instant, real-time.</Text>
              </View>
              <Ionicons name="arrow-forward" size={18} color={colors.accent} />
            </TouchableOpacity>
            <View style={{ height: 16 }} />
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: "row", alignItems: "center", padding: space.md, gap: 4 },
  iconBtn: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 22, fontWeight: "800", color: colors.text, marginLeft: 4 },
  searchWrap: {
    flexDirection: "row", alignItems: "center", gap: 10,
    marginHorizontal: space.md, marginBottom: space.sm,
    paddingHorizontal: 14, paddingVertical: 10,
    borderRadius: radius.xl, backgroundColor: colors.surface2,
    borderWidth: 1, borderColor: colors.border,
    maxWidth: 640, width: "100%",
  },
  searchInput: { flex: 1, fontSize: 15, color: colors.text },
  invite: {
    flexDirection: "row", alignItems: "center", gap: 12,
    marginHorizontal: space.md, marginBottom: space.sm,
    padding: 14, borderRadius: radius.xl,
    backgroundColor: "#E8F5F7", borderWidth: 1.5, borderColor: colors.accent,
  },
  inviteIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.accent, alignItems: "center", justifyContent: "center" },
  inviteTitle: { fontSize: 15, fontWeight: "800", color: colors.text },
  inviteSub: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  row: { flexDirection: "row", alignItems: "center", padding: space.lg },
  name: { fontSize: 16, fontWeight: "700", color: colors.text },
  handle: { fontSize: 13, color: colors.accent, fontWeight: "600", marginTop: 2 },
  about: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  empty: { textAlign: "left", color: colors.textMuted, marginTop: 20, marginHorizontal: space.md, lineHeight: 20 },
  modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  sheet: { backgroundColor: colors.surface, padding: 18, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingBottom: 24 },
  sheetHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border, alignSelf: "center", marginBottom: 14 },
  sheetHeader: { flexDirection: "row", alignItems: "center", marginBottom: 14 },
  sheetName: { fontSize: 16, fontWeight: "800", color: colors.text },
  sheetSub: { fontSize: 13, color: colors.accent, fontWeight: "600", marginTop: 2 },
  action: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderRadius: radius.lg, backgroundColor: colors.surface2, marginBottom: 10 },
  actionIcon: { width: 42, height: 42, borderRadius: 21, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" },
  actionTitle: { fontSize: 15, fontWeight: "800", color: colors.text },
  actionSub: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
});
