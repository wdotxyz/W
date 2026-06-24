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

export default function SettingsScreen() {
  const { user, signOut } = useAuth();
  const router = useRouter();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);

  const onSignOut = async () => {
    try { await signOut(); } catch (e) { console.warn("signOut error:", e); }
    router.replace("/(auth)/signin");
  };

  const onConfirmDelete = async () => {
    if (confirmText.trim().toUpperCase() !== "DELETE") return;
    setDeleting(true);
    try {
      await api("/auth/me", { method: "DELETE" });
      // Wipe local session and route to signin
      try { await signOut(); } catch {}
      setDeleteOpen(false);
      router.replace("/(auth)/signin");
    } catch (e: any) {
      Alert.alert("Couldn't delete", e.message || "Please try again.");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <ScrollView contentContainerStyle={{ paddingBottom: 32 }}>
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
          <Row icon="shield-checkmark" label="Privacy Policy" onPress={() => router.push("/legal/privacy")} testID="row-privacy" />
          <Row icon="document-text" label="Terms of Service" onPress={() => router.push("/legal/terms")} testID="row-terms" />
          <Row icon="color-palette" label="Theme" hint="W" />
          <Row icon="help-circle" label="Help & Support" />
          <Row icon="information-circle" label="About W" hint="v1.0" />
        </View>

        <TouchableOpacity onPress={onSignOut} style={styles.signOut} testID="signout-btn">
          <Ionicons name="log-out-outline" size={20} color={colors.danger} />
          <Text style={styles.signOutText}>Sign out</Text>
        </TouchableOpacity>

        <TouchableOpacity onPress={() => { setConfirmText(""); setDeleteOpen(true); }} style={styles.deleteAcct} testID="delete-account-btn" activeOpacity={0.7}>
          <Ionicons name="trash-outline" size={18} color={colors.danger} />
          <Text style={styles.deleteAcctText}>Delete account</Text>
        </TouchableOpacity>
        <Text style={styles.deleteHint}>Permanently erase your account, chats, mail, and statuses.</Text>
      </ScrollView>

      {/* Delete confirmation modal */}
      <Modal
        visible={deleteOpen}
        transparent
        animationType="fade"
        onRequestClose={() => !deleting && setDeleteOpen(false)}
      >
        <KeyboardAvoidingView style={styles.modalBackdrop} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <View style={styles.modalCard} testID="delete-modal">
            <View style={styles.modalIcon}>
              <Ionicons name="warning" size={28} color={colors.danger} />
            </View>
            <Text style={styles.modalTitle}>Delete your account?</Text>
            <Text style={styles.modalBody}>
              This will permanently erase your profile, chats, voice notes, statuses, drafts, and all emails sent to and from {user?.email_address || "your handle"}. This action cannot be undone.
            </Text>

            <Text style={styles.modalLabel}>Type <Text style={styles.modalDelete}>DELETE</Text> to confirm</Text>
            <TextInput
              style={styles.modalInput}
              value={confirmText}
              onChangeText={setConfirmText}
              autoCapitalize="characters"
              autoCorrect={false}
              placeholder="DELETE"
              placeholderTextColor={colors.textMuted}
              editable={!deleting}
              testID="delete-confirm-input"
            />

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={[styles.modalBtn, styles.cancelBtn]}
                onPress={() => setDeleteOpen(false)}
                disabled={deleting}
                testID="delete-cancel-btn"
                activeOpacity={0.7}
              >
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.modalBtn,
                  styles.confirmBtn,
                  (confirmText.trim().toUpperCase() !== "DELETE" || deleting) && { opacity: 0.5 },
                ]}
                onPress={onConfirmDelete}
                disabled={confirmText.trim().toUpperCase() !== "DELETE" || deleting}
                testID="delete-confirm-btn"
                activeOpacity={0.85}
              >
                {deleting ? <ActivityIndicator color="#fff" /> : <Text style={styles.confirmText}>Delete forever</Text>}
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

  deleteAcct: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
    marginTop: 14, marginHorizontal: space.xl, paddingVertical: 10,
  },
  deleteAcctText: { color: colors.danger, fontWeight: "700", fontSize: 14, textDecorationLine: "underline" },
  deleteHint: { textAlign: "center", color: colors.textMuted, fontSize: 11.5, marginTop: 2, marginHorizontal: space.xl },

  modalBackdrop: { flex: 1, backgroundColor: "rgba(6,21,43,0.55)", alignItems: "center", justifyContent: "center", padding: 24 },
  modalCard: { backgroundColor: colors.surface, borderRadius: 18, padding: 22, width: "100%", maxWidth: 420 },
  modalIcon: { width: 52, height: 52, borderRadius: 26, backgroundColor: "#FDECEC", alignItems: "center", justifyContent: "center", marginBottom: 12, alignSelf: "center" },
  modalTitle: { fontSize: 20, fontWeight: "800", color: colors.text, textAlign: "center", letterSpacing: -0.3 },
  modalBody: { fontSize: 14, color: colors.textMuted, lineHeight: 21, textAlign: "center", marginTop: 8 },
  modalLabel: { fontSize: 12, color: colors.textMuted, fontWeight: "700", marginTop: 18, marginBottom: 6 },
  modalDelete: { color: colors.danger, fontWeight: "800" },
  modalInput: {
    backgroundColor: colors.surface2, borderRadius: radius.lg, padding: 14,
    fontSize: 16, color: colors.text, fontWeight: "700", textAlign: "center", letterSpacing: 2,
  },
  modalActions: { flexDirection: "row", gap: 10, marginTop: 18 },
  modalBtn: { flex: 1, padding: 14, borderRadius: radius.xl, alignItems: "center", justifyContent: "center" },
  cancelBtn: { backgroundColor: colors.surface2 },
  cancelText: { color: colors.text, fontWeight: "700", fontSize: 15 },
  confirmBtn: { backgroundColor: colors.danger },
  confirmText: { color: "#fff", fontWeight: "800", fontSize: 15 },
});
