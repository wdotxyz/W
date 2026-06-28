import React, { useState, useEffect } from "react";
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity, KeyboardAvoidingView, Platform, Alert, ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { api, setToken } from "../../src/api";
import { useAuth } from "../../src/auth";
import { colors, radius, space } from "../../src/theme";

export default function OtpScreen() {
  const router = useRouter();
  const { phone, devOtp, name: signupName, username: signupUsername, password: signupPassword, domain: signupDomain } = useLocalSearchParams<{ phone: string; devOtp?: string; name?: string; username?: string; password?: string; domain?: string }>();
  const [otp, setOtp] = useState("");
  const [loading, setLoading] = useState(false);
  const { setUser } = useAuth();

  const onVerify = async () => {
    if (otp.length !== 6) return;
    setLoading(true);
    try {
      const res = await api<{ token: string; user: any; is_new: boolean }>("/auth/verify-otp", {
        method: "POST",
        body: JSON.stringify({ phone, otp, password: signupPassword || undefined }),
      });
      await setToken(res.token);
      let user = res.user;
      // Apply name + claim handle if provided from signup form
      if (signupName && !user.name) {
        try {
          user = await api<any>("/auth/profile", {
            method: "POST",
            body: JSON.stringify({ name: signupName, avatar: null }),
          });
        } catch {}
      }
      if (signupUsername && !user.email_handle) {
        try {
          user = await api<any>("/mail/claim-handle", {
            method: "POST",
            body: JSON.stringify({ handle: signupUsername, domain: signupDomain || undefined }),
          });
        } catch {}
      }
      setUser(user);
      if (!user.name) router.replace("/(auth)/profile-setup");
      else if (user.custom_domain && !user.domain_verified) router.replace("/domain-setup");
      else router.replace("/(tabs)/mail");
    } catch (e: any) {
      Alert.alert("Invalid OTP", "Please check the code and try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : "height"}>
        <TouchableOpacity onPress={() => router.back()} style={styles.back} testID="otp-back-btn">
          <Ionicons name="chevron-back" size={26} color={colors.text} />
        </TouchableOpacity>
        <View style={styles.body}>
          <Image source={require("../../assets/images/brand-logo.png")} style={styles.brandLogo} resizeMode="contain" />
          <Text style={styles.title}>Enter code</Text>
          <Text style={styles.sub}>
            Sent to <Text style={{ fontWeight: "700", color: colors.text }}>{phone}</Text>
          </Text>
          <TextInput
            style={styles.code}
            value={otp}
            onChangeText={(t) => setOtp(t.replace(/\D/g, "").slice(0, 6))}
            keyboardType="number-pad"
            autoFocus
            placeholder="• • • • • •"
            placeholderTextColor={colors.textMuted}
            testID="otp-input"
          />
          {!!devOtp && (
            <View style={styles.devCard} testID="dev-otp-card">
              <Ionicons name="information-circle" size={18} color={colors.accent} />
              <Text style={styles.devText}>Dev OTP: <Text style={styles.devCode}>{devOtp}</Text></Text>
              <TouchableOpacity onPress={() => setOtp(String(devOtp))} testID="autofill-otp-btn">
                <Text style={styles.devFill}>Autofill</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
        <TouchableOpacity
          style={[styles.cta, (loading || otp.length !== 6) && { opacity: 0.5 }]}
          disabled={loading || otp.length !== 6}
          onPress={onVerify}
          testID="otp-verify-btn"
        >
          {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.ctaText}>Verify</Text>}
        </TouchableOpacity>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.surface },
  flex: { flex: 1, padding: space.xl },
  back: { width: 44, height: 44, alignItems: "center", justifyContent: "center", marginLeft: -8 },
  body: { flex: 1, marginTop: space.lg },
  brandLogo: { width: 48, height: 48, marginBottom: 14 },
  title: { fontSize: 28, fontWeight: "800", color: colors.text, letterSpacing: -0.5 },
  sub: { fontSize: 15, color: colors.textMuted, marginTop: 6, marginBottom: 32 },
  code: {
    backgroundColor: colors.surface2, borderRadius: radius.lg,
    fontSize: 28, textAlign: "center", letterSpacing: 14, paddingVertical: 18, fontWeight: "700", color: colors.text,
  },
  devCard: {
    flexDirection: "row", alignItems: "center", gap: 8,
    marginTop: 18, padding: 12, borderRadius: radius.md, backgroundColor: "#E8F5F7",
  },
  devText: { color: colors.text, fontSize: 14, flex: 1 },
  devCode: { fontWeight: "800", color: colors.accent, letterSpacing: 1 },
  devFill: { color: colors.accent, fontWeight: "700" },
  cta: { backgroundColor: colors.primary, padding: 18, borderRadius: radius.xl, alignItems: "center" },
  ctaText: { color: "#fff", fontSize: 17, fontWeight: "700" },
});
