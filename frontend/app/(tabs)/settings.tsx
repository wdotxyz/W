import React, { useState } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView, Modal,
  TextInput, ActivityIndicator, Alert, Platform, KeyboardAvoidingView,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "../../src/auth";
import { Avatar } from "./chats";
import { api } from "../../src/api";
import { colors, radius, space } from "../../src/theme";

type Step = "closed" | "choose" | "confirmDelete";

export default function SettingsScreen() {
  const { user, signOut } = useAuth();
  const router = useRouter();
  const [step, setStep] = useState<Step>("closed");
  const [confirmText, setConfirmText] = useState("");
  const [busy, setBusy] = useState(false);

  const close = () => { if (!busy) { setStep("closed"); setConfirmText(""); } };

  const onSignOut = async () => {
    try { await signOut(); } catch (e) { console.warn("signOut error:", e); }
    router.replace("/(auth)/signin");
  };

  const onDeactivate = async () => {
    setBusy(true);
    try {
      await api("/auth/deactivate", { method: "POST" });
      try { await signOut(); } catch {}
      setStep("closed");
      router.replace("/(auth)/signin");
    } catch (e: any) {
      Alert.alert("Couldn't deactivate", e.message || "Please try again.");
    } finally { setBusy(false); }
  };

  const onDeleteForever = async () => {
    if (confirmText.trim().toUpperCase() !== "DELETE") return;
    setBusy(true);
    try {
      await api("/auth/me", { method: "DELETE" });
      try { await signOut(); } catch {}
      setStep("closed");
      router.replace("/(auth)/signin");
    } catch (e: any) {
      Alert.alert("Couldn't delete", e.message || "Please try again.");
    } finally { setBusy(false); }
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Text style={styles.title}>Settings</Text>

        <View style={styles.profileCard} testID="profile-card">
          <Avatar uri={user?.avatar} name={user?.name} size={68} />
          <View style={{ marginLeft: 14, flex: 1 }}>
            <Text style={styles.name}>{user?.name || "—"}</Text>
            <Text style={styles.phone}>{user?.phone}</Text>
            <Text style={styles.about} numberOfLines={1}>{user?.about}</Text>
          </View>
          <TouchableOpacity onPress={() => router.push("/(auth)/profile-setup")} style={styles.editBtn} testID="edit-profile-btn">
            <Ionicons name="pencil" size={16} color={colors.accent} />
          </TouchableOpacity>
        </View>

        <View style={styles.group}>
          <Row icon="notifications" label="Notifications" onPress={() => router.push("/notification-settings")} testID="row-notifications" />
          <Row icon="mail" label="Email signature" onPress={() => router.push("/signature")} testID="row-signature" />
          <Row icon="shield-checkmark" label="Two-step verification" hint={user?.two_factor_enabled ? "On" : "Off"} onPress={() => router.push("/two-factor-settings")} testID="row-2fa" />
          <Row icon="lock-closed" label="Privacy Policy" onPress={() => router.push("/legal/privacy")} testID="row-privacy" />
          <Row icon="document-text" label="Terms of Service" onPress={() => router.push("/legal/terms")} testID="row-terms" />
          <Row icon="color-palette" label="Theme" hint="W" />
          <Row icon="help-circle" label="Help & Support" />
          <Row icon="information-circle" label="About W" hint="v1.0" />
        </View>

        <TouchableOpacity onPress={onSignOut} style={styles.signOut} testID="signout-btn">
          <Ionicons name="log-out-outline" size={20} color={colors.danger} />
          <Text style={styles.signOutText}>Sign out</Text>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={() => { setConfirmText(""); setStep("choose"); }}
          style={styles.deactivate}
          testID="deactivate-account-btn"
          activeOpacity={0.7}
        >
          <Ionicons name="pause-circle-outline" size={18} color={colors.danger} />
          <Text style={styles.deactivateText}>Deactivate account</Text>
        </TouchableOpacity>
        <Text style={styles.deactivateHint}>Take a break or permanently delete your data.</Text>
      </ScrollView>

      {/* CHOOSER MODAL */}
      <Modal visible={step === "choose"} transparent animationType="fade" onRequestClose={close}>
        <View style={styles.backdrop}>
          <View style={styles.card} testID="deactivate-modal">
            <View style={styles.iconWrap}>
              <Ionicons name="pause-circle" size={32} color={colors.danger} />
            </View>
            <Text style={styles.cardTitle}>Deactivate your account</Text>
            <Text style={styles.cardBody}>
              Choose what works for you. You can come back anytime — or remove everything for good.
            </Text>

            {/* OPTION 1: Deactivate */}
            <TouchableOpacity
              style={[styles.optionCard, styles.optionPause]}
              onPress={onDeactivate}
              disabled={busy}
              activeOpacity={0.85}
              testID="option-deactivate"
            >
              <View style={[styles.optionIcon, { backgroundColor: "#FFF3E0" }]}>
                <Ionicons name="time-outline" size={22} color="#E07B00" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.optionTitle}>Pause my account</Text>
                <Text style={styles.optionSub}>
                  Hide me from people-search. Chats and mail are kept. Sign back in anytime to reactivate.
                </Text>
              </View>
              {busy && step === "choose" ? (
                <ActivityIndicator color={colors.text} />
              ) : (
                <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
              )}
            </TouchableOpacity>

            {/* OPTION 2: Delete */}
            <TouchableOpacity
              style={[styles.optionCard, styles.optionDelete]}
              onPress={() => setStep("confirmDelete")}
              disabled={busy}
              activeOpacity={0.85}
              testID="option-delete"
            >
              <View style={[styles.optionIcon, { backgroundColor: "#FDECEC" }]}>
                <Ionicons name="trash-outline" size={22} color={colors.danger} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.optionTitle, { color: colors.danger }]}>Delete forever</Text>
                <Text style={styles.optionSub}>
                  Permanently erase your profile, chats, voice notes, statuses, drafts, and all emails. Cannot be undone.
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={colors.danger} />
            </TouchableOpacity>

            <TouchableOpacity onPress={close} disabled={busy} style={styles.cardCancel} testID="deactivate-cancel-btn">
              <Text style={styles.cardCancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* CONFIRM DELETE MODAL */}
      <Modal visible={step === "confirmDelete"} transparent animationType="fade" onRequestClose={close}>
        <KeyboardAvoidingView style={styles.backdrop} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <View style={styles.card} testID="delete-modal">
            <View style={[styles.iconWrap, { backgroundColor: "#FDECEC" }]}>
              <Ionicons name="warning" size={28} color={colors.danger} />
            </View>
            <Text style={styles.cardTitle}>Delete forever?</Text>
            <Text style={styles.cardBody}>
              We&apos;ll erase {user?.email_address || "your @w.xyz address"}, your chats, voice notes, statuses, drafts and every email. This action cannot be undone.
            </Text>

            <Text style={styles.deleteLabel}>Type <Text style={styles.deleteWord}>DELETE</Text> to confirm</Text>
            <TextInput
              style={styles.deleteInput}
              value={confirmText}
              onChangeText={setConfirmText}
              autoCapitalize="characters"
              autoCorrect={false}
              placeholder="DELETE"
              placeholderTextColor={colors.textMuted}
              editable={!busy}
              testID="delete-confirm-input"
            />

            <View style={styles.row}>
              <TouchableOpacity
                style={[styles.btn, styles.btnGhost]}
                onPress={() => setStep("choose")}
                disabled={busy}
                testID="delete-back-btn"
                activeOpacity={0.7}
              >
                <Text style={styles.btnGhostText}>Back</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.btn, styles.btnDanger,
                  (confirmText.trim().toUpperCase() !== "DELETE" || busy) && { opacity: 0.5 },
                ]}
                onPress={onDeleteForever}
                disabled={confirmText.trim().toUpperCase() !== "DELETE" || busy}
                testID="delete-confirm-btn"
                activeOpacity={0.85}
              >
                {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnDangerText}>Delete forever</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

