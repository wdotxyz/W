import React, { useState } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView, TextInput, Switch,
  Alert, ActivityIndicator, KeyboardAvoidingView, Platform, Modal,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "../src/auth";
import { api } from "../src/api";
import { colors, radius, space } from "../src/theme";

type Step = "idle" | "password" | "otp";

export default function TwoFactorSettingsScreen() {
  const router = useRouter();
  const { user, setUser } = useAuth();
  const enabled = !!user?.two_factor_enabled;

  const [step, setStep] = useState<Step>("idle");
  const [intent, setIntent] = useState<"enable" | "disable">("enable");
  const [password, setPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [busy, setBusy] = useState(false);
  const [phoneMasked, setPhoneMasked] = useState("");
  const [devOtp, setDevOtp] = useState("");

  const reset = () => {
    setStep("idle"); setPassword(""); setOtp(""); setDevOtp(""); setPhoneMasked("");
  };

  const openModal = (want: "enable" | "disable") => {
    if (want === enabled || (want === "enable" && enabled) || (want === "disable" && !enabled)) return;
    setIntent(want); setStep("password");
  };

  const onSubmitPassword = async () => {
    if (password.length < 1) return;
    setBusy(true);
    try {
      const res: any = await api("/auth/2fa", {
        method: "POST",
        body: JSON.stringify({ enable: intent === "enable", password }),
      });
      if (intent === "enable") {
        // Enabled immediately, no OTP gate
        setUser({ ...(user || {}), two_factor_enabled: true });
        Alert.alert("Two-step verification ON", "You'll be asked for a code from your phone each time you sign in.");
        reset();
      } else {
        // Backend asks for OTP step
        if (res?.requires_otp) {
          setPhoneMasked(res.phone_masked || "");
          setDevOtp(res.dev_otp || "");
          setStep("otp");
        } else {
          setUser({ ...(user || {}), two_factor_enabled: false });
          reset();
        }
      }
    } catch (e: any) {
      Alert.alert("Couldn't update", e?.message || "Please check your password and try again.");
    } finally { setBusy(false); }
  };

  const onSubmitOtp = async () => {
    if (otp.length !== 6) return;
    setBusy(true);
    try {
      await api("/auth/2fa", {
        method: "POST",
        body: JSON.stringify({ enable: false, password, otp }),
      });
      setUser({ ...(user || {}), two_factor_enabled: false });
      Alert.alert("Two-step verification OFF", "You'll only need your password to sign in.");
      reset();
    } catch (e: any) {
      Alert.alert("Wrong code", "The verification code is incorrect or expired.");
    } finally { setBusy(false); }
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.back} testID="tfa-settings-back">
          <Ionicons name="chevron-back" size={26} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Two-step verification</Text>
        <View style={styles.back} />
      </View>

      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        <View style={styles.heroIcon}>
          <Ionicons name="shield-checkmark" size={36} color={colors.accent} />
        </View>
        <Text style={styles.title}>{enabled ? "On" : "Off"}</Text>
        <Text style={styles.sub}>
          {enabled
            ? "When you sign in we'll text a 6-digit code to your phone before letting you in. Even if someone gets your password, they can't access your account without the code."
            : "Protect your account with an extra step at sign in. We'll text a 6-digit code to your phone after you enter your password."}
        </Text>

        <View style={styles.card}>
          <View style={{ flex: 1 }}>
            <Text style={styles.rowLabel}>Require a phone code at sign in</Text>
            <Text style={styles.rowHint}>Sends to {user?.phone || "your phone on file"}</Text>
          </View>
          <Switch
            value={enabled}
            onValueChange={(v) => openModal(v ? "enable" : "disable")}
            trackColor={{ false: "#D1D9E0", true: colors.accent }}
            thumbColor="#fff"
            ios_backgroundColor="#D1D9E0"
            testID="tfa-toggle-switch"
          />
        </View>

        <Text style={styles.fineprint}>
          You can turn this on or off anytime. We&apos;ll always confirm the change with your password.
        </Text>
      </ScrollView>

      {/* Step 1: password */}
      <Modal visible={step === "password"} transparent animationType="fade" onRequestClose={reset}>
        <KeyboardAvoidingView style={styles.backdrop} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <View style={styles.modal} testID="tfa-password-modal">
            <View style={[styles.modalIcon, { backgroundColor: "#E8F5F7" }]}>
              <Ionicons name="lock-closed" size={26} color={colors.accent} />
            </View>
            <Text style={styles.modalTitle}>{intent === "enable" ? "Turn on" : "Turn off"} 2-step verification</Text>
            <Text style={styles.modalBody}>Enter your password to confirm.</Text>
            <TextInput
              style={styles.modalInput}
              value={password}
              onChangeText={setPassword}
              placeholder="Password"
              placeholderTextColor={colors.textMuted}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              testID="tfa-password-input"
            />
            <View style={styles.row}>
              <TouchableOpacity style={[styles.btn, styles.btnGhost]} onPress={reset} disabled={busy}><Text style={styles.btnGhostText}>Cancel</Text></TouchableOpacity>
              <TouchableOpacity
                style={[styles.btn, styles.btnPrimary, (password.length < 1 || busy) && { opacity: 0.5 }]}
                onPress={onSubmitPassword}
                disabled={password.length < 1 || busy}
                testID="tfa-password-submit"
              >
                {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnPrimaryText}>Continue</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Step 2: OTP (only on disable) */}
      <Modal visible={step === "otp"} transparent animationType="fade" onRequestClose={reset}>
        <KeyboardAvoidingView style={styles.backdrop} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <View style={styles.modal} testID="tfa-otp-modal">
            <View style={[styles.modalIcon, { backgroundColor: "#FFF3E0" }]}>
              <Ionicons name="keypad" size={26} color="#E07B00" />
            </View>
            <Text style={styles.modalTitle}>Enter your code</Text>
            <Text style={styles.modalBody}>
              We sent a code to <Text style={{ fontWeight: "700", color: colors.text }}>{phoneMasked || "your phone"}</Text>.
            </Text>
            {!!devOtp && (
              <View style={styles.devHint}>
                <Ionicons name="information-circle" size={14} color={colors.accent} />
                <Text style={styles.devHintText}>Dev OTP: <Text style={{ fontWeight: "800" }}>{devOtp}</Text></Text>
              </View>
            )}
            <TextInput
              style={[styles.modalInput, { letterSpacing: 8, textAlign: "center", fontWeight: "700" }]}
              value={otp}
              onChangeText={(t) => setOtp(t.replace(/\D/g, "").slice(0, 6))}
              placeholder="••••••"
              placeholderTextColor={colors.textMuted}
              keyboardType="number-pad"
              autoFocus
              maxLength={6}
              testID="tfa-otp-input"
            />
            <View style={styles.row}>
              <TouchableOpacity style={[styles.btn, styles.btnGhost]} onPress={reset} disabled={busy}><Text style={styles.btnGhostText}>Cancel</Text></TouchableOpacity>
              <TouchableOpacity
                style={[styles.btn, styles.btnDanger, (otp.length !== 6 || busy) && { opacity: 0.5 }]}
                onPress={onSubmitOtp}
                disabled={otp.length !== 6 || busy}
                testID="tfa-otp-submit"
              >
                {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnDangerText}>Turn off</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 8, paddingVertical: 6, borderBottomWidth: 0.5, borderBottomColor: colors.border },
  back: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  headerTitle: { flex: 1, textAlign: "center", fontSize: 16, fontWeight: "700", color: colors.text },

  body: { padding: space.xl, alignItems: "stretch" },
  heroIcon: { width: 64, height: 64, borderRadius: 32, backgroundColor: "#E8F5F7", alignItems: "center", justifyContent: "center", alignSelf: "center", marginTop: 12 },
  title: { fontSize: 26, fontWeight: "800", color: colors.text, textAlign: "center", marginTop: 14, letterSpacing: -0.5 },
  sub: { fontSize: 14.5, color: colors.textMuted, lineHeight: 22, textAlign: "center", marginTop: 8, marginHorizontal: 6 },
  card: { flexDirection: "row", alignItems: "center", marginTop: 26, padding: 16, backgroundColor: colors.surface2, borderRadius: radius.xl, gap: 12 },
  rowLabel: { fontSize: 15, color: colors.text, fontWeight: "700" },
  rowHint: { fontSize: 12.5, color: colors.textMuted, marginTop: 2 },
  fineprint: { textAlign: "center", color: colors.textMuted, fontSize: 12, marginTop: 16, marginHorizontal: 6 },

  backdrop: { flex: 1, backgroundColor: "rgba(6,21,43,0.55)", alignItems: "center", justifyContent: "center", padding: 24 },
  modal: { backgroundColor: colors.surface, borderRadius: 18, padding: 22, width: "100%", maxWidth: 420 },
  modalIcon: { width: 52, height: 52, borderRadius: 26, alignItems: "center", justifyContent: "center", marginBottom: 12, alignSelf: "center" },
  modalTitle: { fontSize: 19, fontWeight: "800", color: colors.text, textAlign: "center" },
  modalBody: { fontSize: 14, color: colors.textMuted, textAlign: "center", marginTop: 6, marginBottom: 16, lineHeight: 20 },
  modalInput: { backgroundColor: colors.surface2, borderRadius: radius.lg, padding: 14, fontSize: 16, color: colors.text, fontWeight: "500" },
  row: { flexDirection: "row", gap: 10, marginTop: 16 },
  btn: { flex: 1, padding: 14, borderRadius: radius.xl, alignItems: "center", justifyContent: "center" },
  btnGhost: { backgroundColor: colors.surface2 },
  btnGhostText: { color: colors.text, fontWeight: "700", fontSize: 15 },
  btnPrimary: { backgroundColor: colors.primary },
  btnPrimaryText: { color: "#fff", fontWeight: "800", fontSize: 15 },
  btnDanger: { backgroundColor: colors.danger },
  btnDangerText: { color: "#fff", fontWeight: "800", fontSize: 15 },
  devHint: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4, backgroundColor: "#E8F5F7", padding: 8, borderRadius: 8, marginBottom: 10 },
  devHintText: { fontSize: 12, color: colors.text },
});
