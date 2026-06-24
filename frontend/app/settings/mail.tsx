import React from "react";
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "../../src/auth";
import { colors, radius, space } from "../../src/theme";

export default function MailSettingsScreen() {
  const router = useRouter();
  const { user } = useAuth();

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn} testID="mail-settings-back">
          <Ionicons name="chevron-back" size={26} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.title}>Mail</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.intro}>Manage everything W Mail — privacy controls, recovery, automations, and your signature.</Text>
        <View style={styles.group}>
          <Row icon="eye-off" label="Ghost Mail" hint={(user as any)?.ghost_mail_enabled === false ? "Off" : "On"} onPress={() => router.push("/ghost-mail")} testID="row-ghost-mail" />
          <Row icon="key" label="Recovery email" hint={(user as any)?.recovery_email ? "Verified" : "Not set"} onPress={() => router.push("/recovery-email")} testID="row-recovery-email" />
          <Row icon="paper-plane" label="Auto-reply" hint={(user as any)?.auto_reply?.enabled ? "On" : "Off"} onPress={() => router.push("/auto-reply")} testID="row-auto-reply" />
          <Row icon="mail" label="Email signature" onPress={() => router.push("/signature")} testID="row-signature" />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const Row = ({ icon, label, hint, onPress, testID }: any) => (
  <TouchableOpacity onPress={onPress} activeOpacity={0.6} style={styles.rowItem} testID={testID}>
    <View style={styles.rowIcon}><Ionicons name={icon} size={18} color={colors.accent} /></View>
    <Text style={styles.rowLabel}>{label}</Text>
    {!!hint && <Text style={styles.rowHint}>{hint}</Text>}
    <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
  </TouchableOpacity>
);

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: "row", alignItems: "center", padding: space.md, gap: 8, borderBottomWidth: 1, borderBottomColor: colors.border },
  iconBtn: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  title: { flex: 1, fontSize: 18, fontWeight: "800", color: colors.text },
  scroll: { padding: space.xl, gap: 14 },
  intro: { fontSize: 13.5, color: colors.textMuted, lineHeight: 19 },
  group: { backgroundColor: colors.surface2, borderRadius: radius.xl, overflow: "hidden" },
  rowItem: { flexDirection: "row", alignItems: "center", padding: 14, borderBottomWidth: 1, borderBottomColor: colors.border, gap: 12 },
  rowIcon: { width: 36, height: 36, borderRadius: 18, backgroundColor: "#E8F5F7", alignItems: "center", justifyContent: "center" },
  rowLabel: { flex: 1, fontSize: 15, color: colors.text, fontWeight: "600" },
  rowHint: { fontSize: 13, color: colors.textMuted, marginRight: 6 },
});
