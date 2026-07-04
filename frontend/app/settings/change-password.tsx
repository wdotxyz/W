import React, { useMemo, useState } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView, TextInput, Alert,
  Platform, KeyboardAvoidingView, ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { api } from "../../src/api";
import { colors, radius, space } from "../../src/theme";
import { smartBack } from "../../src/utils/nav";

type Strength = { score: number; label: string; color: string };

function scorePassword(p: string): Strength {
  let s = 0;
  if (p.length >= 8) s++;
  if (p.length >= 12) s++;
  if (/[A-Z]/.test(p) && /[a-z]/.test(p)) s++;
  if (/\d/.test(p)) s++;
  if (/[^A-Za-z0-9]/.test(p)) s++;
  const labels = ["Too short", "Weak", "Okay", "Good", "Strong", "Excellent"];
  const cols = [colors.danger, colors.danger, "#E08A2D", "#C0A018", colors.primary, colors.accent];
  return { score: s, label: labels[s], color: cols[s] };
}

export default function ChangePasswordScreen() {
  const router = useRouter();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showA, setShowA] = useState(false);
  const [showB, setShowB] = useState(false);
  const [showC, setShowC] = useState(false);
  const [busy, setBusy] = useState(false);

  const strength = useMemo(() => scorePassword(next), [next]);
  const ready =
    current.length >= 1 &&
    next.length >= 8 &&
    confirm === next &&
    next !== current &&
    !busy;

  const submit = async () => {
    if (!ready) return;
    setBusy(true);
    try {
      await api("/auth/set-password", {
        method: "POST",
        body: JSON.stringify({ current_password: current, password: next }),
      });
      Alert.alert(
        "Password updated",
        "Your password has been changed. Use the new password the next time you sign in.",
        [{ text: "Done", onPress: () => smartBack(router) }],
      );
      setCurrent("");
      setNext("");
      setConfirm("");
    } catch (e: any) {
      const msg = (e?.message || "").toLowerCase();
      if (msg.includes("current password")) {
        Alert.alert("Wrong current password", "The current password you entered doesn't match what's on file.");
      } else {
        Alert.alert("Couldn't update password", e?.message || "Please try again.");
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => smartBack(router)} style={styles.iconBtn} testID="cp-back">
          <Ionicons name="chevron-back" size={26} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.title}>Change password</Text>
        <View style={{ width: 40 }} />
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <View style={styles.hero}>
            <View style={styles.iconWrap}><Ionicons name="lock-closed" size={28} color={colors.accent} /></View>
            <Text style={styles.heroTitle}>Keep your account safe</Text>
            <Text style={styles.heroBody}>
              Pick a password you don't use anywhere else. We recommend at least 12 characters with a mix of letters, numbers and symbols.
            </Text>
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>Current password</Text>
            <View style={styles.input}>
              <Ionicons name="lock-closed-outline" size={18} color={colors.textMuted} />
              <TextInput
                style={styles.inputText}
                value={current}
                onChangeText={setCurrent}
                placeholder="Enter your current password"
                placeholderTextColor={colors.textMuted}
                secureTextEntry={!showA}
                autoCapitalize="none"
                autoCorrect={false}
                testID="cp-current"
              />
              <TouchableOpacity onPress={() => setShowA((v) => !v)} style={styles.eyeBtn}>
                <Ionicons name={showA ? "eye-off" : "eye"} size={20} color={colors.textMuted} />
              </TouchableOpacity>
            </View>
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>New password</Text>
            <View style={styles.input}>
              <Ionicons name="key-outline" size={18} color={colors.accent} />
              <TextInput
                style={styles.inputText}
                value={next}
                onChangeText={setNext}
                placeholder="At least 8 characters"
                placeholderTextColor={colors.textMuted}
                secureTextEntry={!showB}
                autoCapitalize="none"
                autoCorrect={false}
                testID="cp-new"
              />
              <TouchableOpacity onPress={() => setShowB((v) => !v)} style={styles.eyeBtn}>
                <Ionicons name={showB ? "eye-off" : "eye"} size={20} color={colors.textMuted} />
              </TouchableOpacity>
            </View>
            {next.length > 0 && (
              <View style={styles.strengthRow}>
                <View style={styles.strengthTrack}>
                  <View style={[styles.strengthFill, { width: `${Math.min(100, (strength.score / 5) * 100)}%`, backgroundColor: strength.color }]} />
                </View>
                <Text style={[styles.strengthLabel, { color: strength.color }]}>{strength.label}</Text>
              </View>
            )}
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>Confirm new password</Text>
            <View style={styles.input}>
              <Ionicons name="checkmark-circle-outline" size={18} color={confirm.length > 0 && confirm === next ? colors.accent : colors.textMuted} />
              <TextInput
                style={styles.inputText}
                value={confirm}
                onChangeText={setConfirm}
                placeholder="Re-enter your new password"
                placeholderTextColor={colors.textMuted}
                secureTextEntry={!showC}
                autoCapitalize="none"
                autoCorrect={false}
                testID="cp-confirm"
              />
              <TouchableOpacity onPress={() => setShowC((v) => !v)} style={styles.eyeBtn} testID="cp-confirm-eye">
                <Ionicons name={showC ? "eye-off" : "eye"} size={20} color={colors.textMuted} />
              </TouchableOpacity>
            </View>
            {confirm.length > 0 && confirm !== next && (
              <Text style={styles.warn}>Passwords don't match yet.</Text>
            )}
          </View>

          <TouchableOpacity
            onPress={submit}
            disabled={!ready}
            activeOpacity={0.85}
            style={[styles.cta, !ready && { opacity: 0.5 }]}
            testID="cp-submit"
          >
            {busy ? <ActivityIndicator color="#fff" /> : (
              <>
                <Ionicons name="shield-checkmark" size={18} color="#fff" />
                <Text style={styles.ctaText}>Update password</Text>
              </>
            )}
          </TouchableOpacity>
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
  scroll: { padding: space.xl, gap: 16, paddingBottom: 40 },
  hero: { backgroundColor: colors.surface2, borderRadius: radius.xl, padding: 18, alignItems: "center" },
  iconWrap: { width: 56, height: 56, borderRadius: 28, backgroundColor: "#E8F5F7", alignItems: "center", justifyContent: "center", marginBottom: 10 },
  heroTitle: { fontSize: 17, fontWeight: "800", color: colors.text, textAlign: "center" },
  heroBody: { fontSize: 13, color: colors.textMuted, textAlign: "center", lineHeight: 18, marginTop: 4 },
  field: { gap: 8 },
  label: { fontSize: 12, color: colors.textMuted, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.5 },
  input: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: colors.surface2, paddingLeft: 14, paddingRight: 12, paddingVertical: Platform.OS === "ios" ? 14 : 6, borderRadius: radius.lg, borderWidth: 1.5, borderColor: "#D6E5EA" },
  inputText: { flex: 1, fontSize: 16, color: colors.text, fontWeight: "600" },
  eyeBtn: { padding: 6, marginRight: 4 },
  strengthRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  strengthTrack: { flex: 1, height: 6, backgroundColor: "#E8E8E8", borderRadius: 4, overflow: "hidden" },
  strengthFill: { height: "100%", borderRadius: 4 },
  strengthLabel: { fontSize: 12, fontWeight: "800", minWidth: 70, textAlign: "right" },
  warn: { color: colors.danger, fontSize: 12, fontWeight: "600" },
  cta: { backgroundColor: colors.primary, borderRadius: radius.xl, paddingVertical: 14, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, marginTop: 4 },
  ctaText: { color: "#fff", fontSize: 15, fontWeight: "800" },
});
