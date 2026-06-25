import React from "react";
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Image, Linking } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { colors, radius, space } from "../src/theme";

const VERSION = "1.0";

export default function AboutScreen() {
  const router = useRouter();

  const Row = ({ label, value, onPress, testID }: any) => (
    <TouchableOpacity onPress={onPress} disabled={!onPress} activeOpacity={onPress ? 0.6 : 1} style={styles.row} testID={testID}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue} numberOfLines={1}>{value}</Text>
      {onPress && <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />}
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn} testID="about-back">
          <Ionicons name="chevron-back" size={26} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.title}>About W</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.hero}>
          <Image source={require("../assets/images/brand-logo.png")} style={styles.logo} resizeMode="contain" />
          <Text style={styles.brand}>W Platforms</Text>
          <Text style={styles.tag}>Webmail, Reimagined.</Text>
          <Text style={styles.version}>Version {VERSION}</Text>
        </View>

        <View style={styles.copyBlock}>
          <Text style={styles.copy}>
            W is the AI-native webmail provider, built for whoever and whatever.
          </Text>
        </View>

        <View style={styles.group}>
          <Row label="Version" value={VERSION} />
          <Row label="Privacy Policy" value="" onPress={() => router.push("/legal/privacy")} testID="about-privacy" />
          <Row label="Terms of Service" value="" onPress={() => router.push("/legal/terms")} testID="about-terms" />
          <Row label="Website" value="w.xyz" onPress={() => Linking.openURL("https://w.xyz")} testID="about-website" />
        </View>

        <Text style={styles.footer}>© {new Date().getFullYear()} W Platforms — All rights reserved.</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: "row", alignItems: "center", padding: space.md, gap: 8, borderBottomWidth: 1, borderBottomColor: colors.border },
  iconBtn: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  title: { flex: 1, fontSize: 18, fontWeight: "800", color: colors.text },
  scroll: { padding: space.xl, gap: 18 },
  hero: { alignItems: "center", paddingVertical: 12 },
  logo: { width: 64, height: 64, marginBottom: 14 },
  brand: { fontSize: 22, fontWeight: "800", color: colors.text, letterSpacing: -0.4 },
  tag: { fontSize: 14, color: colors.accent, fontWeight: "700", marginTop: 4 },
  version: { fontSize: 12, color: colors.textMuted, marginTop: 6 },
  copyBlock: { gap: 12 },
  copy: { fontSize: 14, color: colors.text, lineHeight: 21 },
  group: { backgroundColor: colors.surface2, borderRadius: radius.xl, overflow: "hidden" },
  row: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 14, gap: 8, borderBottomWidth: 1, borderBottomColor: colors.border },
  rowLabel: { flex: 1, fontSize: 14, fontWeight: "600", color: colors.text },
  rowValue: { fontSize: 13, color: colors.textMuted },
  footer: { textAlign: "center", color: colors.textMuted, fontSize: 11, marginTop: 8 },
});
