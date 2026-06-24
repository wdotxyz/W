import React, { useState } from "react";
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity,
  KeyboardAvoidingView, Platform, Alert, ActivityIndicator, ScrollView,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { api } from "../../src/api";
import { colors, radius, space } from "../../src/theme";

export default function SignInScreen() {
  const router = useRouter();
  const [phone, setPhone] = useState("");
  const [country, setCountry] = useState("+1");
  const [loading, setLoading] = useState(false);

  const onContinue = async () => {
    const full = `${country}${phone.replace(/\D/g, "")}`;
    if (phone.length < 6) {
      Alert.alert("Invalid phone", "Please enter a valid phone number.");
      return;
    }
    setLoading(true);
    try {
      const res = await api<{ dev_otp: string }>("/auth/send-otp", {
        method: "POST",
        body: JSON.stringify({ phone: full }),
      });
      router.push({ pathname: "/(auth)/otp", params: { phone: full, devOtp: res.dev_otp } });
    } catch (e: any) {
      Alert.alert("Error", e.message || "Failed to send OTP");
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : "height"}>
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Brand header */}
          <View style={styles.brandWrap}>
            <View style={styles.logoCircle}>
              <Text style={styles.logoW}>W</Text>
            </View>
            <Text style={styles.brand}>Welcome to W</Text>
            <Text style={styles.tag}>Messaging that flows. AI-native.</Text>
          </View>

          {/* Sign-in form */}
          <View style={styles.formCard}>
            <Text style={styles.title}>Sign in</Text>
            <Text style={styles.sub}>Enter your phone number to receive a 6-digit code.</Text>

            <Text style={styles.label}>Phone number</Text>
            <View style={styles.row}>
              <View style={styles.country}>
                <TextInput
                  style={styles.countryInput}
                  value={country}
                  onChangeText={setCountry}
                  maxLength={5}
                  keyboardType="phone-pad"
                  testID="signin-country-input"
                />
              </View>
              <View style={styles.phoneBox}>
                <TextInput
                  style={styles.phoneInput}
                  value={phone}
                  onChangeText={setPhone}
                  placeholder="Phone number"
                  placeholderTextColor={colors.textMuted}
                  keyboardType="phone-pad"
                  autoFocus
                  testID="signin-phone-input"
                />
              </View>
            </View>

            <TouchableOpacity
              style={[styles.cta, (loading || phone.length < 6) && { opacity: 0.5 }]}
              disabled={loading || phone.length < 6}
              onPress={onContinue}
              testID="signin-continue-btn"
              activeOpacity={0.85}
            >
              {loading ? <ActivityIndicator color="#fff" /> : (
                <>
                  <Text style={styles.ctaText}>Sign in</Text>
                  <Ionicons name="arrow-forward" size={20} color="#fff" />
                </>
              )}
            </TouchableOpacity>
          </View>
        </ScrollView>

        {/* Create account — bottom, prominent */}
        <View style={styles.bottomWrap}>
          <View style={styles.divider}>
            <View style={styles.line} />
            <Text style={styles.dividerText}>New to W?</Text>
            <View style={styles.line} />
          </View>
          <TouchableOpacity
            style={styles.createBtn}
            onPress={() => router.push("/(auth)/phone")}
            testID="goto-signup-btn"
            activeOpacity={0.85}
          >
            <Ionicons name="person-add-outline" size={18} color={colors.primary} />
            <Text style={styles.createText}>Create an account</Text>
          </TouchableOpacity>
          <Text style={styles.legal}>
            By continuing you agree to W{" "}
            <Text style={styles.legalLink} onPress={() => router.push("/legal/terms")}>Terms</Text>
            {" & "}
            <Text style={styles.legalLink} onPress={() => router.push("/legal/privacy")}>Privacy</Text>
            .
          </Text>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.surface },
  flex: { flex: 1 },
  scroll: { paddingHorizontal: space.xl, paddingTop: space.xl, paddingBottom: 12, flexGrow: 1 },

  brandWrap: { alignItems: "center", marginTop: 24, marginBottom: 28 },
  logoCircle: {
    width: 72, height: 72, borderRadius: 22, backgroundColor: colors.primary,
    alignItems: "center", justifyContent: "center", marginBottom: 14,
    shadowColor: colors.primary, shadowOpacity: 0.25, shadowRadius: 16, shadowOffset: { width: 0, height: 6 }, elevation: 5,
  },
  logoW: { color: "#fff", fontSize: 36, fontWeight: "800", letterSpacing: -1 },
  brand: { fontSize: 24, fontWeight: "800", color: colors.text, letterSpacing: -0.5 },
  tag: { fontSize: 14, color: colors.textMuted, marginTop: 4 },

  formCard: { marginTop: 8 },
  title: { fontSize: 22, fontWeight: "800", color: colors.text, letterSpacing: -0.3 },
  sub: { fontSize: 14, color: colors.textMuted, marginTop: 6, marginBottom: 16, lineHeight: 20 },
  label: { fontSize: 12, fontWeight: "800", color: colors.textMuted, letterSpacing: 1.2, textTransform: "uppercase", marginTop: 8, marginBottom: 8 },
  row: { flexDirection: "row", gap: 10 },
  country: { backgroundColor: colors.surface2, borderRadius: radius.lg, paddingHorizontal: 10, justifyContent: "center", width: 72 },
  countryInput: { fontSize: 16, color: colors.text, fontWeight: "600", textAlign: "center" },
  phoneBox: { flex: 1, backgroundColor: colors.surface2, borderRadius: radius.lg, paddingHorizontal: 14 },
  phoneInput: { fontSize: 16, color: colors.text, paddingVertical: 14, fontWeight: "500" },

  cta: {
    flexDirection: "row", backgroundColor: colors.primary, padding: 16, borderRadius: radius.xl,
    alignItems: "center", justifyContent: "center", gap: 8, marginTop: 22,
    shadowColor: colors.primary, shadowOpacity: 0.25, shadowRadius: 12, shadowOffset: { width: 0, height: 6 }, elevation: 4,
  },
  ctaText: { color: "#fff", fontSize: 16, fontWeight: "700" },

  bottomWrap: { paddingHorizontal: space.xl, paddingBottom: 24, paddingTop: 12 },
  divider: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 14 },
  line: { flex: 1, height: 1, backgroundColor: colors.surface2 },
  dividerText: { fontSize: 12, color: colors.textMuted, fontWeight: "700", letterSpacing: 0.5 },
  createBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    backgroundColor: colors.surface, borderRadius: radius.xl, padding: 16,
    borderWidth: 1.5, borderColor: colors.primary,
  },
  createText: { color: colors.primary, fontSize: 16, fontWeight: "800" },
  legal: { textAlign: "center", color: colors.textMuted, fontSize: 11, marginTop: 12 },
  legalLink: { color: colors.accent, fontWeight: "700", textDecorationLine: "underline" },
});
