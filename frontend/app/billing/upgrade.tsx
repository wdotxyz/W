import React, { useEffect, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, Alert, Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as WebBrowser from "expo-web-browser";
import { api } from "../../src/api";
import { useAuth } from "../../src/auth";
import { colors, radius, space } from "../../src/theme";
import { SHOW_PREMIUM } from "../../src/featureFlags";
import { smartBack } from "../../src/utils/nav";

type Plan = {
  tier: "free" | "plus" | "pro";
  label: string;
  monthly: number;
  yearly: number;
  storage_gb: number;
  perks: string[];
};

function PremiumComingSoon() {
  const router = useRouter();
  return (
    <SafeAreaView style={comingSoonStyles.safe} edges={["top", "bottom"]}>
      <View style={comingSoonStyles.header}>
        <TouchableOpacity onPress={() => smartBack(router)} style={comingSoonStyles.iconBtn} testID="premium-back">
          <Ionicons name="chevron-back" size={26} color={colors.text} />
        </TouchableOpacity>
        <Text style={comingSoonStyles.title}>W Premium</Text>
        <View style={{ width: 40 }} />
      </View>
      <View style={comingSoonStyles.body} testID="premium-coming-soon">
        <View style={comingSoonStyles.iconWrap}><Ionicons name="star" size={36} color={colors.accent} /></View>
        <Text style={comingSoonStyles.heroTitle}>Premium is on the way</Text>
        <Text style={comingSoonStyles.heroSub}>
          We&apos;re polishing the experience before opening up paid plans. Stay tuned — everything you love about W is fully free during the MVP.
        </Text>
        <TouchableOpacity onPress={() => smartBack(router)} style={comingSoonStyles.cta} activeOpacity={0.85}>
          <Text style={comingSoonStyles.ctaText}>Got it</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const comingSoonStyles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: "row", alignItems: "center", padding: space.md, gap: 8, borderBottomWidth: 1, borderBottomColor: colors.border },
  iconBtn: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  title: { flex: 1, fontSize: 18, fontWeight: "800", color: colors.text },
  body: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 32, gap: 16 },
  iconWrap: { width: 80, height: 80, borderRadius: 40, backgroundColor: "#E8F5F7", alignItems: "center", justifyContent: "center" },
  heroTitle: { fontSize: 22, fontWeight: "800", color: colors.text, textAlign: "center", letterSpacing: -0.3 },
  heroSub: { fontSize: 14.5, color: colors.textMuted, textAlign: "center", lineHeight: 21 },
  cta: { backgroundColor: colors.primary, borderRadius: radius.xl, paddingVertical: 14, paddingHorizontal: 32, marginTop: 12 },
  ctaText: { color: "#fff", fontWeight: "800", fontSize: 15 },
});

export default function UpgradeScreen() {
  if (!SHOW_PREMIUM) {
    return <PremiumComingSoon />;
  }
  return <UpgradeScreenInner />;
}

