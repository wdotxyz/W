import React, { useCallback, useEffect, useState } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView, ActivityIndicator, RefreshControl,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { api } from "../../src/api";
import { useAuth } from "../../src/auth";
import { colors, radius, space } from "../../src/theme";

type Stats = {
  as_of: string;
  volume: { outbound: { h24: number; d7: number; d30: number }; inbound: { h24: number; d7: number; d30: number } };
  projection: { monthly_outbound: number; monthly_inbound: number; monthly_total: number; basis: string };
  pricing: { sendgrid_monthly: number; ses_monthly: number; savings_monthly: number; savings_annual: number };
  recommendation: { verdict: "stay" | "plan" | "migrate"; headline: string; body: string };
  users: { total: number; new_7d: number };
  support: { open_tickets: number; total_tickets: number };
};

export default function AdminStatsScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await api<Stats>("/admin/stats");
      setStats(data);
      setErr(null);
    } catch (e: any) {
      setErr(e?.message || "Failed to load stats.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    load();
  }, [load]);

  const verdictColor = (v?: string) =>
    v === "migrate" ? "#C04C2D" : v === "plan" ? "#C8941A" : colors.accent;
  const verdictIcon = (v?: string) =>
    v === "migrate" ? "rocket" : v === "plan" ? "trending-up" : "checkmark-circle";

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn} testID="stats-back">
          <Ionicons name="chevron-back" size={26} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.title}>Email & Cost Stats</Text>
        <TouchableOpacity onPress={onRefresh} style={styles.iconBtn} testID="stats-refresh">
          <Ionicons name="refresh" size={22} color={colors.primary} />
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : err ? (
        <View style={styles.center}>
          <Ionicons name="lock-closed" size={32} color={colors.textMuted} />
          <Text style={styles.errTitle}>Support team only</Text>
          <Text style={styles.errBody}>Sign in with your support team account to see app stats.</Text>
          <Text style={styles.errBody}>{err}</Text>
        </View>
      ) : stats ? (
        <ScrollView
          contentContainerStyle={styles.scroll}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        >
          {/* Recommendation banner */}
          <View style={[styles.rec, { borderColor: verdictColor(stats.recommendation.verdict) }]} testID="stats-recommendation">
            <Ionicons name={verdictIcon(stats.recommendation.verdict) as any} size={28} color={verdictColor(stats.recommendation.verdict)} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.recTitle, { color: verdictColor(stats.recommendation.verdict) }]}>
                {stats.recommendation.headline}
              </Text>
              <Text style={styles.recBody}>{stats.recommendation.body}</Text>
            </View>
          </View>

          {/* Projection */}
          <Text style={styles.sectionLabel}>Projected monthly volume</Text>
          <View style={styles.card}>
            <View style={styles.projRow}>
              <View style={styles.projItem}>
                <Text style={styles.projNum}>{stats.projection.monthly_outbound.toLocaleString()}</Text>
                <Text style={styles.projLbl}>outbound</Text>
              </View>
              <View style={styles.projItem}>
                <Text style={styles.projNum}>{stats.projection.monthly_inbound.toLocaleString()}</Text>
                <Text style={styles.projLbl}>inbound</Text>
              </View>
              <View style={styles.projItem}>
                <Text style={styles.projNum}>{stats.projection.monthly_total.toLocaleString()}</Text>
                <Text style={styles.projLbl}>total</Text>
              </View>
            </View>
            <Text style={styles.footnote}>{stats.projection.basis}</Text>
          </View>

          {/* Cost comparison */}
          <Text style={styles.sectionLabel}>Monthly email cost</Text>
          <View style={styles.card}>
            <View style={styles.costRow}>
              <View style={styles.costItem}>
                <Text style={styles.costLabel}>SendGrid (today)</Text>
                <Text style={styles.costAmt}>${stats.pricing.sendgrid_monthly.toFixed(2)}</Text>
              </View>
              <Ionicons name="arrow-forward" size={20} color={colors.textMuted} />
              <View style={styles.costItem}>
                <Text style={styles.costLabel}>AWS SES</Text>
                <Text style={[styles.costAmt, { color: colors.accent }]}>${stats.pricing.ses_monthly.toFixed(2)}</Text>
              </View>
            </View>
            {stats.pricing.savings_monthly > 0 ? (
              <View style={styles.savingsRow}>
                <Ionicons name="cash" size={16} color={colors.primary} />
                <Text style={styles.savingsText}>
                  Save <Text style={{ fontWeight: "800" }}>${stats.pricing.savings_monthly.toFixed(2)}/mo</Text> (${stats.pricing.savings_annual.toFixed(0)}/yr) by switching to SES
                </Text>
              </View>
            ) : (
              <Text style={styles.footnote}>Migration isn&apos;t worth it at current volume.</Text>
            )}
          </View>

          {/* Raw volume */}
          <Text style={styles.sectionLabel}>Email volume</Text>
          <View style={styles.card}>
            <Stat label="Outbound (24h)" value={stats.volume.outbound.h24} />
            <Stat label="Outbound (7d)" value={stats.volume.outbound.d7} />
            <Stat label="Outbound (30d)" value={stats.volume.outbound.d30} />
            <View style={styles.divider} />
            <Stat label="Inbound (24h)" value={stats.volume.inbound.h24} />
            <Stat label="Inbound (7d)" value={stats.volume.inbound.d7} />
            <Stat label="Inbound (30d)" value={stats.volume.inbound.d30} />
          </View>

          {/* Users + support */}
          <Text style={styles.sectionLabel}>Users & support</Text>
          <View style={styles.card}>
            <Stat label="Total users" value={stats.users.total} />
            <Stat label="New users (7d)" value={stats.users.new_7d} />
            <View style={styles.divider} />
            <Stat label="Open tickets" value={stats.support.open_tickets} />
            <Stat label="Total tickets ever" value={stats.support.total_tickets} />
          </View>

          <Text style={styles.foot}>
            Signed in as {user?.email_address || user?.name || "support"} · Stats refresh on pull-down.
          </Text>
        </ScrollView>
      ) : null}
    </SafeAreaView>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <View style={styles.statRow}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>{value.toLocaleString()}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: "row", alignItems: "center", padding: space.md, gap: 8, borderBottomWidth: 1, borderBottomColor: colors.border },
  iconBtn: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  title: { flex: 1, fontSize: 18, fontWeight: "800", color: colors.text },
  scroll: { padding: space.xl, gap: 12, paddingBottom: 40 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 32, gap: 8 },
  errTitle: { fontSize: 17, fontWeight: "800", color: colors.text, marginTop: 8 },
  errBody: { fontSize: 13, color: colors.textMuted, textAlign: "center" },
  rec: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: colors.surface2, borderRadius: radius.xl, padding: 16, borderWidth: 2 },
  recTitle: { fontSize: 16, fontWeight: "800", letterSpacing: -0.2 },
  recBody: { fontSize: 13, color: colors.textMuted, marginTop: 4, lineHeight: 18 },
  sectionLabel: { fontSize: 12, color: colors.textMuted, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.5, marginTop: 8 },
  card: { backgroundColor: colors.surface2, borderRadius: radius.xl, padding: 16 },
  projRow: { flexDirection: "row", justifyContent: "space-around", paddingVertical: 4 },
  projItem: { alignItems: "center", gap: 4 },
  projNum: { fontSize: 24, fontWeight: "800", color: colors.text, letterSpacing: -0.5 },
  projLbl: { fontSize: 11, color: colors.textMuted, textTransform: "uppercase", letterSpacing: 0.4, fontWeight: "700" },
  footnote: { fontSize: 11.5, color: colors.textMuted, textAlign: "center", marginTop: 8 },
  costRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8, paddingVertical: 4 },
  costItem: { flex: 1, alignItems: "center" },
  costLabel: { fontSize: 11, color: colors.textMuted, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.4 },
  costAmt: { fontSize: 22, fontWeight: "800", color: colors.text, letterSpacing: -0.3, marginTop: 4 },
  savingsRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: colors.border, justifyContent: "center" },
  savingsText: { fontSize: 13, color: colors.text },
  statRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 8 },
  statLabel: { fontSize: 14, color: colors.text },
  statValue: { fontSize: 15, fontWeight: "800", color: colors.text, letterSpacing: -0.2 },
  divider: { height: 1, backgroundColor: colors.border, marginVertical: 4 },
  foot: { fontSize: 11.5, color: colors.textMuted, textAlign: "center", marginTop: 8, lineHeight: 17 },
});
