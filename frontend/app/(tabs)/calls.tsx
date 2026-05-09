import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { colors, space } from "../../src/theme";

export default function CallsScreen() {
  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <Text style={styles.title}>Calls</Text>
      <View style={styles.empty} testID="calls-empty">
        <Ionicons name="call-outline" size={48} color={colors.textMuted} />
        <Text style={styles.emptyTitle}>No calls yet</Text>
        <Text style={styles.emptySub}>Voice & video calls coming soon.</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.surface },
  title: { fontSize: 30, fontWeight: "800", color: colors.primary, letterSpacing: -0.5, padding: space.xl },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 40, marginTop: -80 },
  emptyTitle: { fontSize: 18, fontWeight: "700", color: colors.text, marginTop: 12 },
  emptySub: { color: colors.textMuted, marginTop: 4, textAlign: "center" },
});