function UpgradeScreenInner() {
  const router = useRouter();
  const { user } = useAuth();
  const [plans, setPlans] = useState<Plan[] | null>(null);
  const [billing, setBilling] = useState<any>(null);
  const [interval, setInterval] = useState<"month" | "year">("month");
  const [busy, setBusy] = useState<string | null>(null);
  const [openTip, setOpenTip] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [p, me] = await Promise.all([
          api<{ plans: Plan[] }>("/billing/plans"),
          api<any>("/billing/me").catch(() => null),
        ]);
        setPlans(p.plans);
        setBilling(me);
      } catch (e) { console.warn("plans load:", e); }
    })();
  }, []);

  const currentTier = (billing?.tier as string) || "free";

  const onChoose = async (tier: "plus" | "pro") => {
    if (busy) return;
    setBusy(tier);
    try {
      const res = await api<{ url: string; session_id: string }>("/billing/checkout", {
        method: "POST",
        body: JSON.stringify({ tier, interval }),
      });
      if (Platform.OS === "web") {
        // Same window — Stripe redirects back to /billing/success
        // @ts-ignore
        window.location.assign(res.url);
        return;
      }
      const result = await WebBrowser.openAuthSessionAsync(res.url, "");
      if (result.type === "success" || result.type === "dismiss") {
        // Poll for confirmation
        await pollStatus(res.session_id, tier);
      }
    } catch (e: any) {
      Alert.alert("Couldn't start checkout", e?.message || "Please try again.");
    } finally { setBusy(null); }
  };

  const pollStatus = async (sessionId: string, tier: string) => {
    for (let i = 0; i < 12; i++) {
      try {
        const s = await api<{ status: string; tier?: string }>(`/billing/status/${sessionId}`);
        if (s.status === "paid") {
          Alert.alert("You're upgraded!", `Welcome to W ${tier.toUpperCase()}.`);
          const me = await api<any>("/billing/me");
          setBilling(me);
          return;
        }
      } catch (_) {}
      await new Promise((r) => setTimeout(r, 1500));
    }
    Alert.alert("Pending", "Your payment is still processing. We'll update your tier once Stripe confirms.");
  };

  if (!plans) {
    return (
      <SafeAreaView style={[styles.safe, { alignItems: "center", justifyContent: "center" }]}>
        <ActivityIndicator color={colors.accent} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => smartBack(router)} style={styles.back} testID="upgrade-back-btn">
          <Ionicons name="chevron-back" size={26} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>W Premium</Text>
        <View style={styles.back} />
      </View>
      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        <Text style={styles.title}>W for Way more</Text>

        {/* Billing-interval toggle */}
        <View style={styles.intervalRow}>
          {(["month", "year"] as const).map((opt) => (
            <TouchableOpacity
              key={opt}
              onPress={() => setInterval(opt)}
              style={[styles.intervalPill, interval === opt && styles.intervalPillActive]}
              testID={`interval-${opt}`}
            >
              <Text style={[styles.intervalText, interval === opt && styles.intervalTextActive]}>
                {opt === "month" ? "Monthly" : "Yearly"}
              </Text>
              {opt === "year" && (
                <View style={styles.saveBadge}><Text style={styles.saveBadgeText}>SAVE</Text></View>
              )}
            </TouchableOpacity>
          ))}
        </View>

        {plans.map((p) => {
          const price = interval === "month" ? p.monthly : p.yearly;
          const isCurrent = p.tier === currentTier;
          const isFree = p.tier === "free";
          const featured = p.tier === "plus";
          return (
            <View key={p.tier} style={[styles.card, featured && styles.cardFeatured, isCurrent && styles.cardCurrent]}>
              {featured && !isCurrent && (
                <View style={styles.popular}><Text style={styles.popularText}>POPULAR</Text></View>
              )}
              {isCurrent && (
                <View style={[styles.popular, { backgroundColor: colors.success }]}>
                  <Text style={styles.popularText}>CURRENT</Text>
                </View>
              )}
              <View style={styles.cardHead}>
                <Text style={styles.planLabel}>{p.label}</Text>
                {(p.tier === "plus" || p.tier === "pro") && (
                  <Ionicons name="checkmark-circle" size={18} color="#1DA1F2" />
                )}
              </View>
              <View style={styles.priceRow}>
                <Text style={styles.priceAmount}>{isFree ? "Always Free" : `$${price.toFixed(2)}`}</Text>
                {!isFree && (
                  <Text style={styles.pricePeriod}>{interval === "month" ? "/ month" : "/ year"}</Text>
                )}
              </View>
              {p.perks.map((perk) => {
                const [perkLabel, perkInfo] = perk.includes("|") ? perk.split("|", 2) : [perk, ""];
                const tipKey = `${p.tier}::${perkLabel}`;
                const tipOpen = openTip === tipKey;
                return (
                  <View key={perk} style={styles.perkWrap}>
                    <View style={styles.perkRow}>
                      <Ionicons name="checkmark" size={16} color={colors.accent} />
                      <Text style={styles.perkText}>{perkLabel}</Text>
                      {perkInfo ? (
                        <TouchableOpacity
                          onPress={() => setOpenTip(tipOpen ? null : tipKey)}
                          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                          testID={`perk-info-${perkLabel}`}
                        >
                          <Ionicons
                            name={tipOpen ? "information-circle" : "information-circle-outline"}
                            size={16}
                            color={tipOpen ? colors.accent : colors.textMuted}
                          />
                        </TouchableOpacity>
                      ) : null}
                    </View>
                    {tipOpen && perkInfo ? (
                      <TouchableOpacity
                        onPress={() => setOpenTip(null)}
                        activeOpacity={0.95}
                        style={styles.tooltip}
                        testID={`perk-tip-${perkLabel}`}
                      >
                        <Text style={styles.tooltipText}>{perkInfo}</Text>
                      </TouchableOpacity>
                    ) : null}
                  </View>
                );
              })}
              {!isFree && (
                <TouchableOpacity
                  onPress={() => onChoose(p.tier as "plus" | "pro")}
                  disabled={busy !== null || isCurrent}
                  style={[
                    styles.cta,
                    isCurrent && styles.ctaDisabled,
                    !isCurrent && featured && styles.ctaPrimary,
                  ]}
                  testID={`upgrade-${p.tier}-btn`}
                  activeOpacity={0.85}
                >
                  {busy === p.tier ? (
                    <ActivityIndicator color={featured ? "#fff" : colors.primary} />
                  ) : isCurrent ? (
                    <Text style={[styles.ctaText, { color: colors.textMuted }]}>You&apos;re on this plan</Text>
                  ) : (
                    <Text style={[styles.ctaText, featured && { color: "#fff" }]}>
                      {currentTier === "free" ? `Get ${p.label}` : currentTier === "plus" && p.tier === "pro" ? "Upgrade to Pro" : `Switch to ${p.label}`}
                    </Text>
                  )}
                </TouchableOpacity>
              )}
            </View>
          );
        })}

        <Text style={styles.fineprint}>
          One-time charge for {interval === "month" ? "30 days" : "1 year"} of access. Renews manually — no auto-charge in this preview. Test card: <Text style={{ fontWeight: "700" }}>4242 4242 4242 4242</Text>.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 8, paddingVertical: 6, borderBottomWidth: 0.5, borderBottomColor: colors.border },
  back: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  headerTitle: { flex: 1, textAlign: "center", fontSize: 16, fontWeight: "700", color: colors.text },
  body: { padding: space.xl, paddingBottom: 36 },

  title: { fontSize: 26, fontWeight: "800", color: colors.text, letterSpacing: -0.5, marginTop: 4 },
  sub: { fontSize: 14, color: colors.textMuted, marginTop: 8, lineHeight: 21 },

  intervalRow: { flexDirection: "row", backgroundColor: colors.surface2, borderRadius: 999, padding: 4, marginTop: 18, alignSelf: "center" },
  intervalPill: { flexDirection: "row", alignItems: "center", paddingVertical: 8, paddingHorizontal: 18, borderRadius: 999, gap: 6 },
  intervalPillActive: { backgroundColor: colors.surface, shadowColor: "#000", shadowOpacity: 0.06, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 2 },
  intervalText: { color: colors.textMuted, fontWeight: "700", fontSize: 13 },
  intervalTextActive: { color: colors.text },
  saveBadge: { backgroundColor: colors.success, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  saveBadgeText: { color: "#fff", fontSize: 9, fontWeight: "800", letterSpacing: 0.5 },

  card: { borderWidth: 1.5, borderColor: colors.surface2, borderRadius: 18, padding: 18, marginTop: 18, backgroundColor: colors.surface },
  cardFeatured: { borderColor: colors.accent },
  cardCurrent: { borderColor: colors.success },
  popular: { position: "absolute", top: -10, right: 16, backgroundColor: colors.accent, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  popularText: { color: "#fff", fontSize: 10, fontWeight: "800", letterSpacing: 0.5 },

  cardHead: { flexDirection: "row", alignItems: "center", gap: 6 },
  planLabel: { fontSize: 20, fontWeight: "800", color: colors.text, letterSpacing: -0.3 },
  priceRow: { flexDirection: "row", alignItems: "baseline", marginTop: 4 },
  priceAmount: { fontSize: 17, fontWeight: "700", color: colors.text, letterSpacing: -0.2 },
  pricePeriod: { color: colors.textMuted, fontSize: 11.5, fontWeight: "600", marginLeft: 4 },
  perkRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 8 },
  perkWrap: {},
  perkText: { fontSize: 14, color: colors.text },
  tooltip: {
    marginTop: 6,
    marginLeft: 24,
    padding: 10,
    backgroundColor: colors.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
  },
  tooltipText: { fontSize: 12.5, color: colors.textMuted, lineHeight: 18 },

  cta: { marginTop: 16, paddingVertical: 12, borderRadius: radius.xl, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface2 },
  ctaPrimary: { backgroundColor: colors.accent },
  ctaDisabled: { opacity: 0.6 },
  ctaText: { color: colors.primary, fontWeight: "800", fontSize: 14 },

  fineprint: { textAlign: "center", color: colors.textMuted, fontSize: 11.5, marginTop: 20, lineHeight: 18 },

  storageCard: { marginTop: 18, padding: 14, backgroundColor: colors.surface2, borderRadius: radius.xl },
  storageHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  storageTitle: { fontSize: 13, fontWeight: "800", color: colors.text, letterSpacing: 0.3, textTransform: "uppercase" },
  storageStat: { fontSize: 13, color: colors.textMuted, fontWeight: "700" },
  storageTrack: { height: 8, backgroundColor: "#E2E8F0", borderRadius: 4, marginTop: 10, overflow: "hidden" },
  storageFill: { height: "100%", backgroundColor: colors.accent, borderRadius: 4 },
  storageHint: { fontSize: 12, color: colors.textMuted, marginTop: 8 },
});
