import React from "react";
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Share, Platform, Alert } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "../../src/auth";
import { Avatar } from "../chats";
import { colors, radius, space } from "../../src/theme";
import { SHOW_PREMIUM } from "../../src/featureFlags";

export default function SettingsScreen() {
  const { user, signOut } = useAuth();
  const router = useRouter();

  const onSignOut = async () => {
    try { await signOut(); } catch (e) { console.warn("signOut error:", e); }
    router.replace("/(auth)/signin");
  };

  const onReferApp = async () => {
    const handle = (user as any)?.email_address || "a friend";
    const message =
      `${user?.name || "I"} is using W — an AI-native webmail & messaging app.\n\n` +
      `Threaded inbox, Ghost Mail, voice-to-email, smart replies, and more.\n\n` +
      `Try it at https://wplatforms.xyz`;
    try {
      if (Platform.OS === "web") {
        // @ts-ignore — navigator.share is available on most mobile browsers
        if (typeof navigator !== "undefined" && (navigator as any).share) {
          await (navigator as any).share({ title: "W by W Platforms", text: message, url: "https://wplatforms.xyz" });
        } else if (typeof navigator !== "undefined" && navigator.clipboard) {
          await navigator.clipboard.writeText(message);
          Alert.alert("Copied!", "Referral link copied — paste it anywhere to share.");
        } else {
          Alert.alert("Share W", message);
        }
      } else {
        await Share.share({ message, title: "W by W Platforms" }, { dialogTitle: "Invite a friend to W" });
      }
    } catch (e: any) {
      if (e?.message && !/cancell?ed|user dismissed/i.test(e.message)) {
        Alert.alert("Couldn't share", e.message);
      }
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Text style={styles.title}>Settings</Text>

        <View style={styles.profileCard} testID="profile-card">
          <Avatar uri={user?.avatar} name={user?.name} size={68} />
          <View style={{ marginLeft: 14, flex: 1 }}>
            <Text style={styles.name}>{user?.name || "—"}</Text>
            <Text style={styles.phone}>{user?.phone}</Text>
            <Text style={styles.about} numberOfLines={1}>{user?.about}</Text>
          </View>
          <TouchableOpacity onPress={() => router.push("/(auth)/profile-setup")} style={styles.editBtn} testID="edit-profile-btn">
            <Ionicons name="pencil" size={16} color={colors.accent} />
          </TouchableOpacity>
        </View>

        <View style={styles.group}>
          {SHOW_PREMIUM ? (
            <Row icon="star" label="W Premium" onPress={() => router.push("/billing/upgrade")} testID="row-premium" />
          ) : null}
          {SHOW_PREMIUM && user?.custom_domain ? (
            <Row icon="globe" label="Custom domain" onPress={() => router.push("/domain-setup")} testID="row-domain" />
          ) : null}
          <Row icon="notifications" label="Notifications" onPress={() => router.push("/notification-settings")} testID="row-notifications" />
          <Row icon="help-circle" label="Help Center" onPress={() => router.push("/help")} testID="row-help" />
          <Row icon="mail" label="Mail Settings" onPress={() => router.push("/settings/mail")} testID="row-mail-section" />
          <Row icon="person-circle" label="Account" onPress={() => router.push("/settings/account")} testID="row-account-section" />
        </View>

        <TouchableOpacity style={styles.referBtn} onPress={onReferApp} testID="refer-app-btn" activeOpacity={0.85}>
          <Ionicons name="gift" size={18} color={colors.accent} />
          <Text style={styles.referText}>Refer W to a friend</Text>
          <Ionicons name="share-outline" size={18} color={colors.accent} />
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const Row = ({ icon, label, hint, onPress, testID }: any) => (
  <TouchableOpacity onPress={onPress} disabled={!onPress} activeOpacity={onPress ? 0.6 : 1} style={styles.rowItem} testID={testID}>
    <View style={styles.rowIcon}><Ionicons name={icon} size={18} color={colors.accent} /></View>
    <Text style={styles.rowLabel}>{label}</Text>
    {!!hint && <Text style={styles.rowHint} numberOfLines={1}>{hint}</Text>}
    <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
  </TouchableOpacity>
);

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.surface },
  scroll: { paddingBottom: 140 },
  title: { fontSize: 28, fontWeight: "800", color: colors.text, letterSpacing: -0.5, padding: space.xl },
  profileCard: { flexDirection: "row", alignItems: "center", marginHorizontal: space.xl, padding: 16, backgroundColor: colors.surface2, borderRadius: radius.xl },
  name: { fontSize: 18, fontWeight: "800", color: colors.text },
  phone: { fontSize: 13, color: colors.textMuted, marginTop: 2 },
  about: { fontSize: 13, color: colors.textMuted, marginTop: 4 },
  editBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: "#E8F5F7", alignItems: "center", justifyContent: "center" },
  group: { marginTop: space.xl, marginHorizontal: space.xl, backgroundColor: colors.surface2, borderRadius: radius.xl, overflow: "hidden" },
  rowItem: { flexDirection: "row", alignItems: "center", padding: 14, borderBottomWidth: 1, borderBottomColor: colors.border, gap: 12 },
  rowIcon: { width: 36, height: 36, borderRadius: 18, backgroundColor: "#E8F5F7", alignItems: "center", justifyContent: "center" },
  rowLabel: { flex: 1, fontSize: 15, color: colors.text, fontWeight: "600" },
  rowHint: { flex: 1, fontSize: 12.5, color: colors.textMuted, marginLeft: 8, textAlign: "right", marginRight: 6 },
  signOut: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, marginTop: space.xl, marginHorizontal: space.xl, padding: 16, borderRadius: radius.xl, borderWidth: 1, borderColor: colors.danger },
  signOutText: { color: colors.danger, fontWeight: "700", fontSize: 15 },
  referBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    marginTop: space.xl,
    marginHorizontal: space.xl,
    padding: 16,
    borderRadius: radius.xl,
    backgroundColor: "#E8F5F7",
    borderWidth: 1.5,
    borderColor: colors.accent,
  },
  referText: { color: colors.accent, fontWeight: "800", fontSize: 15 },
});
