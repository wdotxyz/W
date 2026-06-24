import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, ActivityIndicator, TouchableOpacity } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { api } from "../../src/api";
import { colors, radius, space } from "../../src/theme";

export default function BillingSuccess() {
  const router = useRouter();
  const params = useLocalSearchParams<{ session_id?: string }>();
  const [status, setStatus] = useState<"polling" | "paid" | "pending" | "error">("polling");
  const [tier, setTier] = useState<string>("");

  useEffect(() => {
    let cancelled = false;
    const sid = params.session_id as string;
    if (!sid) { setStatus("error"); return; }
    (async () => {
      for (let i = 0; i < 14; i++) {
        if (cancelled) return;
        try {
          const r = await api<{ status: string; tier?: string }>(`/billing/status/${sid}`);
          if (r.status === "paid") {
            setTier(r.tier || "");
            setStatus("paid");
            return;
          }
        } catch (_) {}
        await new Promise((res) => setTimeout(res, 2000));
      }
      if (!cancelled) setStatus("pending");
    })();
    return () => { cancelled = true; };
  }, [params.session_id]);

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <View style={styles.body}>
        {status === "polling" && <>
          <ActivityIndicator color={colors.accent} size="large" />
          <Text style={styles.title}>Confirming payment…</Text>
          <Text style={styles.sub}>Hold tight for a few seconds.</Text>
        </>}
        {status === "paid" && <>
          <View style={styles.iconWrap}>
            <Ionicons name="checkmark-circle" size={64} color={colors.success} />
          </View>
          <Text style={styles.title}>You&apos;re on W {tier.toUpperCase()}!</Text>
          <Text style={styles.sub}>Premium features are unlocked. Enjoy the extra space and the blue check.</Text>
        </>}
        {status === "pending" && <>
          <View style={styles.iconWrap}>
            <Ionicons name="time-outline" size={56} color={colors.accent} />
          </View>
          <Text style={styles.title}>Almost there</Text>
          <Text style={styles.sub}>Your payment is still processing. Your tier will update once Stripe confirms.</Text>
        </>}
        {status === "error" && <>
          <View style={styles.iconWrap}>
            <Ionicons name="alert-circle-outline" size={56} color={colors.danger} />
          </View>
          <Text style={styles.title}>Something went wrong</Text>
          <Text style={styles.sub}>We couldn&apos;t locate the checkout session.</Text>
        </>}
        <TouchableOpacity style={styles.cta} onPress={() => router.replace("/(tabs)/settings")} testID="back-to-settings">
          <Text style={styles.ctaText}>Back to W</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.surface },
  body: { flex: 1, padding: space.xl, alignItems: "center", justifyContent: "center" },
  iconWrap: { marginBottom: 16 },
  title: { fontSize: 24, fontWeight: "800", color: colors.text, textAlign: "center", marginTop: 16, letterSpacing: -0.4 },
  sub: { fontSize: 14, color: colors.textMuted, textAlign: "center", marginTop: 8, lineHeight: 21, marginHorizontal: 12 },
  cta: { marginTop: 28, backgroundColor: colors.primary, paddingVertical: 14, paddingHorizontal: 24, borderRadius: radius.xl },
  ctaText: { color: "#fff", fontWeight: "800", fontSize: 15 },
});
