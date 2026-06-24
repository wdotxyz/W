import React, { useState } from "react";
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity,
  KeyboardAvoidingView, Platform, Alert, ActivityIndicator, ScrollView, Image,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { api } from "../../src/api";
import { useAuth } from "../../src/auth";
import { colors, radius, space } from "../../src/theme";

export default function SignInScreen() {
  const router = useRouter();
  const { applySession } = useAuth();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPwd, setShowPwd] = useState(false);
  const [loading, setLoading] = useState(false);

  const canSubmit = email.trim().length >= 1 && password.length >= 1 && !loading;

  const onSignIn = async () => {
    if (!canSubmit) return;
    const fullEmail = email.trim().toLowerCase();
    setLoading(true);
    try {
      const res: any = await api("/auth/login", {
        method: "POST",
        body: JSON.stringify({ email: fullEmail, password }),
      });
      if (res?.requires_2fa) {
        router.push({
          pathname: "/(auth)/two-factor",
          params: {
            email: fullEmail,
            password,
            phoneMasked: res.phone_masked || "",
            devOtp: res.dev_otp || "",
          },
        });
        return;
      }
      await applySession(res.token, res.user);
      router.replace("/(tabs)/updates");
    } catch (e: any) {
      const msg = (e?.message || "").toLowerCase();
      if (msg.includes("locked") || msg.includes("429")) {
        Alert.alert("Account locked", "Too many failed attempts. Try again in a few minutes or reset your password.");
      } else {
        Alert.alert("Sign in failed", "The email or password is incorrect.");
      }
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
            <Image
              source={require("../../assets/images/brand-logo.png")}
              style={styles.brandLogo}
              resizeMode="contain"
            />
            <Text style={styles.tag}>Webmail, Reimagined.</Text>
          </View>

          {/* Sign-in form */}
          <View style={styles.formCard}>
            <Text style={styles.title}>Sign in</Text>

            <Text style={styles.label}>Email Address</Text>
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
                testID="signin-email-input"
              />
            </View>

            <Text style={styles.label}>Password</Text>
            <View style={styles.inputBox}>
              <Ionicons name="lock-closed-outline" size={18} color={colors.textMuted} style={styles.leadingIcon} />
              <TextInput
                style={styles.input}
                value={password}
                onChangeText={setPassword}
                placeholder="Password"
                placeholderTextColor={colors.textMuted}
                secureTextEntry={!showPwd}
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="current-password"
                onSubmitEditing={onSignIn}
                returnKeyType="go"
                testID="signin-password-input"
              />
              <TouchableOpacity onPress={() => setShowPwd((v) => !v)} style={styles.eyeBtn} testID="toggle-pwd-visibility">
                <Ionicons name={showPwd ? "eye-off" : "eye"} size={20} color={colors.textMuted} />
              </TouchableOpacity>
            </View>

            <TouchableOpacity
              onPress={() => router.push({ pathname: "/(auth)/forgot-password", params: { email: email.trim() } })}
              style={styles.forgot}
              testID="forgot-password-link"
            >
              <Text style={styles.forgotText}>Forgot password?</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.cta, (!canSubmit) && { opacity: 0.5 }]}
              disabled={!canSubmit}
              onPress={onSignIn}
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

          <View style={{ height: 28 }} />

          {/* Create account — always reachable via scroll */}
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
              By continuing you agree to W Platforms{" "}
              <Text style={styles.legalLink} onPress={() => router.push("/legal/terms")}>Terms</Text>
              {" & "}
              <Text style={styles.legalLink} onPress={() => router.push("/legal/privacy")}>Privacy</Text>
              .
            </Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.surface },
  flex: { flex: 1 },
  scroll: { paddingHorizontal: space.xl, paddingTop: space.xl, paddingBottom: 24, flexGrow: 1, minHeight: "100%" as any },

  brandWrap: { alignItems: "center", marginTop: 12, marginBottom: 20 },
  brandLogo: { width: 72, height: 72, marginBottom: 10 },
  tag: { fontSize: 14, color: colors.textMuted, marginTop: 2 },

  formCard: { marginTop: 8 },
  title: { fontSize: 22, fontWeight: "800", color: colors.text, letterSpacing: -0.3, marginBottom: 14 },
  label: { fontSize: 12, fontWeight: "800", color: colors.textMuted, letterSpacing: 1.2, textTransform: "uppercase", marginTop: 12, marginBottom: 8 },

  inputBox: {
    flexDirection: "row", alignItems: "center",
    backgroundColor: colors.surface2, borderRadius: radius.lg,
    paddingLeft: 12, paddingRight: 6,
  },
  leadingIcon: { marginRight: 8 },
  input: { flex: 1, fontSize: 16, color: colors.text, paddingVertical: 14, fontWeight: "500", minWidth: 0 },
  eyeBtn: { padding: 10 },

  forgot: { alignSelf: "flex-end", marginTop: 10 },
  forgotText: { color: colors.accent, fontWeight: "700", fontSize: 13 },

  cta: {
    flexDirection: "row", backgroundColor: colors.primary, padding: 16, borderRadius: radius.xl,
    alignItems: "center", justifyContent: "center", gap: 8, marginTop: 18,
    shadowColor: colors.primary, shadowOpacity: 0.25, shadowRadius: 12, shadowOffset: { width: 0, height: 6 }, elevation: 4,
  },
  ctaText: { color: "#fff", fontSize: 16, fontWeight: "700" },

  bottomWrap: { paddingTop: 12 },
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