const Row = ({ icon, label, hint, onPress, testID }: any) => (
  <TouchableOpacity onPress={onPress} disabled={!onPress} activeOpacity={onPress ? 0.6 : 1} style={styles.rowItem} testID={testID}>
    <View style={styles.rowIcon}><Ionicons name={icon} size={18} color={colors.accent} /></View>
    <Text style={styles.rowLabel}>{label}</Text>
    {!!hint && <Text style={styles.rowHint}>{hint}</Text>}
    <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
  </TouchableOpacity>
);

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.surface },
  // Extra bottom padding to clear the floating tab bar.
  scroll: { paddingBottom: 140 },
  title: { fontSize: 28, fontWeight: "800", color: colors.text, letterSpacing: -0.5, padding: space.xl },
  profileCard: { flexDirection: "row", alignItems: "center", marginHorizontal: space.xl, padding: 16, backgroundColor: colors.surface2, borderRadius: radius.xl },
  name: { fontSize: 18, fontWeight: "800", color: colors.text },
  phone: { fontSize: 13, color: colors.textMuted, marginTop: 2 },
  about: { fontSize: 13, color: colors.textMuted, marginTop: 4 },
  editBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: "#E8F5F7", alignItems: "center", justifyContent: "center" },
  group: { marginTop: space.xl, marginHorizontal: space.xl, backgroundColor: colors.surface2, borderRadius: radius.xl, overflow: "hidden" },
  rowItem: { flexDirection: "row", alignItems: "center", padding: 14, borderBottomWidth: 1, borderBottomColor: colors.border, gap: 12 },
  rowIcon: { width: 36, height: 36, borderRadius: 18, backgroundColor: "#E8F5F7", alignItems: "center", justifyContent: "center" },
  rowLabel: { flex: 1, fontSize: 15, color: colors.text, fontWeight: "600" },
  rowHint: { fontSize: 13, color: colors.textMuted, marginRight: 6 },
  signOut: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, marginTop: space.xl, marginHorizontal: space.xl, padding: 16, borderRadius: radius.xl, borderWidth: 1, borderColor: colors.danger },
  signOutText: { color: colors.danger, fontWeight: "700", fontSize: 15 },

  deactivate: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
    marginTop: 14, marginHorizontal: space.xl, paddingVertical: 10,
  },
  deactivateText: { color: colors.danger, fontWeight: "700", fontSize: 14, textDecorationLine: "underline" },
  deactivateHint: { textAlign: "center", color: colors.textMuted, fontSize: 11.5, marginTop: 2, marginHorizontal: space.xl },

  // Modal shared
  backdrop: { flex: 1, backgroundColor: "rgba(6,21,43,0.55)", alignItems: "center", justifyContent: "center", padding: 24 },
  card: { backgroundColor: colors.surface, borderRadius: 20, padding: 22, width: "100%", maxWidth: 440 },
  iconWrap: { width: 56, height: 56, borderRadius: 28, backgroundColor: "#FFF3E0", alignItems: "center", justifyContent: "center", marginBottom: 12, alignSelf: "center" },
  cardTitle: { fontSize: 20, fontWeight: "800", color: colors.text, textAlign: "center", letterSpacing: -0.3 },
  cardBody: { fontSize: 14, color: colors.textMuted, lineHeight: 21, textAlign: "center", marginTop: 8, marginBottom: 18 },

  // Chooser
  optionCard: {
    flexDirection: "row", alignItems: "center", gap: 12,
    backgroundColor: colors.surface2, borderRadius: radius.xl, padding: 14, marginTop: 10,
    borderWidth: 1.5,
  },
  optionPause: { borderColor: "#FFE0B2" },
  optionDelete: { borderColor: "#FDDADA" },
  optionIcon: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  optionTitle: { fontSize: 15, fontWeight: "800", color: colors.text },
  optionSub: { fontSize: 12.5, color: colors.textMuted, lineHeight: 18, marginTop: 2 },

  cardCancel: { alignItems: "center", justifyContent: "center", padding: 14, marginTop: 8 },
  cardCancelText: { color: colors.text, fontWeight: "700", fontSize: 15 },

  // Confirm delete
  deleteLabel: { fontSize: 12, color: colors.textMuted, fontWeight: "700", marginTop: 4, marginBottom: 6, textAlign: "center" },
  deleteWord: { color: colors.danger, fontWeight: "800" },
  deleteInput: {
    backgroundColor: colors.surface2, borderRadius: radius.lg, padding: 14,
    fontSize: 16, color: colors.text, fontWeight: "700", textAlign: "center", letterSpacing: 2,
  },
  row: { flexDirection: "row", gap: 10, marginTop: 16 },
  btn: { flex: 1, padding: 14, borderRadius: radius.xl, alignItems: "center", justifyContent: "center" },
  btnGhost: { backgroundColor: colors.surface2 },
  btnGhostText: { color: colors.text, fontWeight: "700", fontSize: 15 },
  btnDanger: { backgroundColor: colors.danger },
  btnDangerText: { color: "#fff", fontWeight: "800", fontSize: 15 },
});
