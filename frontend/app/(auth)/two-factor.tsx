import React, { useState } from "react";
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity, KeyboardAvoidingView,
  Platform, Alert, ActivityIndicator, ScrollView, Image,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { api } from "../../src/api";
import { useAuth } from "../../src/auth";
import { colors, radius, space } from "../../src/theme";

export default function TwoFactorScreen() {
  const router = useRouter();
  const { applySession } = useAuth();
  const params = useLocalSearchParams<{ email: string; password: string; phoneMasked?: string; devOtp?: string }>();
  const [otp, setOtp] = useState("");
  const [busy, setBusy] = useState(false);
  const [resending, setResending] = useState(false);
  const [devOtp, setDevOtp] = useState((params.devOtp as string) || "");

  const onVerify = async () => {
    if (otp.length !== 6) return;
    setBusy(true);
    try {
      const res: any = await api("/auth/login", {
        method: "POST",
        body: JSON.stringify({ email: params.email, password: params.password, otp }),
      });
      if (res?.token) {
        await applySession(res.token, res.user);
        router.replace("/(tabs)/updates");
      } else {
        Alert.alert("Couldn't verify", "Please try again.");
      }
    } catch (e: any) {
      Alert.alert("Wrong code", "The verification code is incorrect or expired.");
    } finally { setBusy(false); }
  };

  const onResend = async () => {
    setResending(true);
    try {
      const res: any = await api("/auth/login", {
        method: "POST",
        body: JSON.stringify({ email: params.email, password: params.password }),
      });
      setDevOtp(res?.dev_otp || "");
      Alert.alert("Code sent", `A new code has been sent to ${res?.phone_masked || "your phone"}.`);
    } catch (e: any) {
      Alert.alert("Couldn't resend", e?.message || "Please try again.");
    } finally { setResending(false); }
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : "height"}>
        <TouchableOpacity onPress={() => router.back()} style={styles.back} testID="tfa-back-btn">
          <Ionicons name="chevron-back" size={26} color={colors.text} />
        </TouchableOpacity>
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <Image source={require("../../assets/images/brand-logo.png")} style={styles.logo} resizeMode="contain" />
          <Text style={styles.title}>Verify it&apos;s you</Text>
          <Text style={styles.sub}>
            We sent a 6-digit code to <Text style={{ fontWeight: "700", color: colors.text }}>{(params.phoneMasked as string) || "your phone"}</Text>.
          </Text>

          {!!devOtp && (
            <View style={styles.devHint}>
              <Ionicons name="information-circle" size={16} color={colors.accent} />
              <Text style={styles.devHintText}>Dev OTP: <Text style={{ fontWeight: "800" }}>{devOtp}</Text></Text>
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
              autoFocus
              maxLength={6}
              testID="tfa-otp-input"
            />
          </View>

          <TouchableOpacity
            style={[styles.cta, (otp.length !== 6 || busy) && { opacity: 0.5 }]}
            disabled={otp.length !== 6 || busy}
            onPress={onVerify}
            testID="tfa-verify-btn"
          >
            {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.ctaText}>Verify & sign in</Text>}
          </TouchableOpacity>

          <TouchableOpacity onPress={onResend} disabled={resending} style={{ alignSelf: "center", marginTop: 14 }} testID="tfa-resend-btn">
            <Text style={styles.resend}>{resending ? "Sending…" : "Resend code"}</Text>
          </TouchableOpacity>
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
  logo: { width: 64, height: 64, marginBottom: 18 },
  title: { fontSize: 26, fontWeight: "800", color: colors.text, letterSpacing: -0.5 },
  sub: { fontSize: 14, color: colors.textMuted, marginTop: 8, marginBottom: 16, lineHeight: 20 },
  label: { fontSize: 12, fontWeight: "800", color: colors.textMuted, letterSpacing: 1.2, textTransform: "uppercase", marginTop: 14, marginBottom: 8 },
  inputBox: { flexDirection: "row", alignItems: "center", backgroundColor: colors.surface2, borderRadius: radius.lg, paddingLeft: 12, paddingRight: 6 },
  leadingIcon: { marginRight: 8 },
  input: { flex: 1, fontSize: 18, color: colors.text, paddingVertical: 14, fontWeight: "700", minWidth: 0 },
  cta: { flexDirection: "row", backgroundColor: colors.primary, padding: 16, borderRadius: radius.xl, alignItems: "center", justifyContent: "center", marginTop: 20 },
  ctaText: { color: "#fff", fontSize: 16, fontWeight: "700" },
  resend: { color: colors.accent, fontWeight: "700", fontSize: 13 },
  devHint: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "#E8F5F7", padding: 10, borderRadius: 10, marginBottom: 4 },
  devHintText: { fontSize: 13, color: colors.text },
});
