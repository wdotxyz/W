import React, { useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Share, Platform, Alert, Modal } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import { useAuth } from "../../src/auth";
import { Avatar } from "../chats";
import { colors, radius, space } from "../../src/theme";
import { SHOW_PREMIUM } from "../../src/featureFlags";

export default function SettingsScreen() {
  const { user, signOut } = useAuth();
  const router = useRouter();
  const [referOpen, setReferOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const REFER_URL = "https://joinw.xyz";
  const referMessage =
    `${user?.name || "I"} is using W — an AI-native webmail & messaging app.\n\n` +
    `Custom domains, ghost mail, AI agents, and more.\n\n` +
    `Try it at ${REFER_URL}`;

  const onSignOut = async () => {
    try { await signOut(); } catch (e) { console.warn("signOut error:", e); }
    router.replace("/(auth)/signin");
  };

  const copyLink = async () => {
    try {
      await Clipboard.setStringAsync(referMessage);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      Alert.alert("Couldn't copy", "Please long-press the message to copy manually.");
    }
  };

  const shareNative = async () => {
    try {
      if (Platform.OS === "web") {
        // @ts-ignore
        if (typeof navigator !== "undefined" && (navigator as any).share) {
          await (navigator as any).share({ title: "W by W Platforms", text: referMessage, url: REFER_URL });
        } else {
          await copyLink();
        }
      } else {
        await Share.share({ message: referMessage, url: REFER_URL, title: "W by W Platforms" }, { dialogTitle: "Invite a friend to W" });
      }
    } catch (e: any) {
      if (e?.message && !/cancell?ed|user dismissed|abort/i.test(e.message)) {
        Alert.alert("Couldn't share", e.message);
      }
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Text style={styles.title}>Settings</Text>

        <View style={styles.profileCard} testID="profile-card">
          <Avatar uri={user?.avatar} name={user?.name} size={68} />
          <View style={{ marginLeft: 14, flex: 1 }}>
            <Text style={styles.name}>{user?.name || "—"}</Text>
            <Text style={styles.handle} numberOfLines={1} testID="profile-handle">{user?.email_address || "Set up your handle"}</Text>
            <Text style={styles.about} numberOfLines={1}>{user?.about}</Text>
          </View>
          <TouchableOpacity onPress={() => router.push("/(auth)/profile-setup")} style={styles.editBtn} testID="edit-profile-btn">
            <Ionicons name="pencil" size={16} color={colors.accent} />
          </TouchableOpacity>
        </View>

        <View style={styles.group}>
          {SHOW_PREMIUM ? (
            <Row icon="star" label="W Premium" onPress={() => router.push("/billing/upgrade")} testID="row-premium" />
          ) : null}
          {SHOW_PREMIUM && user?.custom_domain ? (
            <Row icon="globe" label="Custom domain" onPress={() => router.push("/domain-setup")} testID="row-domain" />
          ) : null}
          <Row icon="notifications" label="Notifications" onPress={() => router.push("/notification-settings")} testID="row-notifications" />
          <Row icon="help-circle" label="Help Center" onPress={() => router.push("/help")} testID="row-help" />
          <Row icon="mail" label="Mail Settings" onPress={() => router.push("/settings/mail")} testID="row-mail-section" />
          <Row icon="person-circle" label="Account" onPress={() => router.push("/settings/account")} testID="row-account-section" />
        </View>

        <TouchableOpacity style={styles.referBtn} onPress={() => setReferOpen(true)} testID="refer-app-btn" activeOpacity={0.85}>
          <Ionicons name="gift" size={18} color={colors.accent} />
          <Text style={styles.referText}>Refer W to a friend</Text>
          <Ionicons name="share-outline" size={18} color={colors.accent} />
        </TouchableOpacity>
      </ScrollView>

      {/* Refer-a-friend bottom sheet */}
      <Modal visible={referOpen} transparent animationType="fade" onRequestClose={() => setReferOpen(false)}>
        <TouchableOpacity activeOpacity={1} style={styles.modalBackdrop} onPress={() => setReferOpen(false)} testID="refer-backdrop">
          <TouchableOpacity activeOpacity={1} style={styles.referSheet} onPress={() => {}}>
            <View style={styles.sheetHandle} />
            <View style={styles.sheetHeader}>
              <Ionicons name="gift" size={22} color={colors.accent} />
              <Text style={styles.sheetTitle}>Invite a friend to W</Text>
              <View style={{ flex: 1 }} />
              <TouchableOpacity onPress={() => setReferOpen(false)} testID="refer-close">
                <Ionicons name="close" size={22} color={colors.textMuted} />
              </TouchableOpacity>
            </View>
            <Text style={styles.referBody} selectable testID="refer-message">{referMessage}</Text>
            <TouchableOpacity onPress={copyLink} style={[styles.referAction, copied && styles.referActionDone]} activeOpacity={0.8} testID="refer-copy">
              <Ionicons name={copied ? "checkmark" : "copy"} size={18} color="#fff" />
              <Text style={styles.referActionText}>{copied ? "Copied!" : "Copy message"}</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={shareNative} style={styles.referActionOutline} activeOpacity={0.8} testID="refer-share">
              <Ionicons name="share-outline" size={18} color={colors.accent} />
              <Text style={styles.referActionOutlineText}>Share via…</Text>
            </TouchableOpacity>
            <View style={{ height: 12 }} />
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </SafeAreaView>
  );
}

const Row = ({ icon, label, hint, onPress, testID }: any) => (
  <TouchableOpacity onPress={onPress} disabled={!onPress} activeOpacity={onPress ? 0.6 : 1} style={styles.rowItem} testID={testID}>
    <View style={styles.rowIcon}><Ionicons name={icon} size={18} color={colors.accent} /></View>
    <Text style={styles.rowLabel}>{label}</Text>
    {!!hint && <Text style={styles.rowHint} numberOfLines={1}>{hint}</Text>}
    <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
  </TouchableOpacity>
);

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.surface },
  scroll: { paddingBottom: 140 },
  title: { fontSize: 28, fontWeight: "800", color: colors.text, letterSpacing: -0.5, padding: space.xl },
  profileCard: { flexDirection: "row", alignItems: "center", marginHorizontal: space.xl, padding: 16, backgroundColor: colors.surface2, borderRadius: radius.xl },
  name: { fontSize: 18, fontWeight: "800", color: colors.text },
  phone: { fontSize: 13, color: colors.textMuted, marginTop: 2 },
  handle: { fontSize: 13, color: colors.accent, marginTop: 2, fontWeight: "700" },
  about: { fontSize: 13, color: colors.textMuted, marginTop: 4 },
  editBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: "#E8F5F7", alignItems: "center", justifyContent: "center" },
  group: { marginTop: space.xl, marginHorizontal: space.xl, backgroundColor: colors.surface2, borderRadius: radius.xl, overflow: "hidden" },
  rowItem: { flexDirection: "row", alignItems: "center", padding: 14, borderBottomWidth: 1, borderBottomColor: colors.border, gap: 12 },
  rowIcon: { width: 36, height: 36, borderRadius: 18, backgroundColor: "#E8F5F7", alignItems: "center", justifyContent: "center" },
  rowLabel: { flex: 1, fontSize: 15, color: colors.text, fontWeight: "600" },
  rowHint: { flex: 1, fontSize: 12.5, color: colors.textMuted, marginLeft: 8, textAlign: "right", marginRight: 6 },
  signOut: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, marginTop: space.xl, marginHorizontal: space.xl, padding: 16, borderRadius: radius.xl, borderWidth: 1, borderColor: colors.danger },
  signOutText: { color: colors.danger, fontWeight: "700", fontSize: 15 },
  referBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    marginTop: space.xl,
    marginHorizontal: space.xl,
    padding: 16,
    borderRadius: radius.xl,
    backgroundColor: "#E8F5F7",
    borderWidth: 1.5,
    borderColor: colors.accent,
  },
  referText: { color: colors.accent, fontWeight: "800", fontSize: 15 },
  modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  referSheet: { backgroundColor: colors.surface, padding: 20, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingBottom: 28 },
  sheetHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border, alignSelf: "center", marginBottom: 14 },
  sheetHeader: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 12 },
  sheetTitle: { fontSize: 17, fontWeight: "800", color: colors.text },
  referBody: { fontSize: 14.5, color: colors.text, lineHeight: 21, backgroundColor: colors.surface2, padding: 14, borderRadius: radius.lg, marginBottom: 14 },
  referAction: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, padding: 14, borderRadius: radius.xl, backgroundColor: colors.primary, marginBottom: 10 },
  referActionDone: { backgroundColor: "#1A8F4A" },
  referActionText: { color: "#fff", fontWeight: "800", fontSize: 15 },
  referActionOutline: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, padding: 14, borderRadius: radius.xl, borderWidth: 1.5, borderColor: colors.accent },
  referActionOutlineText: { color: colors.accent, fontWeight: "800", fontSize: 15 },
});
