import React, { useState } from "react";
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity,
  KeyboardAvoidingView, Platform, Alert, ActivityIndicator, ScrollView, Image,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { api } from "../../src/api";
import { useAuth } from "../../src/auth";
import { colors, radius, space } from "../../src/theme";

const HANDLE_RE = /^[a-z0-9-]+$/;

export default function ForgotPasswordScreen() {
  const router = useRouter();
  const { applySession } = useAuth();
  const params = useLocalSearchParams<{ email?: string }>();

  const [step, setStep] = useState<"request" | "reset">("request");
  const [email, setEmail] = useState((params.email as string) || "");
  const [otp, setOtp] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [showPwd, setShowPwd] = useState(false);
  const [loading, setLoading] = useState(false);
  const [devOtpHint, setDevOtpHint] = useState<string | null>(null);

  const normalizeEmail = (raw: string) => {
    const v = (raw || "").trim().toLowerCase();
    if (!v) return "";
    if (v.includes("@")) return v;
    if (HANDLE_RE.test(v)) return `${v}@w.xyz`;
    return v;
  };

  const onRequest = async () => {
    const full = normalizeEmail(email);
    if (!full || !full.includes("@")) {
      Alert.alert("Enter your email", "Use your @w.xyz address.");
      return;
    }
    setLoading(true);
    try {
      const res = await api<{ success: boolean; dev_otp?: string }>("/auth/forgot-password", {
        method: "POST",
        body: JSON.stringify({ email: full }),
      });
      setDevOtpHint(res.dev_otp || null);
      setStep("reset");
    } catch (e: any) {
      // Generic — always pretend it worked (avoids enumeration)
      setStep("reset");
    } finally {
      setLoading(false);
    }
  };

  const pwdStrong = newPassword.length >= 8 && /[0-9\W_]/.test(newPassword);
  const canReset = otp.length === 6 && pwdStrong && !loading;

  const onReset = async () => {
    if (!canReset) return;
    const full = normalizeEmail(email);
    setLoading(true);
    try {
      const res = await api<{ token: string; user: any }>("/auth/reset-password", {
        method: "POST",
        body: JSON.stringify({ email: full, otp, new_password: newPassword }),
      });
      await applySession(res.token, res.user);
      Alert.alert("Password reset", "You're signed in with your new password.");
      router.replace("/(tabs)/mail");
    } catch (e: any) {
      Alert.alert("Couldn't reset", "The code or password is invalid. Try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : "height"}>
        <TouchableOpacity onPress={() => router.back()} style={styles.back} testID="fp-back-btn">
          <Ionicons name="chevron-back" size={26} color={colors.text} />
        </TouchableOpacity>
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <Image source={require("../../assets/images/brand-logo.png")} style={styles.logo} resizeMode="contain" />

          {step === "request" ? (
            <>
              <Text style={styles.title}>Reset password</Text>
              <Text style={styles.sub}>Enter your @w.xyz address. We&apos;ll text a 6-digit code to the phone on file.</Text>

              <Text style={styles.label}>Email</Text>
              <View style={styles.inputBox}>
                <Ionicons name="mail-outline" size={18} color={colors.textMuted} style={styles.leadingIcon} />
                <TextInput
                  style={styles.input}
                  value={email}
                  onChangeText={setEmail}
                  placeholder="you@w.xyz"
                  placeholderTextColor={colors.textMuted}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete="email"
                  testID="fp-email-input"
                />
              </View>

              <TouchableOpacity
                style={[styles.cta, (loading || email.length < 1) && { opacity: 0.5 }]}
                disabled={loading || email.length < 1}
                onPress={onRequest}
                testID="fp-request-btn"
              >
                {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.ctaText}>Send reset code</Text>}
              </TouchableOpacity>
            </>
          ) : (
            <>
              <Text style={styles.title}>Enter your code</Text>
              <Text style={styles.sub}>
                If an account exists for <Text style={{ fontWeight: "700", color: colors.text }}>{normalizeEmail(email)}</Text>, we&apos;ve sent a 6-digit code to the phone on file.
              </Text>
              {!!devOtpHint && (
                <View style={styles.devHint}>
                  <Ionicons name="information-circle" size={16} color={colors.accent} />
                  <Text style={styles.devHintText}>Dev OTP: <Text style={{ fontWeight: "800" }}>{devOtpHint}</Text></Text>
                </View>
              )}

              <Text style={styles.label}>Code</Text>
              <View style={styles.inputBox}>
                <Ionicons name="keypad-outline" size={18} color={colors.textMuted} style={styles.leadingIcon} />
                <TextInput
                  style={[styles.input, { letterSpacing: 8, fontWeight: "700" }]}
                  value={otp}
                  onChangeText={(t) => setOtp(t.replace(/\D/g, "").slice(0, 6))}
                  placeholder="••••••"
                  placeholderTextColor={colors.textMuted}
                  keyboardType="number-pad"
                  maxLength={6}
                  testID="fp-otp-input"
                />
              </View>

              <Text style={styles.label}>New password</Text>
              <View style={styles.inputBox}>
                <Ionicons name="lock-closed-outline" size={18} color={colors.textMuted} style={styles.leadingIcon} />
                <TextInput
                  style={styles.input}
                  value={newPassword}
                  onChangeText={setNewPassword}
                  placeholder="At least 8 chars with a number/symbol"
                  placeholderTextColor={colors.textMuted}
                  secureTextEntry={!showPwd}
                  autoCapitalize="none"
                  autoCorrect={false}
                  testID="fp-new-pwd-input"
                />
                <TouchableOpacity onPress={() => setShowPwd((v) => !v)} style={styles.eyeBtn}>
                  <Ionicons name={showPwd ? "eye-off" : "eye"} size={20} color={colors.textMuted} />
                </TouchableOpacity>
              </View>
              <View style={styles.statusRow}>
                {newPassword.length === 0 ? (
                  <Text style={styles.statusText}>Pick something strong — you&apos;ll use it next time</Text>
                ) : pwdStrong ? (
                  <><Ionicons name="checkmark-circle" size={16} color={colors.success} /><Text style={[styles.statusText, { color: colors.success }]}>Strong password</Text></>
                ) : (
                  <><Ionicons name="alert-circle" size={16} color={colors.danger} /><Text style={[styles.statusText, { color: colors.danger }]}>Need 8+ chars with a number or symbol</Text></>
                )}
              </View>

              <TouchableOpacity
                style={[styles.cta, !canReset && { opacity: 0.5 }]}
                disabled={!canReset}
                onPress={onReset}
                testID="fp-reset-btn"
              >
                {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.ctaText}>Reset password & sign in</Text>}
              </TouchableOpacity>

              <TouchableOpacity onPress={() => setStep("request")} style={{ alignSelf: "center", marginTop: 14 }} testID="fp-resend-btn">
                <Text style={styles.resend}>Use a different email</Text>
              </TouchableOpacity>
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.surface },
  flex: { flex: 1 },
  back: { width: 44, height: 44, alignItems: "center", justifyContent: "center", marginLeft: 6 },
  body: { paddingHorizontal: space.xl, paddingTop: 8, paddingBottom: 32 },
  logo: { width: 48, height: 48, marginBottom: 14 },
  title: { fontSize: 26, fontWeight: "800", color: colors.text, letterSpacing: -0.5 },
  sub: { fontSize: 14, color: colors.textMuted, marginTop: 8, marginBottom: 16, lineHeight: 20 },
  label: { fontSize: 12, fontWeight: "800", color: colors.textMuted, letterSpacing: 1.2, textTransform: "uppercase", marginTop: 14, marginBottom: 8 },
  inputBox: { flexDirection: "row", alignItems: "center", backgroundColor: colors.surface2, borderRadius: radius.lg, paddingLeft: 12, paddingRight: 6 },
  leadingIcon: { marginRight: 8 },
  input: { flex: 1, fontSize: 16, color: colors.text, paddingVertical: 14, fontWeight: "500", minWidth: 0 },
  eyeBtn: { padding: 10 },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 6, minHeight: 18 },
  statusText: { fontSize: 12, color: colors.textMuted, fontWeight: "600" },
  cta: { flexDirection: "row", backgroundColor: colors.primary, padding: 16, borderRadius: radius.xl, alignItems: "center", justifyContent: "center", gap: 8, marginTop: 20 },
  ctaText: { color: "#fff", fontSize: 16, fontWeight: "700" },
  resend: { color: colors.accent, fontWeight: "700", fontSize: 13 },
  devHint: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "#E8F5F7", padding: 10, borderRadius: 10, marginBottom: 4 },
  devHintText: { fontSize: 13, color: colors.text },
});
