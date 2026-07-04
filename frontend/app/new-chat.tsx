import React, { useEffect, useMemo, useState } from "react";
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator,
  TextInput, Alert, Platform, KeyboardAvoidingView,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { api } from "../src/api";
import { Avatar } from "./chats";
import { colors, space, radius } from "../src/theme";
import { smartBack } from "../src/utils/nav";

const isEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());

export default function NewChat() {
  const router = useRouter();
  const [contacts, setContacts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState("");

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
    !!query &&
    isEmail(q.trim()) &&
    !contacts.some((u) =>
      [u.email_address, u.email].filter(Boolean).some((e: string) => e.toLowerCase() === query),
    );

  const openExistingChat = async (u: any) => {
    if (busy) return;
    setBusy(true);
    try {
      const c = await api<any>("/chats", {
        method: "POST",
        body: JSON.stringify({ member_ids: [u.id], is_group: false }),
      });
      router.replace(`/chat/${c.id}`);
    } catch (e: any) {
      Alert.alert("Couldn't open chat", e?.message || "Please try again.");
    } finally { setBusy(false); }
  };

  const inviteByEmail = async () => {
    if (busy) return;
    const addr = q.trim().toLowerCase();
    if (!isEmail(addr)) return;
    setBusy(true);
    try {
      const res = await api<any>("/chats/invite", {
        method: "POST",
        body: JSON.stringify({ to: addr }),
      });
      if (res?.invited === false && res?.chat?.id) {
        // The address belongs to an existing W user → open the chat
        router.replace(`/chat/${res.chat.id}`);
        return;
      }
      if (res?.invited === true) {
        Alert.alert(
          "Invite sent",
          res?.delivery === "sent"
            ? `We emailed ${addr} an invite with a sign-up link. They can chat with you once they join W.`
            : `Invite saved for ${addr}. We'll email them shortly.`,
        );
        smartBack(router);
        return;
      }
      Alert.alert("Hmm", "Unexpected response — please try again.");
    } catch (e: any) {
      Alert.alert("Couldn't send invite", e?.message || "Please try again.");
    } finally { setBusy(false); }
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={{ flex: 1 }}
      >
        <View style={styles.header}>
          <TouchableOpacity onPress={() => smartBack(router)} style={styles.iconBtn} testID="newchat-close">
            <Ionicons name="close" size={24} color={colors.text} />
          </TouchableOpacity>
          <Text style={styles.title}>New chat</Text>
        </View>

        <View style={styles.searchWrap}>
          <Ionicons name="search" size={18} color={colors.textMuted} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search contacts or type an email"
            placeholderTextColor={colors.textMuted}
            value={q}
            onChangeText={setQ}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            testID="newchat-search"
          />
          {!!q && (
            <TouchableOpacity onPress={() => setQ("")} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Ionicons name="close-circle" size={18} color={colors.textMuted} />
            </TouchableOpacity>
          )}
        </View>

        {showInviteCTA && (
          <TouchableOpacity onPress={inviteByEmail} style={styles.invite} testID="invite-row" activeOpacity={0.85}>
            <View style={styles.inviteIcon}>
              {busy ? <ActivityIndicator size="small" color="#fff" /> : <Ionicons name="paper-plane" size={20} color="#fff" />}
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.inviteTitle} numberOfLines={1}>Invite {q.trim().toLowerCase()}</Text>
              <Text style={styles.inviteSub}>We'll email them a sign-up link.</Text>
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
                onPress={() => openExistingChat(item)}
                testID={`pick-user-${item.id}`}
                activeOpacity={0.7}
              >
                <Avatar uri={item.avatar} name={item.name || item.email_address} ai={item.is_ai} size={48} />
                <View style={{ marginLeft: 12, flex: 1 }}>
                  <Text style={styles.name} numberOfLines={1}>{item.name || item.email_address || "(no name)"}</Text>
                  <Text style={styles.handle} numberOfLines={1}>
                    {item.email_address || item.email || ""}
                  </Text>
                  {!!item.about && <Text style={styles.about} numberOfLines={1}>{item.about}</Text>}
                </View>
              </TouchableOpacity>
            )}
            ItemSeparatorComponent={() => <View style={{ height: 1, backgroundColor: colors.border, marginLeft: 76 }} />}
            ListEmptyComponent={
              <Text style={styles.empty}>
                {query
                  ? (isEmail(q.trim()) ? "Not a W user yet — tap above to invite them by email." : "Type a full email to invite someone new.")
                  : "No contacts yet. Type an email to invite a friend to W."}
              </Text>
            }
          />
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: "row", alignItems: "center", padding: space.md, gap: 8 },
  iconBtn: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 20, fontWeight: "800", color: colors.text },
  searchWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginHorizontal: space.md,
    marginBottom: space.sm,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: radius.xl,
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.border,
  },
  searchInput: { flex: 1, fontSize: 15, color: colors.text },
  invite: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginHorizontal: space.md,
    marginBottom: space.sm,
    padding: 14,
    borderRadius: radius.xl,
    backgroundColor: "#E8F5F7",
    borderWidth: 1.5,
    borderColor: colors.accent,
  },
  inviteIcon: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: colors.accent,
    alignItems: "center", justifyContent: "center",
  },
  inviteTitle: { fontSize: 15, fontWeight: "800", color: colors.text },
  inviteSub: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  row: { flexDirection: "row", alignItems: "center", padding: space.lg },
  name: { fontSize: 16, fontWeight: "700", color: colors.text },
  handle: { fontSize: 13, color: colors.accent, fontWeight: "600", marginTop: 2 },
  about: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  empty: { textAlign: "center", color: colors.textMuted, marginTop: 60, paddingHorizontal: 40, lineHeight: 20 },
});
