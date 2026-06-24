import React, { useEffect, useState, useCallback } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView,
  ActivityIndicator, RefreshControl, Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { api } from "../src/api";
import { colors, radius, space } from "../src/theme";

type Action = {
  title: string;
  due_date: string | null;
  type: "task" | "meeting" | "deadline" | string;
  source_thread_id: string;
  source_subject: string;
};

const TYPE_ICON: Record<string, any> = {
  task: "checkbox-outline",
  meeting: "calendar-outline",
  deadline: "alarm-outline",
};

function formatDue(due: string | null) {
  if (!due) return null;
  try {
    const d = new Date(due);
    if (isNaN(d.getTime())) return null;
    const now = new Date();
    const sameYear = d.getFullYear() === now.getFullYear();
    const datePart = d.toLocaleDateString([], {
      month: "short", day: "numeric", year: sameYear ? undefined : "numeric",
    });
    const hasTime = due.length > 10 && due.includes("T");
    if (hasTime) {
      const t = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
      return `${datePart} · ${t}`;
    }
    return datePart;
  } catch { return null; }
}

function isOverdue(due: string | null) {
  if (!due) return false;
  try {
    const d = new Date(due);
    return d.getTime() < Date.now();
  } catch { return false; }
}

export default function ActionsScreen() {
  const router = useRouter();
  const [actions, setActions] = useState<Action[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await api<{ actions: Action[] }>("/ai/actions");
      setActions(res.actions || []);
    } catch (e: any) { Alert.alert("Couldn't load actions", e.message); setActions([]); }
    finally { setLoading(false); setRefreshing(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn} testID="actions-back">
          <Ionicons name="chevron-back" size={26} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.title}>AI Assistant</Text>
        <TouchableOpacity onPress={() => { setRefreshing(true); load(); }} style={styles.iconBtn} testID="actions-refresh">
          <Ionicons name="refresh" size={22} color={colors.text} />
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
          <Text style={styles.hint}>W AI is scanning your recent mail…</Text>
        </View>
      ) : actions && actions.length > 0 ? (
        <ScrollView
          contentContainerStyle={styles.scroll}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.accent} />}
        >
          <View style={styles.heroCard}>
            <Ionicons name="sparkles" size={18} color={colors.accent} />
            <Text style={styles.heroText}>
              W AI scanned your inbox and surfaced {actions.length} {actions.length === 1 ? "thing" : "things"} you may need to act on.
            </Text>
          </View>

          {actions.map((a, i) => {
            const due = formatDue(a.due_date);
            const overdue = isOverdue(a.due_date);
            return (
              <TouchableOpacity
                key={`${a.source_thread_id}-${i}`}
                style={styles.actionCard}
                onPress={() => a.source_thread_id ? router.push(`/mail/thread/${a.source_thread_id}`) : undefined}
                activeOpacity={0.75}
                testID={`action-${i}`}
              >
                <View style={[styles.iconCircle, overdue && { backgroundColor: "#FCEFEF" }]}>
                  <Ionicons name={TYPE_ICON[a.type] || "ellipse-outline"} size={18} color={overdue ? colors.danger : colors.accent} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.actionTitle}>{a.title}</Text>
                  <View style={styles.metaRow}>
                    {due && (
                      <View style={[styles.duePill, overdue && styles.duePillOverdue]}>
                        <Ionicons name="time-outline" size={11} color={overdue ? "#fff" : colors.primary} />
                        <Text style={[styles.duePillText, overdue && { color: "#fff" }]}>{due}</Text>
                      </View>
                    )}
                    {!!a.source_subject && (
                      <Text style={styles.sourceText} numberOfLines={1}>· {a.source_subject}</Text>
                    )}
                  </View>
                </View>
                {!!a.source_thread_id && <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />}
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      ) : (
        <View style={styles.center}>
          <Ionicons name="checkmark-done-circle-outline" size={56} color={colors.textMuted} />
          <Text style={styles.emptyTitle}>You&apos;re all caught up</Text>
          <Text style={styles.emptySub}>W AI couldn&apos;t find any pending action items in your recent inbox.</Text>
          <TouchableOpacity onPress={() => { setRefreshing(true); load(); }} style={styles.refreshBtn} testID="actions-refresh-empty">
            <Ionicons name="refresh" size={16} color="#fff" />
            <Text style={styles.refreshText}>Rescan</Text>
          </TouchableOpacity>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: "row", alignItems: "center", padding: space.md, gap: 8, borderBottomWidth: 1, borderBottomColor: colors.border },
  iconBtn: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  title: { flex: 1, fontSize: 18, fontWeight: "800", color: colors.text },
  scroll: { padding: space.lg, gap: 10 },
  heroCard: { flexDirection: "row", alignItems: "center", gap: 10, padding: 14, backgroundColor: "#F1FAFC", borderRadius: radius.lg, borderWidth: 1, borderColor: "#B3E0E8", marginBottom: 4 },
  heroText: { flex: 1, color: colors.text, fontSize: 13, lineHeight: 18 },
  actionCard: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14, backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border },
  iconCircle: { width: 36, height: 36, borderRadius: 18, backgroundColor: "#E8F5F7", alignItems: "center", justifyContent: "center" },
  actionTitle: { fontSize: 14.5, fontWeight: "700", color: colors.text, lineHeight: 20 },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 6, flexWrap: "wrap" },
  duePill: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, backgroundColor: "#E8F5F7" },
  duePillOverdue: { backgroundColor: colors.danger },
  duePillText: { fontSize: 11, fontWeight: "700", color: colors.primary },
  sourceText: { flex: 1, fontSize: 11.5, color: colors.textMuted, marginLeft: 2 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: space.xl, gap: 12 },
  hint: { color: colors.textMuted, fontSize: 13 },
  emptyTitle: { fontSize: 18, fontWeight: "800", color: colors.text, marginTop: 6 },
  emptySub: { color: colors.textMuted, fontSize: 13, textAlign: "center", lineHeight: 19 },
  refreshBtn: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: colors.primary, paddingHorizontal: 18, paddingVertical: 10, borderRadius: 999, marginTop: 8 },
  refreshText: { color: "#fff", fontWeight: "800" },
});
