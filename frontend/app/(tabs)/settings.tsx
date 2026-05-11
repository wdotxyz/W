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
    try {
      await signOut();
    } catch (e) {
      console.warn("signOut error:", e);
    }
    router.replace("/(auth)/welcome");
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <ScrollView>
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
          <Row icon="notifications" label="Notifications" onPress={() => router.push("/notification-settings")} testID="row-notifications" />
          <Row icon="mail" label="Email signature" onPress={() => router.push("/signature")} testID="row-signature" />
          <Row icon="lock-closed" label="Privacy" />
          <Row icon="color-palette" label="Theme" hint="Wave" />
          <Row icon="help-circle" label="Help & Support" />
          <Row icon="information-circle" label="About Wave" hint="v1.0" />
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
    {!!hint && <Text style={styles.rowHint}>{hint}</Text>}
    <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
  </TouchableOpacity>
);

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.surface },
  title: { fontSize: 30, fontWeight: "800", color: colors.primary, letterSpacing: -0.5, padding: space.xl },
  profileCard: { flexDirection: "row", alignItems: "center", marginHorizontal: space.xl, padding: 16, backgroundColor: colors.surface2, borderRadius: radius.xl },
  name: { fontSize: 18, fontWeight: "800", color: colors.text },
  phone: { fontSize: 13, color: colors.textMuted, marginTop: 2 },
  about: { fontSize: 13, color: colors.textMuted, marginTop: 4 },
  editBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: "#E8F5F7", alignItems: "center", justifyContent: "center" },
  group: { marginTop: space.xl, marginHorizontal: space.xl, backgroundColor: colors.surface2, borderRadius: radius.xl, overflow: "hidden" },
  rowItem: { flexDirection: "row", alignItems: "center", padding: 14, borderBottomWidth: 1, borderBottomColor: colors.border, gap: 12 },
  rowIcon: { width: 36, height: 36, borderRadius: 18, backgroundColor: "#E8F5F7", alignItems: "center", justifyContent: "center" },
  rowLabel: { flex: 1, fontSize: 15, color: colors.text, fontWeight: "600" },
  rowHint: { fontSize: 13, color: colors.textMuted, marginRight: 6 },
  signOut: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, marginTop: space.xl, marginHorizontal: space.xl, padding: 16, borderRadius: radius.xl, borderWidth: 1, borderColor: colors.danger },
  signOutText: { color: colors.danger, fontWeight: "700", fontSize: 15 },
});
