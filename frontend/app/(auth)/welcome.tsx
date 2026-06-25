import React from "react";
import { View, Text, StyleSheet, TouchableOpacity, ImageBackground } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { colors, space, radius } from "../../src/theme";

export default function Welcome() {
  const router = useRouter();
  return (
    <ImageBackground
      source={{ uri: "https://static.prod-images.emergentagent.com/jobs/0a6fb986-57f6-4143-b026-cc3c8d533f4c/images/5dda163c1d940a241699ed3e8a222f28e5989b3a896ee5168284d6ed020ea7bb.png" }}
      style={styles.bg}
      imageStyle={{ opacity: 0.18 }}
    >
      <View style={styles.container} testID="welcome-screen">
        <View style={styles.logoWrap}>
          <View style={styles.logoCircle}>
            <Ionicons name="chatbubbles" size={42} color="#fff" />
          </View>
          <Text style={styles.brand}>W</Text>
          <Text style={styles.tag}>Messaging that flows. AI-native.</Text>
        </View>

        <View style={styles.bullets}>
          <Bullet icon="lock-closed" text="End-to-end private chats" />
          <Bullet icon="sparkles" text="Built-in W AI assistant" />
          <Bullet icon="mic" text="Voice notes, photos & groups" />
        </View>

        <View style={styles.ctaGroup}>
          <TouchableOpacity
            style={styles.cta}
            onPress={() => router.push("/(auth)/phone")}
            testID="welcome-get-started-btn"
            activeOpacity={0.85}
          >
            <Text style={styles.ctaText}>Get started</Text>
            <Ionicons name="arrow-forward" size={20} color="#fff" />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => router.push("/(auth)/signin")}
            testID="welcome-signin-link"
            activeOpacity={0.7}
            style={styles.signInLink}
          >
            <Text style={styles.signInText}>
              Already have an account? <Text style={styles.signInBold}>Sign in</Text>
            </Text>
          </TouchableOpacity>
        </View>
        <Text style={styles.legal}>By continuing you agree to W Platforms Terms & Privacy.</Text>
      </View>
    </ImageBackground>
  );
}

const Bullet = ({ icon, text }: any) => (
  <View style={styles.bullet}>
    <View style={styles.bulletIcon}>
      <Ionicons name={icon} size={18} color={colors.accent} />
    </View>
    <Text style={styles.bulletText}>{text}</Text>
  </View>
);

const styles = StyleSheet.create({
  bg: { flex: 1, backgroundColor: colors.surface2 },
  container: { flex: 1, padding: space.xl, justifyContent: "space-between", paddingTop: 96, paddingBottom: 48 },
  logoWrap: { alignItems: "flex-start" },
  logoCircle: {
    width: 80, height: 80, borderRadius: 24, backgroundColor: colors.primary,
    alignItems: "center", justifyContent: "center", marginBottom: space.lg,
    shadowColor: colors.primary, shadowOpacity: 0.3, shadowRadius: 20, shadowOffset: { width: 0, height: 8 }, elevation: 6,
  },
  brand: { fontSize: 56, fontWeight: "800", color: colors.primary, letterSpacing: -1.5 },
  tag: { fontSize: 17, color: colors.textMuted, marginTop: 4 },
  bullets: { gap: 16, marginVertical: space.xl },
  bullet: { flexDirection: "row", alignItems: "center", gap: 14 },
  bulletIcon: {
    width: 40, height: 40, borderRadius: radius.md, backgroundColor: "#E8F5F7",
    alignItems: "center", justifyContent: "center",
  },
  bulletText: { fontSize: 16, color: colors.text, fontWeight: "500" },
  ctaGroup: { gap: 12 },
  cta: {
    flexDirection: "row", backgroundColor: colors.primary, padding: 18, borderRadius: radius.xl,
    alignItems: "center", justifyContent: "center", gap: 10,
    shadowColor: colors.primary, shadowOpacity: 0.25, shadowRadius: 16, shadowOffset: { width: 0, height: 6 }, elevation: 5,
  },
  ctaText: { color: "#fff", fontSize: 17, fontWeight: "700" },
  signInLink: { alignItems: "center", padding: 8 },
  signInText: { color: colors.textMuted, fontSize: 14 },
  signInBold: { color: colors.primary, fontWeight: "700" },
  legal: { textAlign: "center", color: colors.textMuted, fontSize: 12, marginTop: 14 },
});
