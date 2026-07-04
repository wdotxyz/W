import React, { useEffect, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Alert, Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import { api } from "../src/api";
import { useAuth } from "../src/auth";
import { colors, radius, space } from "../src/theme";
import { smartBack } from "../src/utils/nav";

type DnsRecord = {
  type: string;
  host: string;
  value: string;
  priority?: number;
  purpose: string;
};

export default function DomainSetupScreen() {
  const router = useRouter();
  const { user, setUser } = useAuth();
  const [data, setData] = useState<any>(null);
  const [verifying, setVerifying] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await api<any>("/domain/dns-records");
        setData(res);
      } catch (e) { console.warn("dns-records:", e); }
    })();
  }, []);

  const onCopy = async (v: string) => {
    try { await Clipboard.setStringAsync(v); setCopied(v); setTimeout(() => setCopied(null), 1500); } catch {}
  };

  const onVerify = async () => {
    setVerifying(true);
    try {
      const res = await api<{ verified: boolean; message: string }>("/domain/verify", { method: "POST" });
      Alert.alert(res.verified ? "✓ Verified" : "Not yet", res.message);
      if (res.verified) {
        const fresh = await api<any>("/auth/me");
        setUser(fresh);
        setData((d: any) => ({ ...(d || {}), verified: true }));
      }
    } catch (e: any) {
      Alert.alert("Couldn't verify", e?.message || "Try again in a moment.");
    } finally { setVerifying(false); }
  };

  if (!data) {
    return <SafeAreaView style={[styles.safe, { alignItems: "center", justifyContent: "center" }]}>
      <ActivityIndicator color={colors.accent} />
    </SafeAreaView>;
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => smartBack(router)} style={styles.back} testID="domain-back-btn">
          <Ionicons name="chevron-back" size={26} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Connect your domain</Text>
        <View style={styles.back} />
      </View>

      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        <View style={[styles.statusBadge, data.verified ? styles.badgeOk : styles.badgePending]}>
          <Ionicons name={data.verified ? "checkmark-circle" : "time-outline"} size={16} color="#fff" />
          <Text style={styles.statusBadgeText}>
            {data.verified ? "Verified" : "Pending DNS"}
          </Text>
        </View>

        <Text style={styles.title}>{data.domain}</Text>
        {!!data.fallback_address && (
          <View style={styles.fallbackCard}>
            <Text style={styles.fallbackLabel}>Your recovery address (always yours)</Text>
            <Text style={styles.fallbackAddr}>{data.fallback_address}</Text>
            <Text style={styles.fallbackHint}>
              If you ever lose access to <Text style={{ fontWeight: "700" }}>{data.domain}</Text>, this @w.xyz recovery address keeps your account safe.
            </Text>
          </View>
        )}

        <Text style={styles.sectionTitle}>Add these DNS records</Text>
        <Text style={styles.instructions}>{data.instructions}</Text>

        {(data.records as DnsRecord[]).map((r, i) => (
          <View key={i} style={styles.recordCard}>
            <View style={styles.recordHead}>
              <Text style={styles.recordType}>{r.type}</Text>
              {!!r.priority && <Text style={styles.recordMeta}>Priority {r.priority}</Text>}
            </View>
            <Field label="Host / Name" value={r.host} onCopy={onCopy} copied={copied === r.host} />
            <Field label="Value" value={r.value} onCopy={onCopy} copied={copied === r.value} />
            <Text style={styles.recordPurpose}>{r.purpose}</Text>
          </View>
        ))}

        <TouchableOpacity
          style={[styles.cta, verifying && { opacity: 0.6 }]}
          onPress={onVerify}
          disabled={verifying}
          testID="verify-domain-btn"
          activeOpacity={0.85}
        >
          {verifying
            ? <ActivityIndicator color="#fff" />
            : <><Ionicons name={data.verified ? "refresh" : "checkmark"} size={18} color="#fff" /><Text style={styles.ctaText}>{data.verified ? "Re-check" : "Verify now"}</Text></>}
        </TouchableOpacity>

        <Text style={styles.fineprint}>
          DNS changes typically apply within minutes but can take up to 48 hours. Until verification completes you&apos;ll receive mail at your recovery address.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const Field = ({ label, value, onCopy, copied }: any) => (
  <View style={styles.fieldRow}>
    <View style={{ flex: 1 }}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <Text style={styles.fieldValue} selectable>{value}</Text>
    </View>
    <TouchableOpacity onPress={() => onCopy(value)} style={styles.copyBtn}>
      <Ionicons name={copied ? "checkmark" : "copy-outline"} size={16} color={colors.accent} />
      <Text style={styles.copyText}>{copied ? "Copied" : "Copy"}</Text>
    </TouchableOpacity>
  </View>
);

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 8, paddingVertical: 6, borderBottomWidth: 0.5, borderBottomColor: colors.border },
  back: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  headerTitle: { flex: 1, textAlign: "center", fontSize: 16, fontWeight: "700", color: colors.text },
  body: { padding: space.xl, paddingBottom: 32 },

  statusBadge: { alignSelf: "flex-start", flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999 },
  badgeOk: { backgroundColor: colors.success },
  badgePending: { backgroundColor: "#E07B00" },
  statusBadgeText: { color: "#fff", fontSize: 12, fontWeight: "800", letterSpacing: 0.5 },

  title: { fontSize: 26, fontWeight: "800", color: colors.text, letterSpacing: -0.5, marginTop: 12 },
  fallbackCard: { marginTop: 14, padding: 14, backgroundColor: "#EEF6F7", borderRadius: radius.xl, borderLeftWidth: 3, borderLeftColor: colors.accent },
  fallbackLabel: { fontSize: 11, fontWeight: "800", color: colors.textMuted, letterSpacing: 1 },
  fallbackAddr: { fontSize: 16, fontWeight: "700", color: colors.text, marginTop: 4 },
  fallbackHint: { fontSize: 12, color: colors.textMuted, marginTop: 8, lineHeight: 17 },

  sectionTitle: { fontSize: 18, fontWeight: "800", color: colors.text, marginTop: 22 },
  instructions: { fontSize: 13, color: colors.textMuted, lineHeight: 19, marginTop: 6 },

  recordCard: { marginTop: 14, padding: 14, backgroundColor: colors.surface2, borderRadius: radius.xl },
  recordHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 4 },
  recordType: { fontSize: 11, fontWeight: "900", color: colors.accent, letterSpacing: 1.5, backgroundColor: colors.surface, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  recordMeta: { fontSize: 12, color: colors.textMuted },

  fieldRow: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 8 },
  fieldLabel: { fontSize: 11, color: colors.textMuted, fontWeight: "700", marginBottom: 2, letterSpacing: 0.5, textTransform: "uppercase" },
  fieldValue: { fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace", fontSize: 13, color: colors.text },
  copyBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.accent },
  copyText: { color: colors.accent, fontSize: 12, fontWeight: "800" },

  recordPurpose: { fontSize: 11.5, color: colors.textMuted, marginTop: 10, fontStyle: "italic" },

  cta: { flexDirection: "row", gap: 8, backgroundColor: colors.primary, padding: 16, borderRadius: radius.xl, alignItems: "center", justifyContent: "center", marginTop: 24 },
  ctaText: { color: "#fff", fontSize: 16, fontWeight: "700" },
  fineprint: { textAlign: "center", color: colors.textMuted, fontSize: 11.5, marginTop: 16, lineHeight: 17 },
});
