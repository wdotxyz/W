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
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [usernameStatus, setUsernameStatus] = useState<{ available?: boolean; reason?: string; checking?: boolean }>({});
  const [phone, setPhone] = useState("");
  const [country, setCountry] = useState("+1");
  const [loading, setLoading] = useState(false);

  // Debounced username availability check
  useEffect(() => {
    if (username.length < 3) { setUsernameStatus({}); return; }
    setUsernameStatus({ checking: true });
    const t = setTimeout(async () => {
      try {
        const res = await api<any>(`/mail/check-handle/${encodeURIComponent(username)}`);
        setUsernameStatus({ available: res.available, reason: res.reason });
      } catch { setUsernameStatus({}); }
    }, 350);
    return () => clearTimeout(t);
  }, [username]);

  const isValid = name.trim().length >= 2 && phone.length >= 6 && usernameStatus.available === true;

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
        params: { phone: full, devOtp: res.dev_otp, name: name.trim(), username: username.trim() },
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
          <Text style={styles.sub}>Tell us who you are and pick a unique @w.xyz username.</Text>

          {/* NAME */}
          <Text style={styles.label}>Name</Text>
          <View style={styles.inputBox}>
            <TextInput
              style={styles.input}
              placeholder="Your full name"
              placeholderTextColor={colors.textMuted}
              value={name}
              onChangeText={setName}
              autoCapitalize="words"
              maxLength={40}
              testID="signup-name-input"
            />
          </View>

          {/* USERNAME with availability */}
          <Text style={styles.label}>Username</Text>
          <View style={styles.handleRow}>
            <TextInput
              style={styles.handleInput}
              placeholder="yourhandle"
              placeholderTextColor={colors.textMuted}
              value={username}
              onChangeText={(t) => setUsername(t.toLowerCase().replace(/[^a-z0-9._-]/g, "").slice(0, 32))}
              autoCapitalize="none"
              autoCorrect={false}
              testID="signup-username-input"
            />
            <Text style={styles.domain}>@w.xyz</Text>
          </View>
          <View style={styles.statusRow} testID="username-status">
            {usernameStatus.checking ? (
              <><ActivityIndicator size="small" color={colors.textMuted} /><Text style={styles.statusText}>Checking…</Text></>
            ) : usernameStatus.available === true ? (
              <><Ionicons name="checkmark-circle" size={16} color={colors.success} /><Text style={[styles.statusText, { color: colors.success }]}>Available</Text></>
            ) : usernameStatus.available === false ? (
              <><Ionicons name="close-circle" size={16} color={colors.danger} /><Text style={[styles.statusText, { color: colors.danger }]}>{usernameStatus.reason || "Taken"}</Text></>
            ) : username.length > 0 && username.length < 3 ? (
              <Text style={styles.statusText}>At least 3 characters</Text>
            ) : (
              <Text style={styles.statusText}>3–32 characters, letters/numbers/._-</Text>
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
          <Text style={styles.hint}>Dev mode: OTP will be shown on the next screen.</Text>
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
  inputBox: { backgroundColor: colors.surface2, borderRadius: radius.lg, paddingHorizontal: 14 },
  input: { fontSize: 16, color: colors.text, paddingVertical: 14 },
  handleRow: { flexDirection: "row", alignItems: "center", backgroundColor: colors.surface2, borderRadius: radius.lg, paddingHorizontal: 14 },
  handleInput: { flex: 1, fontSize: 16, color: colors.text, paddingVertical: 14, fontWeight: "600" },
  domain: { fontSize: 15, color: colors.accent, fontWeight: "700" },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 6, minHeight: 18 },
  statusText: { fontSize: 12, color: colors.textMuted, fontWeight: "600" },
  row: { flexDirection: "row", gap: 10 },
  country: { backgroundColor: colors.surface2, borderRadius: radius.lg, paddingHorizontal: 10, justifyContent: "center", width: 72 },
  countryInput: { fontSize: 16, color: colors.text, fontWeight: "600", textAlign: "center" },
  phoneBox: { flex: 1, backgroundColor: colors.surface2, borderRadius: radius.lg, paddingHorizontal: 14 },
  phoneInput: { fontSize: 16, color: colors.text, paddingVertical: 14, fontWeight: "500" },
  hint: { color: colors.textMuted, fontSize: 12, marginTop: 10 },
  cta: { backgroundColor: colors.primary, padding: 16, borderRadius: radius.xl, alignItems: "center" },
  ctaText: { color: "#fff", fontSize: 16, fontWeight: "700" },
});
