import React from "react";
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Alert } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { colors, radius, space } from "../../src/theme";
import { smartBack } from "../../src/utils/nav";

export default function PasskeysScreen() {
  const router = useRouter();

  const onAdd = () => {
    Alert.alert(
      "Passkey setup",
      "Passkeys let you sign in with Face ID, Touch ID, or your device PIN \u2014 no password needed. We\u2019ll have you up and running soon.",
      [{ text: "Got it" }],
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => smartBack(router)} style={styles.iconBtn} testID="passkeys-back">
          <Ionicons name="chevron-back" size={26} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.title}>Passkeys</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.hero}>
          <View style={styles.iconWrap}><Ionicons name="key" size={32} color={colors.accent} /></View>
          <Text style={styles.heroTitle}>Sign in without a password</Text>
          <Text style={styles.heroBody}>
            Passkeys use Face ID, Touch ID, or your device PIN to sign you into W securely — phishing-proof and faster than typing.
          </Text>
        </View>

        <View style={styles.empty}>
          <Ionicons name="finger-print" size={26} color={colors.textMuted} />
          <Text style={styles.emptyTitle}>No passkeys yet</Text>
          <Text style={styles.emptyBody}>Add a passkey from this device to enable one-tap sign-in.</Text>
        </View>

        <TouchableOpacity onPress={onAdd} style={styles.cta} activeOpacity={0.85} testID="add-passkey-btn">
          <Ionicons name="add" size={20} color="#fff" />
          <Text style={styles.ctaText}>Add a passkey on this device</Text>
        </TouchableOpacity>

        <Text style={styles.foot}>
          Coming soon: full Face ID / Touch ID enrollment, multi-device sync via iCloud Keychain &amp; Google Password Manager, and security-key support.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: "row", alignItems: "center", padding: space.md, gap: 8, borderBottomWidth: 1, borderBottomColor: colors.border },
  iconBtn: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  title: { flex: 1, fontSize: 18, fontWeight: "800", color: colors.text },
  scroll: { padding: space.xl, gap: 16 },
  hero: { backgroundColor: colors.surface2, borderRadius: radius.xl, padding: 20, alignItems: "center" },
  iconWrap: { width: 60, height: 60, borderRadius: 30, backgroundColor: "#E8F5F7", alignItems: "center", justifyContent: "center", marginBottom: 12 },
  heroTitle: { fontSize: 18, fontWeight: "800", color: colors.text, textAlign: "center", letterSpacing: -0.3 },
  heroBody: { fontSize: 13.5, color: colors.textMuted, lineHeight: 19, textAlign: "center", marginTop: 6 },
  empty: { backgroundColor: colors.surface2, borderRadius: radius.xl, padding: 20, alignItems: "center", gap: 6 },
  emptyTitle: { fontSize: 15, fontWeight: "800", color: colors.text, marginTop: 6 },
  emptyBody: { fontSize: 13, color: colors.textMuted, textAlign: "center", lineHeight: 18 },
  cta: { backgroundColor: colors.primary, borderRadius: radius.xl, paddingVertical: 14, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  ctaText: { color: "#fff", fontSize: 15, fontWeight: "800" },
  foot: { fontSize: 12, color: colors.textMuted, textAlign: "center", lineHeight: 17, marginTop: 4 },
});
