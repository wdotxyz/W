import React from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Platform } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { colors, radius, space } from "../theme";

export type LegalSection = {
  heading: string;
  body: string | string[];
};

type Props = {
  title: string;
  lastUpdated: string;
  intro?: string;
  sections: LegalSection[];
  testID?: string;
};

export default function LegalPage({ title, lastUpdated, intro, sections, testID }: Props) {
  const router = useRouter();
  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]} testID={testID}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.back} testID="legal-back-btn">
          <Ionicons name="chevron-back" size={26} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>{title}</Text>
        <View style={styles.back} />
      </View>
      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.updated}>Last updated: {lastUpdated}</Text>
        {!!intro && <Text style={styles.intro}>{intro}</Text>}
        {sections.map((s, i) => (
          <View key={i} style={styles.section}>
            <Text style={styles.heading}>{s.heading}</Text>
            {(Array.isArray(s.body) ? s.body : [s.body]).map((p, j) => (
              <Text key={j} style={styles.para}>{p}</Text>
            ))}
          </View>
        ))}
        <Text style={styles.footer}>
          Questions? Email us at support@w.xyz.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.surface },
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 8, paddingVertical: 6,
    borderBottomWidth: Platform.OS === "web" ? 1 : 0.5, borderBottomColor: colors.border,
  },
  back: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  headerTitle: { flex: 1, textAlign: "center", fontSize: 16, fontWeight: "700", color: colors.text },
  body: { padding: space.xl, paddingBottom: 48 },
  title: { fontSize: 28, fontWeight: "800", color: colors.text, letterSpacing: -0.5 },
  updated: { fontSize: 13, color: colors.textMuted, marginTop: 6, marginBottom: 18 },
  intro: { fontSize: 15, color: colors.text, lineHeight: 22, marginBottom: 8 },
  section: { marginTop: 18 },
  heading: { fontSize: 17, fontWeight: "800", color: colors.text, marginBottom: 8, letterSpacing: -0.2 },
  para: { fontSize: 14.5, color: colors.text, lineHeight: 22, marginBottom: 8 },
  footer: { fontSize: 13, color: colors.textMuted, marginTop: 28, textAlign: "center" },
});
