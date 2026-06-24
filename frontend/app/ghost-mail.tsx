import React, { useEffect, useState } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView, Switch, ActivityIndicator, Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { api } from "../src/api";
import { useAuth } from "../src/auth";
import { colors, radius, space } from "../src/theme";

type GhostMail = { enabled: boolean; can_disable: boolean; tier: string };

export default function GhostMailScreen() {
  const router = useRouter();
  const { user, setUser } = useAuth();
  const [state, setState] = useState<GhostMail | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const r = await api<GhostMail>("/auth/ghost-mail");
        setState(r);
      } catch (e) { /* fall back to user object */ setState({ enabled: (user as any)?.ghost_mail_enabled !== false, can_disable: false, tier: (user as any)?.tier || "free" }); }
    })();
  }, [user]);

  const toggle = async (next: boolean) => {
    if (!state) return;
    if (!next && !state.can_disable) {
      Alert.alert("Plus or Pro required", "Disabling Ghost Mail is a premium feature. Upgrade to keep every email forever.", [
        { text: "Cancel", style: "cancel" },
        { text: "Upgrade", onPress: () => router.push("/billing/upgrade") },
      ]);
      return;
    }
    setSaving(true);
    try {
      const r = await api<{ enabled: boolean }>("/auth/ghost-mail", {
        method: "PATCH",
        body: JSON.stringify({ enabled: next }),
      });
      setState({ ...state, enabled: r.enabled });
      if (user) setUser({ ...user, ghost_mail_enabled: r.enabled } as any);
    } catch (e: any) { Alert.alert("Couldn't update", e.message); }
    finally { setSaving(false); }
  };

  if (!state) {
    return (
      <SafeAreaView style={[styles.safe, { alignItems: "center", justifyContent: "center" }]} edges={["top", "bottom"]}>
        <ActivityIndicator color={colors.primary} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn} testID="ghost-back">
          <Ionicons name="chevron-back" size={26} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.title}>Ghost Mail</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.emojiBig}>👻</Text>
        <Text style={styles.hero}>Read it. Lose it.</Text>
        <Text style={styles.heroSub}>
          By default, opened emails vanish forever when you close them. Tap <Text style={{ fontWeight: "800" }}>Save</Text> on a thread to keep it in your 1 GB Starred vault.
        </Text>

        <View style={styles.toggleRow} testID="ghost-toggle-row">
          <View style={{ flex: 1 }}>
            <Text style={styles.toggleLabel}>Ghost Mail enabled</Text>
            <Text style={styles.toggleHint}>
              {state.enabled
                ? "Opened threads vanish on close — unless you Save them."
                : "Every email stays in your inbox forever (Premium)."}
            </Text>
          </View>
          {saving ? <ActivityIndicator color={colors.primary} /> : (
            <Switch
              value={state.enabled}
              onValueChange={toggle}
              trackColor={{ false: "#CBD5E0", true: colors.accent }}
              thumbColor="#fff"
              testID="ghost-switch"
            />
          )}
        </View>

        {!state.can_disable && (
          <View style={styles.lockCard} testID="ghost-lock-card">
            <Ionicons name="lock-closed" size={18} color={colors.primary} />
            <Text style={styles.lockText}>
              Turning Ghost Mail <Text style={{ fontWeight: "800" }}>off</Text> is a Plus or Pro feature.
            </Text>
            <TouchableOpacity onPress={() => router.push("/billing/upgrade")} style={styles.upgradeBtn} testID="ghost-upgrade">
              <Text style={styles.upgradeText}>Upgrade</Text>
            </TouchableOpacity>
          </View>
        )}

        <View style={styles.tipsCard}>
          <Ionicons name="sparkles" size={16} color={colors.accent} />
          <Text style={styles.tipsText}>
            Unread emails stay in your inbox untouched. Ghost Mail only kicks in once you open a thread and walk away.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: "row", alignItems: "center", padding: space.md, gap: 8, borderBottomWidth: 1, borderBottomColor: colors.border },
  iconBtn: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  title: { flex: 1, fontSize: 18, fontWeight: "800", color: colors.text },
  scroll: { padding: space.xl, gap: 14 },
  emojiBig: { fontSize: 56, textAlign: "center", marginTop: 8 },
  hero: { fontSize: 24, fontWeight: "800", color: colors.text, textAlign: "center", letterSpacing: -0.4 },
  heroSub: { fontSize: 14, color: colors.textMuted, textAlign: "center", lineHeight: 20, marginBottom: 6 },
  toggleRow: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14, backgroundColor: colors.surface2, borderRadius: radius.xl, marginTop: 6 },
  toggleLabel: { fontSize: 15, fontWeight: "800", color: colors.text },
  toggleHint: { fontSize: 12.5, color: colors.textMuted, marginTop: 4, lineHeight: 18 },
  lockCard: { flexDirection: "row", alignItems: "center", gap: 10, padding: 14, backgroundColor: "#E8F5F7", borderRadius: radius.lg },
  lockText: { flex: 1, fontSize: 12.5, color: colors.text, lineHeight: 18 },
  upgradeBtn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: radius.pill, backgroundColor: colors.primary },
  upgradeText: { color: "#fff", fontWeight: "800", fontSize: 12 },
  tipsCard: { flexDirection: "row", gap: 8, padding: 12, backgroundColor: "#FFF4E5", borderRadius: radius.lg, borderWidth: 1, borderColor: "#FFE0B2" },
  tipsText: { flex: 1, color: "#7A4A00", fontSize: 12.5, lineHeight: 18 },
});
