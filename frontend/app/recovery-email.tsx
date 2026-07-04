import React, { useState } from "react";
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity, ScrollView,
  KeyboardAvoidingView, Platform, ActivityIndicator, Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { api } from "../src/api";
import { useAuth } from "../src/auth";
import { colors, radius, space } from "../src/theme";
import { smartBack } from "../src/utils/nav";

type Step = "view" | "enter" | "verify";

export default function RecoveryEmailScreen() {
  const router = useRouter();
  const { user, setUser } = useAuth();

  const initial: Step = (user as any)?.recovery_email ? "view" : "enter";
  const [step, setStep] = useState<Step>(initial);
  const [email, setEmail] = useState<string>("");
  const [otp, setOtp] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);
  const [devOtp, setDevOtp] = useState<string | null>(null);

  const recoveryEmail = (user as any)?.recovery_email as string | undefined;

  const onSendCode = async () => {
    const em = email.trim().toLowerCase();
    if (!em.includes("@")) { Alert.alert("Enter a valid email"); return; }
    setBusy(true);
    try {
      const res = await api<{ sent: boolean; recovery_email_pending: string; dev_otp?: string }>("/auth/recovery-email/set", {
        method: "POST",
        body: JSON.stringify({ email: em }),
      });
      setPendingEmail(res.recovery_email_pending);
      setDevOtp(res.dev_otp || null);
      setStep("verify");
    } catch (e: any) { Alert.alert("Couldn't send code", e.message); }
    finally { setBusy(false); }
  };

  const onVerify = async () => {
    if (otp.length < 4) { Alert.alert("Enter the 6-digit code"); return; }
    setBusy(true);
    try {
      const res = await api<{ recovery_email: string; verified: boolean }>("/auth/recovery-email/verify", {
        method: "POST",
        body: JSON.stringify({ otp }),
      });
      if (user) setUser({ ...user, recovery_email: res.recovery_email, recovery_email_verified: true } as any);
      Alert.alert("Recovery email verified ✓", `${res.recovery_email} can now be used to reset your password.`);
      smartBack(router);
    } catch (e: any) { Alert.alert("Couldn't verify", e.message); }
    finally { setBusy(false); }
  };

  const onRemove = async () => {
    Alert.alert(
      "Remove recovery email?",
      "You won't be able to reset your password via email anymore.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove", style: "destructive", onPress: async () => {
            setBusy(true);
            try {
              await api("/auth/recovery-email", { method: "DELETE" });
              if (user) {
                const next = { ...user } as any;
                delete next.recovery_email;
                next.recovery_email_verified = false;
                setUser(next);
              }
              setStep("enter");
              setEmail("");
            } catch (e: any) { Alert.alert("Couldn't remove", e.message); }
            finally { setBusy(false); }
          }
        }
      ]
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => smartBack(router)} style={styles.iconBtn} testID="recovery-back">
            <Ionicons name="chevron-back" size={26} color={colors.text} />
          </TouchableOpacity>
          <Text style={styles.title}>Recovery email</Text>
          <View style={{ width: 40 }} />
        </View>

        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          {step === "view" && recoveryEmail && (
            <>
              <View style={styles.cardOk} testID="recovery-current">
                <View style={styles.iconWrap}>
                  <Ionicons name="shield-checkmark" size={26} color="#fff" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.cardLabel}>Verified</Text>
                  <Text style={styles.cardEmail} numberOfLines={1}>{recoveryEmail}</Text>
                </View>
              </View>
              <Text style={styles.hint}>
                If you forget your password, we&apos;ll email a 6-digit reset code to this address.
              </Text>
              <TouchableOpacity style={[styles.btn, styles.btnGhost]} onPress={() => { setEmail(recoveryEmail); setStep("enter"); }} testID="recovery-change">
                <Ionicons name="create-outline" size={18} color={colors.text} />
                <Text style={styles.btnGhostText}>Change email</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.btn, styles.btnDanger]} onPress={onRemove} disabled={busy} testID="recovery-remove">
                {busy ? <ActivityIndicator color="#fff" /> : <>
                  <Ionicons name="trash-outline" size={18} color="#fff" />
                  <Text style={styles.btnDangerText}>Remove recovery email</Text>
                </>}
              </TouchableOpacity>
            </>
          )}

          {step === "enter" && (
            <>
              <Text style={styles.hint}>
                Add an email you can access from any provider — Gmail, Outlook, iCloud, your own domain.
                We&apos;ll only use it to send you a reset code if you forget your password.
              </Text>
              <Text style={styles.label}>Recovery email</Text>
              <View style={styles.inputBox}>
                <Ionicons name="mail-outline" size={18} color={colors.textMuted} />
                <TextInput
                  style={styles.input}
                  value={email}
                  onChangeText={setEmail}
                  placeholder="you@gmail.com"
                  placeholderTextColor={colors.textMuted}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete="email"
                  testID="recovery-email-input"
                />
              </View>
              <TouchableOpacity style={[styles.btn, styles.btnPrimary, (!email || busy) && { opacity: 0.5 }]} onPress={onSendCode} disabled={!email || busy} testID="recovery-send-code">
                {busy ? <ActivityIndicator color="#fff" /> : <>
                  <Ionicons name="send" size={18} color="#fff" />
                  <Text style={styles.btnPrimaryText}>Send verification code</Text>
                </>}
              </TouchableOpacity>
            </>
          )}

          {step === "verify" && (
            <>
              <Text style={styles.hint}>
                We sent a 6-digit code to <Text style={styles.email}>{pendingEmail}</Text>. Open that inbox and paste the code below.
              </Text>
              {devOtp && (
                <View style={styles.devOtpCard} testID="recovery-dev-otp">
                  <Ionicons name="information-circle" size={18} color={colors.accent} />
                  <Text style={styles.devOtpLabel}>Dev mode</Text>
                  <Text style={styles.devOtpCode}>{devOtp}</Text>
                  <TouchableOpacity onPress={() => setOtp(devOtp)} style={styles.autofill} testID="autofill-otp"><Text style={styles.autofillText}>Autofill</Text></TouchableOpacity>
                </View>
              )}
              <Text style={styles.label}>Verification code</Text>
              <View style={styles.inputBox}>
                <Ionicons name="key-outline" size={18} color={colors.textMuted} />
                <TextInput
                  style={[styles.input, { letterSpacing: 6, fontWeight: "800", textAlign: "center" }]}
                  value={otp}
                  onChangeText={(t) => setOtp(t.replace(/[^0-9]/g, "").slice(0, 6))}
                  placeholder="000000"
                  placeholderTextColor={colors.textMuted}
                  keyboardType="number-pad"
                  maxLength={6}
                  testID="recovery-otp-input"
                />
              </View>
              <TouchableOpacity style={[styles.btn, styles.btnPrimary, (otp.length < 6 || busy) && { opacity: 0.5 }]} onPress={onVerify} disabled={otp.length < 6 || busy} testID="recovery-verify-btn">
                {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnPrimaryText}>Verify</Text>}
              </TouchableOpacity>
              <TouchableOpacity onPress={() => { setStep("enter"); setOtp(""); setDevOtp(null); }} style={styles.linkBtn} testID="recovery-change-link">
                <Text style={styles.linkText}>Wrong email? Change it</Text>
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
  header: { flexDirection: "row", alignItems: "center", padding: space.md, gap: 8, borderBottomWidth: 1, borderBottomColor: colors.border },
  iconBtn: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  title: { flex: 1, fontSize: 18, fontWeight: "800", color: colors.text },
  scroll: { padding: space.lg, gap: 14 },
  hint: { color: colors.textMuted, fontSize: 14, lineHeight: 20 },
  email: { color: colors.accent, fontWeight: "700" },
  label: { fontSize: 12, color: colors.textMuted, fontWeight: "700", marginTop: 4 },
  inputBox: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: colors.surface2, borderRadius: radius.lg, paddingHorizontal: 14 },
  input: { flex: 1, fontSize: 16, color: colors.text, paddingVertical: 14, fontWeight: "500" },
  btn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, padding: 14, borderRadius: radius.xl, marginTop: 6 },
  btnPrimary: { backgroundColor: colors.primary },
  btnPrimaryText: { color: "#fff", fontWeight: "800", fontSize: 15 },
  btnGhost: { backgroundColor: colors.surface2 },
  btnGhostText: { color: colors.text, fontWeight: "700", fontSize: 15 },
  btnDanger: { borderWidth: 1, borderColor: colors.danger, backgroundColor: colors.danger },
  btnDangerText: { color: "#fff", fontWeight: "800", fontSize: 15 },
  cardOk: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: colors.primary, padding: 16, borderRadius: radius.xl },
  iconWrap: { width: 44, height: 44, borderRadius: 22, backgroundColor: "rgba(255,255,255,0.15)", alignItems: "center", justifyContent: "center" },
  cardLabel: { color: "#A9D5DE", fontSize: 12, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5 },
  cardEmail: { color: "#fff", fontSize: 16, fontWeight: "800", marginTop: 2 },
  linkBtn: { padding: 12, alignItems: "center" },
  linkText: { color: colors.accent, fontWeight: "700" },
  devOtpCard: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#E8F5F7", padding: 12, borderRadius: radius.lg },
  devOtpLabel: { color: colors.accent, fontWeight: "700", fontSize: 12 },
  devOtpCode: { flex: 1, color: colors.text, fontWeight: "800", fontSize: 16, letterSpacing: 3 },
  autofill: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 12, backgroundColor: colors.accent },
  autofillText: { color: "#fff", fontWeight: "700", fontSize: 12 },
});
