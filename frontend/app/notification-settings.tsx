import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, Switch, ScrollView, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { api } from "../src/api";
import { useAuth } from "../src/auth";
import { colors, radius, space } from "../src/theme";

type Settings = {
  message_sounds: boolean;
  group_sounds: boolean;
  show_preview: boolean;
  vibration: boolean;
  mute_all: boolean;
};

const DEFAULTS: Settings = {
  message_sounds: true,
  group_sounds: true,
  show_preview: true,
  vibration: true,
  mute_all: false,
};

export default function NotificationSettings() {
  const router = useRouter();
  const { user, setUser } = useAuth();
  const [settings, setSettings] = useState<Settings>({ ...DEFAULTS, ...(user as any)?.notif });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setSettings({ ...DEFAULTS, ...(user as any)?.notif });
  }, [user]);

  const update = async (key: keyof Settings, value: boolean) => {
    const next = { ...settings, [key]: value };
    setSettings(next);
    setSaving(true);
    try {
      const notif = await api<Settings>("/auth/notification-settings", {
        method: "PATCH",
        body: JSON.stringify({ [key]: value }),
      });
      if (user) setUser({ ...user, notif } as any);
    } catch (e) {
      setSettings(settings); // revert
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} testID="notif-back">
          <Ionicons name="chevron-back" size={26} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.title}>Notifications</Text>
        {saving && <ActivityIndicator size="small" color={colors.accent} style={{ marginLeft: 8 }} />}
      </View>
      <ScrollView contentContainerStyle={{ paddingBottom: 32 }}>
        <Section title="Master">
          <Row
            icon="moon"
            label="Mute all notifications"
            hint="No sounds or banners for any chat"
            value={settings.mute_all}
            onValueChange={(v) => update("mute_all", v)}
            testID="notif-mute-all"
          />
        </Section>

        <Section title="Messages">
          <Row icon="volume-high" label="Message sounds" value={settings.message_sounds} onValueChange={(v) => update("message_sounds", v)} disabled={settings.mute_all} testID="notif-msg-sounds" />
          <Row icon="people" label="Group sounds" value={settings.group_sounds} onValueChange={(v) => update("group_sounds", v)} disabled={settings.mute_all} testID="notif-group-sounds" />
          <Row icon="eye" label="Show message preview" hint="Preview message text in banners" value={settings.show_preview} onValueChange={(v) => update("show_preview", v)} disabled={settings.mute_all} testID="notif-preview" />
          <Row icon="phone-portrait" label="Vibration" value={settings.vibration} onValueChange={(v) => update("vibration", v)} disabled={settings.mute_all} testID="notif-vibration" />
        </Section>

        <Text style={styles.footer}>
          W shows in-app banners and plays a soft tone when a message arrives while you're using the app. Push notifications (closed app) are coming soon.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const Section = ({ title, children }: any) => (
  <View style={styles.section}>
    <Text style={styles.sectionTitle}>{title}</Text>
    <View style={styles.card}>{children}</View>
  </View>
);

const Row = ({ icon, label, hint, value, onValueChange, disabled, testID }: any) => (
  <View style={[styles.row, disabled && { opacity: 0.45 }]}>
    <View style={styles.rowIcon}>
      <Ionicons name={icon} size={18} color={colors.accent} />
    </View>
    <View style={{ flex: 1 }}>
      <Text style={styles.label}>{label}</Text>
      {!!hint && <Text style={styles.hint}>{hint}</Text>}
    </View>
    <Switch
      value={value && !disabled}
      onValueChange={onValueChange}
      disabled={disabled}
      trackColor={{ false: colors.border, true: colors.accent }}
      thumbColor="#fff"
      testID={testID}
    />
  </View>
);

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: "row", alignItems: "center", padding: space.md, gap: 4 },
  backBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 22, fontWeight: "800", color: colors.text },
  section: { marginTop: space.lg, marginHorizontal: space.lg },
  sectionTitle: { fontSize: 12, fontWeight: "800", color: colors.textMuted, letterSpacing: 1.2, textTransform: "uppercase", marginBottom: 8, marginLeft: 4 },
  card: { backgroundColor: colors.surface2, borderRadius: radius.xl, overflow: "hidden" },
  row: { flexDirection: "row", alignItems: "center", padding: 14, gap: 12, borderBottomWidth: 1, borderBottomColor: colors.border },
  rowIcon: { width: 36, height: 36, borderRadius: 18, backgroundColor: "#E8F5F7", alignItems: "center", justifyContent: "center" },
  label: { fontSize: 15, color: colors.text, fontWeight: "600" },
  hint: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  footer: { fontSize: 12, color: colors.textMuted, padding: space.xl, lineHeight: 18 },
});
