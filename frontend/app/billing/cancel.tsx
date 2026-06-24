import React from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { colors, radius, space } from "../../src/theme";

export default function BillingCancel() {
  const router = useRouter();
  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <View style={styles.body}>
        <Ionicons name="close-circle-outline" size={56} color={colors.textMuted} />
        <Text style={styles.title}>Payment cancelled</Text>
        <Text style={styles.sub}>No worries — you can upgrade anytime.</Text>
        <TouchableOpacity style={styles.cta} onPress={() => router.replace("/billing/upgrade")} testID="back-to-plans">
          <Text style={styles.ctaText}>See plans</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.surface },
  body: { flex: 1, padding: space.xl, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 22, fontWeight: "800", color: colors.text, marginTop: 16 },
  sub: { fontSize: 14, color: colors.textMuted, textAlign: "center", marginTop: 8 },
  cta: { marginTop: 24, backgroundColor: colors.primary, paddingVertical: 14, paddingHorizontal: 24, borderRadius: radius.xl },
  ctaText: { color: "#fff", fontWeight: "800", fontSize: 15 },
});
