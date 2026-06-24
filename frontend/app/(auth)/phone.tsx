import React, { useState, useEffect } from "react";
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity,
  KeyboardAvoidingView, Platform, Alert, ActivityIndicator, ScrollView,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { api } from "../../src/api";
import { colors, radius, space } from "../../src/theme";

export default function PhoneScreen() {
  const router = useRouter();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [username, setUsername] = useState("");
  const [usernameStatus, setUsernameStatus] = useState<{ available?: boolean; reason?: string; checking?: boolean; tier?: "free" | "premium" | "reserved" | "unavailable" }>({});
  const [phone, setPhone] = useState("");
  const [country, setCountry] = useState("+1");
  const [password, setPassword] = useState("");
  const [showPwd, setShowPwd] = useState(false);
  const [domainMode, setDomainMode] = useState<"wxyz" | "custom">("wxyz");
  const [customDomain, setCustomDomain] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (domainMode === "custom") {
      // Custom domain: 1-26 chars, format only — no tier gating, since user owns the domain
      setUsernameStatus({});
      return;
    }
    if (username.length < 1) { setUsernameStatus({}); return; }
    setUsernameStatus({ checking: true });
    const t = setTimeout(async () => {
      try {
        const res = await api<any>(`/mail/check-handle/${encodeURIComponent(username)}`);
        setUsernameStatus({ available: res.available, reason: res.reason, tier: res.tier });
      } catch { setUsernameStatus({}); }
    }, 350);
    return () => clearTimeout(t);
  }, [username]);

  const validDomain = /^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/.test(customDomain);
  const validCustomHandle = /^[a-z0-9]([a-z0-9-]{0,24}[a-z0-9])?$/.test(username) && username.length >= 1 && username.length <= 26;
  const fullName = `${firstName.trim()} ${lastName.trim()}`.trim();
  const pwdStrong = password.length >= 8 && /[0-9\W_]/.test(password);
  const isValid =
    firstName.trim().length >= 2 &&
    lastName.trim().length >= 1 &&
    phone.length >= 6 &&
    pwdStrong &&
    (domainMode === "wxyz"
      ? (usernameStatus.available === true && usernameStatus.tier === "free")
      : (validDomain && validCustomHandle));

  const onContinue = async () => {
    if (!isValid) return;
    const full = `${country}${phone.replace(/\D/g, "")}`;
    setLoading(true);
    try {
      const res = await api<{ dev_otp: string }>("/auth/send-otp", {
        method: "POST",
        body: JSON.stringify({ phone: full }),
      });
      router.push({
        pathname: "/(auth)/otp",
        params: {
          phone: full,
          devOtp: res.dev_otp,
          name: fullName,
          username: username.trim(),
          password,
          domain: domainMode === "custom" ? customDomain.trim() : "",
        },
      });
    } catch (e: any) {
      Alert.alert("Error", e.message || "Failed to send OTP");
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : "height"}>
        <TouchableOpacity onPress={() => router.back()} style={styles.back} testID="phone-back-btn">
          <Ionicons name="chevron-back" size={26} color={colors.text} />
        </TouchableOpacity>
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          <Text style={styles.title}>Create your account</Text>
          <Text style={styles.sub}>Tell us who you are and pick a unique @w.xyz email address.</Text>

          {/* NAME — first + last */}
          <Text style={styles.label}>Name</Text>
          <View style={styles.nameRow}>
            <View style={[styles.inputBox, { flex: 1 }]}>
              <TextInput
                style={styles.input}
                placeholder="First name"
                placeholderTextColor={colors.textMuted}
                value={firstName}
                onChangeText={setFirstName}
                autoCapitalize="words"
                maxLength={30}
                testID="signup-firstname-input"
              />
            </View>
            <View style={[styles.inputBox, { flex: 1 }]}>
              <TextInput
                style={styles.input}
                placeholder="Last name"
                placeholderTextColor={colors.textMuted}
                value={lastName}
                onChangeText={setLastName}
                autoCapitalize="words"
                maxLength={30}
                testID="signup-lastname-input"
              />
            </View>
          </View>

          {/* USERNAME */}
          <Text style={styles.label}>Email address</Text>
          <View style={styles.handleRow}>
            <TextInput
              style={styles.handleInput}
              placeholder="yourhandle"
              placeholderTextColor={colors.textMuted}
              value={username}
              onChangeText={(t) => setUsername(t.toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 26))}
              autoCapitalize="none"
              autoCorrect={false}
              maxLength={26}
              testID="signup-username-input"
            />
            <TouchableOpacity
              onPress={() => setDomainMode((m) => (m === "wxyz" ? "custom" : "wxyz"))}
              style={styles.domainPicker}
              testID="domain-picker"
            >
              <Text style={styles.domain}>
                {domainMode === "wxyz" ? "@w.xyz" : (customDomain ? `@${customDomain}` : "@your-domain")}
              </Text>
              <Ionicons name="chevron-down" size={14} color={colors.accent} />
            </TouchableOpacity>
          </View>

          {domainMode === "custom" && (
            <View style={styles.customWrap}>
              <Text style={styles.label}>Your domain</Text>
              <View style={styles.handleRow}>
                <TextInput
                  style={styles.handleInput}
                  placeholder="janedoe.com"
                  placeholderTextColor={colors.textMuted}
                  value={customDomain}
                  onChangeText={(t) => setCustomDomain(t.toLowerCase().replace(/[^a-z0-9.-]/g, ""))}
                  autoCapitalize="none"
                  autoCorrect={false}
                  testID="custom-domain-input"
                />
              </View>
              {!!username && !!customDomain && (
                <View style={styles.previewBox}>
                  <Text style={styles.previewLabel}>YOUR PRIMARY ADDRESS</Text>
                  <Text style={styles.previewAddr}>{username}@{customDomain}</Text>
                  <Text style={styles.previewLabel}>FALLBACK (always yours)</Text>
                  <Text style={styles.previewFallback}>{username}-{customDomain.replace(/\./g, "-")}@w.xyz</Text>
                  <Text style={styles.previewHint}>
                    After signup you&apos;ll get DNS instructions to activate the custom domain. If you ever lose the domain, your @w.xyz fallback stays yours.
                  </Text>
                </View>
              )}
            </View>
          )}
          <View style={styles.statusRow} testID="username-status">
            {domainMode === "custom" ? (
              validCustomHandle
                ? <><Ionicons name="checkmark-circle" size={16} color={colors.success} /><Text style={[styles.statusText, { color: colors.success }]}>Looks good · {username.length}/26</Text></>
                : <Text style={styles.statusText}>1–26 characters · letters, numbers, dashes (you own the domain — no W limits)</Text>
            ) : usernameStatus.checking ? (
              <><ActivityIndicator size="small" color={colors.textMuted} /><Text style={styles.statusText}>Checking…</Text></>
            ) : usernameStatus.tier === "reserved" ? (
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                  <Ionicons name="lock-closed" size={14} color={colors.danger} />
                  <Text style={[styles.statusText, { color: colors.danger, fontWeight: "700" }]}>Reserved handle</Text>
                </View>
                <Text style={[styles.statusText, { marginTop: 2 }]}>
                  Email <Text style={{ color: colors.accent, fontWeight: "700" }}>support@w.xyz</Text> to request it — may require a premium subscription if released.
                </Text>
              </View>
            ) : usernameStatus.tier === "unavailable" ? (
              <><Ionicons name="close-circle" size={16} color={colors.danger} /><Text style={[styles.statusText, { color: colors.danger }]}>{usernameStatus.reason || "Not available"}</Text></>
            ) : usernameStatus.available === true && (usernameStatus.tier === "plus" || usernameStatus.tier === "pro") ? (
              <><Ionicons name="star" size={16} color="#E07B00" /><Text style={[styles.statusText, { color: "#E07B00" }]}>{usernameStatus.tier === "pro" ? "Pro" : "Plus"} handle — subscription required</Text></>
            ) : usernameStatus.available === true ? (
              <><Ionicons name="checkmark-circle" size={16} color={colors.success} /><Text style={[styles.statusText, { color: colors.success }]}>Available · {username.length}/26</Text></>
            ) : usernameStatus.available === false ? (
              <><Ionicons name="close-circle" size={16} color={colors.danger} /><Text style={[styles.statusText, { color: colors.danger }]}>{usernameStatus.reason || "Taken"}</Text></>
            ) : username.length > 0 && username.length < 4 ? (
              <Text style={styles.statusText}>Handles under 4 characters aren&apos;t available</Text>
            ) : (
              <Text style={styles.statusText}>6+ chars free · 4 needs Pro · 5 needs Plus · letters, numbers, dashes</Text>
            )}
          </View>

          {/* PHONE */}
          <Text style={styles.label}>Phone number</Text>
          <View style={styles.row}>
            <View style={styles.country}>
              <TextInput
                style={styles.countryInput}
                value={country}
                onChangeText={setCountry}
                maxLength={5}
                keyboardType="phone-pad"
                testID="phone-country-input"
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
                testID="phone-input"
              />
            </View>
          </View>
          <Text style={styles.hint}>We&apos;ll text you a 6-digit code to verify it&apos;s really you.</Text>

          {/* PASSWORD */}
          <Text style={styles.label}>Password</Text>
          <View style={styles.pwdBox}>
            <TextInput
              style={styles.pwdInput}
              value={password}
              onChangeText={setPassword}
              placeholder="At least 8 characters with a number/symbol"
              placeholderTextColor={colors.textMuted}
              secureTextEntry={!showPwd}
              autoCapitalize="none"
              autoCorrect={false}
              testID="signup-password-input"
            />
            <TouchableOpacity onPress={() => setShowPwd((v) => !v)} style={styles.eyeBtn} testID="toggle-pwd-visibility">
              <Ionicons name={showPwd ? "eye-off" : "eye"} size={20} color={colors.textMuted} />
            </TouchableOpacity>
          </View>
          <View style={styles.statusRow}>
            {password.length === 0 ? (
              <Text style={styles.statusText}>You&apos;ll use this to sign in next time</Text>
            ) : pwdStrong ? (
              <><Ionicons name="checkmark-circle" size={16} color={colors.success} /><Text style={[styles.statusText, { color: colors.success }]}>Strong password</Text></>
            ) : (
              <><Ionicons name="alert-circle" size={16} color={colors.danger} /><Text style={[styles.statusText, { color: colors.danger }]}>Need 8+ chars with a number or symbol</Text></>
            )}
          </View>

          {/* Sign-in link for returning users */}
          <TouchableOpacity
            style={styles.signinRow}
            onPress={() => router.push("/(auth)/signin")}
            testID="goto-signin-btn"
            activeOpacity={0.7}
          >
            <Text style={styles.signinText}>Already have an account? </Text>
            <Text style={styles.signinLink}>Sign in</Text>
          </TouchableOpacity>
        </ScrollView>
        <TouchableOpacity
          style={[styles.cta, (loading || !isValid) && { opacity: 0.5 }]}
          disabled={loading || !isValid}
          onPress={onContinue}
          testID="phone-continue-btn"
        >
          {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.ctaText}>Continue</Text>}
        </TouchableOpacity>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.surface },
  flex: { flex: 1, padding: space.xl },
  back: { width: 44, height: 44, alignItems: "center", justifyContent: "center", marginLeft: -8 },
  body: { paddingTop: space.lg, paddingBottom: space.xl },
  title: { fontSize: 26, fontWeight: "800", color: colors.text, letterSpacing: -0.5 },
  sub: { fontSize: 14, color: colors.textMuted, marginTop: 6, marginBottom: 18, lineHeight: 20 },
  label: { fontSize: 12, fontWeight: "800", color: colors.textMuted, letterSpacing: 1.2, textTransform: "uppercase", marginTop: 16, marginBottom: 8 },
  nameRow: { flexDirection: "row", gap: 10 },
  inputBox: { backgroundColor: colors.surface2, borderRadius: radius.lg, paddingHorizontal: 14 },
  input: { fontSize: 16, color: colors.text, paddingVertical: 14 },
  handleRow: { flexDirection: "row", alignItems: "center", backgroundColor: colors.surface2, borderRadius: radius.lg, paddingLeft: 14, paddingRight: 6 },
  handleInput: { flex: 1, fontSize: 16, color: colors.text, paddingVertical: 14, fontWeight: "600", minWidth: 0 },
  domain: { fontSize: 14, color: colors.accent, fontWeight: "700", marginRight: 4 },
  domainPicker: { flexDirection: "row", alignItems: "center", paddingHorizontal: 10, paddingVertical: 8, gap: 2 },
  customWrap: { marginTop: 14 },
  previewBox: { marginTop: 10, padding: 12, backgroundColor: "#EEF6F7", borderRadius: 10, borderLeftWidth: 3, borderLeftColor: colors.accent },
  previewLabel: { fontSize: 10, fontWeight: "800", color: colors.textMuted, letterSpacing: 1, marginBottom: 2, marginTop: 4 },
  previewAddr: { fontSize: 15, color: colors.text, fontWeight: "700", marginBottom: 4 },
  previewFallback: { fontSize: 13, color: colors.accent, fontWeight: "600" },
  previewHint: { fontSize: 11.5, color: colors.textMuted, marginTop: 8, lineHeight: 16 },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 6, minHeight: 18 },
  statusText: { fontSize: 12, color: colors.textMuted, fontWeight: "600" },
  row: { flexDirection: "row", gap: 10 },
  country: { backgroundColor: colors.surface2, borderRadius: radius.lg, paddingHorizontal: 10, justifyContent: "center", width: 72 },
  countryInput: { fontSize: 16, color: colors.text, fontWeight: "600", textAlign: "center" },
  phoneBox: { flex: 1, backgroundColor: colors.surface2, borderRadius: radius.lg, paddingHorizontal: 14 },
  phoneInput: { fontSize: 16, color: colors.text, paddingVertical: 14, fontWeight: "500" },
  hint: { color: colors.textMuted, fontSize: 12, marginTop: 10 },
  pwdBox: { flexDirection: "row", alignItems: "center", backgroundColor: colors.surface2, borderRadius: radius.lg, paddingLeft: 14, paddingRight: 6 },
  pwdInput: { flex: 1, fontSize: 16, color: colors.text, paddingVertical: 14, minWidth: 0 },
  eyeBtn: { padding: 10 },
  signinRow: { flexDirection: "row", justifyContent: "center", alignItems: "center", marginTop: 28, padding: 8 },
  signinText: { color: colors.textMuted, fontSize: 14 },
  signinLink: { color: colors.accent, fontSize: 14, fontWeight: "800" },
  cta: { backgroundColor: colors.primary, padding: 16, borderRadius: radius.xl, alignItems: "center" },
  ctaText: { color: "#fff", fontSize: 16, fontWeight: "700" },
});
