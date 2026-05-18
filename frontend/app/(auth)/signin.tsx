import React, { useState } from "react";
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity,
  KeyboardAvoidingView, Platform, Alert, ActivityIndicator,
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
        <TouchableOpacity onPress={() => router.back()} style={styles.back} testID="signin-back-btn">
          <Ionicons name="chevron-back" size={26} color={colors.text} />
        </TouchableOpacity>
        <View style={styles.body}>
          <Text style={styles.title}>Welcome back</Text>
          <Text style={styles.sub}>Enter the phone number you signed up with. We'll send a 6-digit code.</Text>
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
          <Text style={styles.hint}>Dev mode: OTP will be shown on the next screen.</Text>

          <TouchableOpacity
            style={styles.signupRow}
            onPress={() => router.replace("/(auth)/phone")}
            testID="goto-signup-btn"
            activeOpacity={0.7}
          >
            <Text style={styles.signupText}>New to W? </Text>
            <Text style={styles.signupLink}>Create account</Text>
          </TouchableOpacity>
        </View>
        <TouchableOpacity
          style={[styles.cta, (loading || phone.length < 6) && { opacity: 0.5 }]}
          disabled={loading || phone.length < 6}
          onPress={onContinue}
          testID="signin-continue-btn"
        >
          {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.ctaText}>Sign in</Text>}
        </TouchableOpacity>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.surface },
  flex: { flex: 1, padding: space.xl },
  back: { width: 44, height: 44, alignItems: "center", justifyContent: "center", marginLeft: -8 },
  body: { flex: 1, paddingTop: space.lg },
  title: { fontSize: 26, fontWeight: "800", color: colors.text, letterSpacing: -0.5 },
  sub: { fontSize: 14, color: colors.textMuted, marginTop: 6, marginBottom: 18, lineHeight: 20 },
  label: { fontSize: 12, fontWeight: "800", color: colors.textMuted, letterSpacing: 1.2, textTransform: "uppercase", marginTop: 16, marginBottom: 8 },
  row: { flexDirection: "row", gap: 10 },
  country: { backgroundColor: colors.surface2, borderRadius: radius.lg, paddingHorizontal: 10, justifyContent: "center", width: 72 },
  countryInput: { fontSize: 16, color: colors.text, fontWeight: "600", textAlign: "center" },
  phoneBox: { flex: 1, backgroundColor: colors.surface2, borderRadius: radius.lg, paddingHorizontal: 14 },
  phoneInput: { fontSize: 16, color: colors.text, paddingVertical: 14, fontWeight: "500" },
  hint: { color: colors.textMuted, fontSize: 12, marginTop: 10 },
  signupRow: { flexDirection: "row", justifyContent: "center", alignItems: "center", marginTop: 28, padding: 8 },
  signupText: { color: colors.textMuted, fontSize: 14 },
  signupLink: { color: colors.accent, fontSize: 14, fontWeight: "800" },
  cta: { backgroundColor: colors.primary, padding: 16, borderRadius: radius.xl, alignItems: "center" },
  ctaText: { color: "#fff", fontSize: 16, fontWeight: "700" },
});
