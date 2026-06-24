import React from "react";
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "../../src/auth";
import { Avatar } from "./chats";
import { colors, radius, space } from "../../src/theme";

export default function SettingsScreen() {
  const { user, signOut } = useAuth();
  const router = useRouter();

  const onSignOut = async () => {
    try { await signOut(); } catch (e) { console.warn("signOut error:", e); }
    router.replace("/(auth)/signin");
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
          <Row icon="star" label="W Premium" hint={user?.tier && user.tier !== "free" ? user.tier.toUpperCase() : "Upgrade"} onPress={() => router.push("/billing/upgrade")} testID="row-premium" />
          {user?.custom_domain ? (
            <Row icon="globe" label="Custom domain" hint={user?.domain_verified ? "Verified" : "Pending DNS"} onPress={() => router.push("/domain-setup")} testID="row-domain" />
          ) : null}
          <Row icon="notifications" label="Notifications" onPress={() => router.push("/notification-settings")} testID="row-notifications" />
          <Row icon="sparkles" label="Action items" hint="AI-extracted" onPress={() => router.push("/actions")} testID="row-actions" />
          <Row icon="color-palette" label="Theme" hint="W" />
          <Row icon="help-circle" label="Help & Support" />
          <Row icon="mail" label="Mail" hint="Ghost, Recovery, Auto-reply, Signature" onPress={() => router.push("/settings/mail")} testID="row-mail-section" />
          <Row icon="person-circle" label="Account" hint="2FA, About W, Deactivate" onPress={() => router.push("/settings/account")} testID="row-account-section" />
        </View>

        <TouchableOpacity onPress={onSignOut} style={styles.signOut} testID="signout-btn">
          <Ionicons name="log-out-outline" size={20} color={colors.danger} />
          <Text style={styles.signOutText}>Sign out</Text>
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
  rowLabel: { fontSize: 15, color: colors.text, fontWeight: "600" },
  rowHint: { flex: 1, fontSize: 12.5, color: colors.textMuted, marginLeft: 8, textAlign: "right", marginRight: 6 },
  signOut: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, marginTop: space.xl, marginHorizontal: space.xl, padding: 16, borderRadius: radius.xl, borderWidth: 1, borderColor: colors.danger },
  signOutText: { color: colors.danger, fontWeight: "700", fontSize: 15 },
});
