import React, { useState } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView, Alert,
  TextInput, ActivityIndicator, Pressable, Platform, KeyboardAvoidingView,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "../../src/auth";
import { api } from "../../src/api";
import { colors, radius, space } from "../../src/theme";

type Step = "closed" | "choose" | "confirmDelete";

export default function AccountSettingsScreen() {
  const router = useRouter();
  const { user, signOut } = useAuth();
  const [step, setStep] = useState<Step>("closed");
  const [confirmText, setConfirmText] = useState("");
  const [busy, setBusy] = useState(false);

  const openDeactivateChooser = () => { if (!busy) { setConfirmText(""); setStep("choose"); } };

  const close = () => { if (!busy) { setStep("closed"); setConfirmText(""); } };

  const onDeactivate = async () => {
    setBusy(true);
    try {
      await api("/auth/deactivate", { method: "POST" });
      try { await signOut(); } catch {}
      setStep("closed");
      router.replace("/(auth)/signin");
    } catch (e: any) { Alert.alert("Couldn't deactivate", e.message || "Please try again."); }
    finally { setBusy(false); }
  };

  const onDeleteForever = async () => {
    if (confirmText.trim().toUpperCase() !== "DELETE") return;
    setBusy(true);
    try {
      await api("/auth/me", { method: "DELETE" });
      try { await signOut(); } catch {}
      setStep("closed");
      router.replace("/(auth)/signin");
    } catch (e: any) { Alert.alert("Couldn't delete", e.message || "Please try again."); }
    finally { setBusy(false); }
  };

  const Row = ({ icon, label, hint, onPress, testID, tone }: any) => {
    const danger = tone === "danger";
    return (
      <TouchableOpacity onPress={onPress} activeOpacity={0.6} style={styles.rowItem} testID={testID}>
        <View style={[styles.rowIcon, danger && { backgroundColor: "#FDECEC" }]}><Ionicons name={icon} size={18} color={danger ? colors.danger : colors.accent} /></View>
        <Text style={[styles.rowLabel, danger && { color: colors.danger }]}>{label}</Text>
        {!!hint && <Text style={styles.rowHint}>{hint}</Text>}
        <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn} testID="account-back">
          <Ionicons name="chevron-back" size={26} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.title}>Account</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.group}>
          <Row icon="shield-checkmark" label="Two-step verification" onPress={() => router.push("/two-factor-settings")} testID="row-2fa" />
          <Row icon="lock-closed" label="Change password" onPress={() => router.push("/settings/change-password")} testID="row-change-password" />
          <Row icon="call" label="Change phone number" onPress={() => router.push("/settings/change-phone")} testID="row-change-phone" />
          <Row icon="information-circle" label="About W" onPress={() => router.push("/about")} testID="row-about" />
          {(user as any)?.is_support ? (
            <Row icon="stats-chart" label="App Stats" onPress={() => router.push("/admin/stats")} testID="row-app-stats" />
          ) : null}
          <Row icon="pause-circle-outline" label="Deactivate account" onPress={openDeactivateChooser} testID="row-deactivate" />
        </View>

        <TouchableOpacity onPress={signOut} style={styles.signOut} testID="signout-btn" activeOpacity={0.75}>
          <Ionicons name="log-out-outline" size={20} color={colors.danger} />
          <Text style={styles.signOutText}>Sign out</Text>
        </TouchableOpacity>
      </ScrollView>

      {/* CHOOSER OVERLAY — inline (no RN Modal so it never freezes on web) */}
      {step === "choose" && (
        <Pressable style={styles.backdrop} onPress={close} testID="deactivate-overlay">
          <Pressable style={styles.card} onPress={(e) => e.stopPropagation()} testID="deactivate-modal">
            <View style={styles.cardHeader}>
              <TouchableOpacity onPress={close} disabled={busy} style={styles.cardBack} testID="deactivate-back-btn" activeOpacity={0.7}>
                <Ionicons name="chevron-back" size={22} color={colors.text} />
              </TouchableOpacity>
              <Text style={styles.cardHeaderTitle}>Deactivate account</Text>
              <View style={{ width: 32 }} />
            </View>

            <TouchableOpacity style={[styles.optionCard, styles.optionPause]} onPress={onDeactivate} disabled={busy} activeOpacity={0.85} testID="option-deactivate">
              <View style={[styles.optionIcon, { backgroundColor: "#FFF3E0" }]}><Ionicons name="time-outline" size={20} color="#E07B00" /></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.optionTitle}>Pause my account</Text>
                <Text style={styles.optionSub}>Sign back in anytime to reactivate.</Text>
              </View>
              {busy ? <ActivityIndicator color={colors.text} /> : <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />}
            </TouchableOpacity>

            <TouchableOpacity style={[styles.optionCard, styles.optionDelete]} onPress={() => setStep("confirmDelete")} disabled={busy} activeOpacity={0.85} testID="option-delete">
              <View style={[styles.optionIcon, { backgroundColor: "#FDECEC" }]}><Ionicons name="trash-outline" size={20} color={colors.danger} /></View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.optionTitle, { color: colors.danger }]}>Delete forever</Text>
                <Text style={styles.optionSub}>Erase everything. Cannot be undone.</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.danger} />
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      )}

      {/* CONFIRM DELETE OVERLAY */}
      {step === "confirmDelete" && (
        <KeyboardAvoidingView style={styles.backdrop} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => !busy && setStep("choose")} />
          <Pressable style={styles.card} onPress={(e) => e.stopPropagation()} testID="delete-modal">
            <View style={[styles.iconWrap, { backgroundColor: "#FDECEC" }]}><Ionicons name="warning" size={28} color={colors.danger} /></View>
            <Text style={styles.cardTitle}>Delete forever?</Text>
            <Text style={styles.cardBody}>We&apos;ll erase {user?.email_address || "your @w.xyz address"}, your chats, voice notes, statuses, drafts and every email. This action cannot be undone.</Text>
            <Text style={styles.deleteLabel}>Type <Text style={styles.deleteWord}>DELETE</Text> to confirm</Text>
            <TextInput style={styles.deleteInput} value={confirmText} onChangeText={setConfirmText} autoCapitalize="characters" autoCorrect={false} placeholder="DELETE" placeholderTextColor={colors.textMuted} editable={!busy} testID="delete-confirm-input" />
            <View style={styles.row}>
              <TouchableOpacity style={[styles.btn, styles.btnGhost]} onPress={() => setStep("choose")} disabled={busy} testID="delete-back-btn" activeOpacity={0.7}>
                <Text style={styles.btnGhostText}>Back</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.btn, styles.btnDanger, (confirmText.trim().toUpperCase() !== "DELETE" || busy) && { opacity: 0.5 }]} onPress={onDeleteForever} disabled={confirmText.trim().toUpperCase() !== "DELETE" || busy} testID="delete-confirm-btn" activeOpacity={0.85}>
                {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnDangerText}>Delete forever</Text>}
              </TouchableOpacity>
            </View>
          </Pressable>
        </KeyboardAvoidingView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: "row", alignItems: "center", padding: space.md, gap: 8, borderBottomWidth: 1, borderBottomColor: colors.border },
  iconBtn: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  title: { flex: 1, fontSize: 18, fontWeight: "800", color: colors.text },
  scroll: { padding: space.xl, gap: 14 },
  intro: { fontSize: 13.5, color: colors.textMuted, lineHeight: 19 },
  group: { backgroundColor: colors.surface2, borderRadius: radius.xl, overflow: "hidden" },
  cardHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 14, marginTop: -4 },
  cardBack: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center", marginLeft: -4 },
  cardHeaderTitle: { fontSize: 17, fontWeight: "800", color: colors.text, letterSpacing: -0.2 },
  signOut: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: colors.surface2, borderRadius: radius.xl, paddingVertical: 14, marginTop: 6 },
  signOutText: { color: colors.danger, fontWeight: "700", fontSize: 15 },
  rowItem: { flexDirection: "row", alignItems: "center", padding: 14, borderBottomWidth: 1, borderBottomColor: colors.border, gap: 12 },
  rowIcon: { width: 36, height: 36, borderRadius: 18, backgroundColor: "#E8F5F7", alignItems: "center", justifyContent: "center" },
  rowLabel: { flex: 1, fontSize: 15, color: colors.text, fontWeight: "600" },
  rowHint: { fontSize: 13, color: colors.textMuted, marginRight: 6 },
  backdrop: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(6,21,43,0.55)", alignItems: "center", justifyContent: "center", padding: 24, zIndex: 100 },
  card: { backgroundColor: colors.surface, borderRadius: 20, padding: 22, width: "100%", maxWidth: 440 },
  iconWrap: { width: 56, height: 56, borderRadius: 28, backgroundColor: "#FFF3E0", alignItems: "center", justifyContent: "center", marginBottom: 12, alignSelf: "center" },
  cardTitle: { fontSize: 20, fontWeight: "800", color: colors.text, textAlign: "center", letterSpacing: -0.3 },
  cardBody: { fontSize: 14, color: colors.textMuted, lineHeight: 21, textAlign: "center", marginTop: 8, marginBottom: 18 },
  optionCard: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: colors.surface2, borderRadius: radius.xl, padding: 14, marginTop: 10, borderWidth: 1.5 },
  optionPause: { borderColor: "#FFE0B2" },
  optionDelete: { borderColor: "#FDDADA" },
  optionIcon: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  optionTitle: { fontSize: 15, fontWeight: "800", color: colors.text },
  optionSub: { fontSize: 12.5, color: colors.textMuted, lineHeight: 18, marginTop: 2 },
  cardCancel: { alignItems: "center", justifyContent: "center", padding: 14, marginTop: 8 },
  cardCancelText: { color: colors.text, fontWeight: "700", fontSize: 15 },
  deleteLabel: { fontSize: 12, color: colors.textMuted, fontWeight: "700", marginTop: 4, marginBottom: 6, textAlign: "center" },
  deleteWord: { color: colors.danger, fontWeight: "800" },
  deleteInput: { backgroundColor: colors.surface2, borderRadius: radius.lg, padding: 14, fontSize: 16, color: colors.text, fontWeight: "700", textAlign: "center", letterSpacing: 2 },
  row: { flexDirection: "row", gap: 10, marginTop: 16 },
  btn: { flex: 1, padding: 14, borderRadius: radius.xl, alignItems: "center", justifyContent: "center" },
  btnGhost: { backgroundColor: colors.surface2 },
  btnGhostText: { color: colors.text, fontWeight: "700", fontSize: 15 },
  btnDanger: { backgroundColor: colors.danger },
  btnDangerText: { color: "#fff", fontWeight: "800", fontSize: 15 },
});
