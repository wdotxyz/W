import React from "react";
import { View, ActivityIndicator, StyleSheet, Platform } from "react-native";
import { Redirect } from "expo-router";
import { useAuth } from "../src/auth";
import { colors } from "../src/theme";
import BrandMark from "../src/components/BrandMark";
import { useIsDesktop } from "../src/hooks/useIsDesktop";

/**
 * Return `true` when the current URL host starts with "mail." (e.g. the
 * `mail.wplatforms.xyz` subdomain). Users landing there always go straight
 * to the mail inbox, no marketing detour.
 */
function isMailSubdomain(): boolean {
  if (Platform.OS !== "web") return false;
  if (typeof window === "undefined" || !window.location) return false;
  return window.location.hostname.toLowerCase().startsWith("mail.");
}

export default function Index() {
  const { user, loading } = useAuth();
  const isDesktop = useIsDesktop();

  if (loading) {
    return (
      <View style={styles.c}>
        <BrandMark size={72} style={{ marginBottom: 20 }} />
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }
  if (!user) return <Redirect href="/(auth)/signin" />;
  if (!user.name) return <Redirect href="/(auth)/profile-setup" />;

  // mail.wplatforms.xyz (or any "mail." subdomain) always opens the inbox
  // portal — users are here specifically for mail.
  if (isMailSubdomain()) return <Redirect href="/web/inbox" />;

  // Desktop browsers get the dedicated Gmail-style web app.
  // Mobile browsers, tablets, and the native app continue to use the
  // touch-first tab layout — identical to before.
  if (Platform.OS === "web" && isDesktop) return <Redirect href="/web/inbox" />;
  return <Redirect href="/(tabs)/mail" />;
}

const styles = StyleSheet.create({
  c: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface },
});
