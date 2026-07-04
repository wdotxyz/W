/**
 * Web-only layout — the Gmail-style shell that hosts every /web/* screen.
 *
 * On mobile the /web routes are not reachable (index.tsx redirects native/mobile
 * to /(tabs)/mail). This layout assumes a wide viewport with mouse + keyboard.
 * The mobile Expo app never mounts this file.
 */
import React, { useEffect } from "react";
import { Stack, useRouter, usePathname } from "expo-router";
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors, radius } from "../../src/theme";
import { useAuth } from "../../src/auth";
import BrandMark from "../../src/components/BrandMark";
import { WebComposeProvider, useWebCompose } from "../../src/webCompose";
import WebComposePanel from "./_ComposePanel";

type Folder = {
  key: string;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  route: string;
};

const FOLDERS: Folder[] = [
  { key: "inbox",      label: "Inbox",      icon: "mail",         route: "/web/inbox" },
  { key: "starred",    label: "Starred",    icon: "star",         route: "/web/inbox?folder=starred" },
  { key: "snoozed",    label: "Snoozed",    icon: "time",         route: "/web/inbox?folder=snoozed" },
  { key: "sent",       label: "Sent",       icon: "paper-plane",  route: "/web/inbox?folder=sent" },
  { key: "drafts",     label: "Drafts",     icon: "document",     route: "/web/inbox?folder=drafts" },
  { key: "promotions", label: "Promos",     icon: "pricetag",     route: "/web/inbox?folder=promotions" },
  { key: "spam",       label: "Spam",       icon: "warning",      route: "/web/inbox?folder=spam" },
];

const SECONDARY = [
  { label: "Inbox",    icon: "mail"        as const, route: "/web/inbox" },
  { label: "Chat",     icon: "chatbubbles" as const, route: "/web/chats" },
  { label: "Contacts", icon: "people"      as const, route: "/web/contacts" },
];

export default function WebLayout() {
  return (
    <WebComposeProvider>
      <WebLayoutInner />
      <WebComposePanel />
    </WebComposeProvider>
  );
}

function WebLayoutInner() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname() || "";
  const { openCompose: openComposeCtx } = useWebCompose();

  // Any unauthenticated user shouldn't hit /web — bounce them to sign-in.
  useEffect(() => {
    if (!loading && !user) router.replace("/(auth)/signin");
  }, [loading, user, router]);

  const activeFolder = (() => {
    // read the ?folder= query directly off the URL when on web
    if (Platform.OS === "web" && typeof window !== "undefined") {
      const url = new URL(window.location.href);
      const f = url.searchParams.get("folder");
      if (f) return f;
    }
    return "inbox";
  })();

  const isInboxRoute = pathname.startsWith("/web/inbox") || pathname === "/web";

  const openCompose = () => openComposeCtx();

  return (
    <View style={styles.root} testID="web-shell">
      {/* TOP BAR ------------------------------------------------------------ */}
      <View style={styles.topBar}>
        <View style={styles.brand}>
          <BrandMark size={36} testID="web-brand-logo" />
        </View>

        <View style={styles.searchWrap}>
          <Ionicons name="search" size={18} color={colors.textMuted} />
          <Text style={styles.searchPlaceholder}>Search mail</Text>
        </View>

        <View style={styles.topRight}>
          {SECONDARY.map((s) => {
            const active =
              (s.route === "/web/chats"    && pathname.startsWith("/web/chat")) ||
              (s.route === "/web/contacts" && pathname.startsWith("/web/contacts")) ||
              (s.route === "/web/watch"    && pathname.startsWith("/web/watch")) ||
              (s.route === "/web/settings" && pathname.startsWith("/web/settings"));
            return (
              <TouchableOpacity
                key={s.label}
                onPress={() => router.push(s.route as any)}
                style={[styles.topIconBtn, active && styles.topIconBtnActive]}
                testID={`web-topbar-${s.label.toLowerCase()}`}
                activeOpacity={0.7}
              >
                <Ionicons
                  name={s.icon}
                  size={19}
                  color={active ? colors.primary : colors.textMuted}
                />
                <Text style={[styles.topIconLabel, active && styles.topIconLabelActive]}>{s.label}</Text>
              </TouchableOpacity>
            );
          })}

          <TouchableOpacity
            style={styles.avatarBtn}
            onPress={() => router.push("/web/settings")}
            testID="web-topbar-avatar"
          >
            <Text style={styles.avatarLetter}>
              {(user?.name || user?.email_address || "?").charAt(0).toUpperCase()}
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* BODY: SIDEBAR + CONTENT ------------------------------------------- */}
      <View style={styles.body}>
        {isInboxRoute && (
          <View style={styles.sidebar} testID="web-sidebar">
          <TouchableOpacity
            style={styles.composeBtn}
            onPress={openCompose}
            testID="web-compose-btn"
            activeOpacity={0.85}
          >
            <Ionicons name="create" size={20} color="#fff" />
            <Text style={styles.composeText}>Compose</Text>
          </TouchableOpacity>

          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 24 }} showsVerticalScrollIndicator={false}>
            {FOLDERS.map((f) => {
              const isActive = isInboxRoute && activeFolder === f.key;
              return (
                <TouchableOpacity
                  key={f.key}
                  onPress={() => router.push(f.route as any)}
                  style={[styles.sideRow, isActive && styles.sideRowActive]}
                  testID={`web-sidebar-${f.key}`}
                  activeOpacity={0.75}
                >
                  <Ionicons
                    name={f.icon}
                    size={18}
                    color={isActive ? colors.primary : colors.textMuted}
                  />
                  <Text style={[styles.sideLabel, isActive && styles.sideLabelActive]}>{f.label}</Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>
        )}

        <View style={styles.content}>
          <Stack screenOptions={{ headerShown: false, animation: "none" }} />
        </View>
      </View>
    </View>
  );
}

const SIDEBAR_WIDTH = 232;
const TOP_BAR_HEIGHT = 60;

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.surface2,
    ...(Platform.OS === "web" ? ({ minHeight: "100vh", overflow: "hidden" } as any) : {}),
  },
  topBar: {
    height: TOP_BAR_HEIGHT,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 24,
    gap: 16,
  },
  brand: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    width: SIDEBAR_WIDTH - 16,
  },
  searchWrap: {
    flex: 1,
    maxWidth: 720,
    backgroundColor: colors.surface2,
    borderRadius: radius.md,
    height: 40,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    gap: 10,
  },
  searchPlaceholder: { color: colors.textMuted, fontSize: 14 },
  topRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginLeft: "auto",
  },
  topIconBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radius.pill,
    ...(Platform.OS === "web" ? ({ cursor: "pointer" } as any) : {}),
  },
  topIconBtnActive: { backgroundColor: "#D6F0F4" },
  topIconLabel: { fontSize: 13, color: colors.textMuted, fontWeight: "600" },
  topIconLabelActive: { color: colors.primary, fontWeight: "700" },
  iconBtn: {
    width: 40, height: 40, borderRadius: 20,
    alignItems: "center", justifyContent: "center",
  },
  avatarBtn: {
    width: 34, height: 34, borderRadius: 17,
    backgroundColor: colors.primaryLight,
    alignItems: "center", justifyContent: "center",
    marginLeft: 8,
  },
  avatarLetter: { color: "#fff", fontWeight: "800", fontSize: 14 },
  body: {
    flex: 1,
    flexDirection: "row",
    minHeight: 0,
  },
  sidebar: {
    width: SIDEBAR_WIDTH,
    paddingHorizontal: 8,
    paddingTop: 12,
    paddingBottom: 12,
    backgroundColor: colors.surface2,
  },
  composeBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: colors.primary,
    borderRadius: radius.pill,
    paddingHorizontal: 20,
    paddingVertical: 12,
    marginBottom: 14,
    marginHorizontal: 4,
    ...(Platform.OS === "web"
      ? ({ boxShadow: "0 2px 8px rgba(11,59,96,0.18)" } as any)
      : {}),
  },
  composeText: { color: "#fff", fontSize: 15, fontWeight: "700" },
  sideRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingHorizontal: 18,
    paddingVertical: 9,
    borderRadius: radius.pill,
    marginBottom: 2,
  },
  sideRowActive: { backgroundColor: "#D6F0F4" },
  sideLabel: { fontSize: 14, color: colors.textMuted, fontWeight: "500" },
  sideLabelActive: { color: colors.primary, fontWeight: "700" },
  divider: { height: 1, backgroundColor: colors.border, marginVertical: 10, marginHorizontal: 12 },
  content: {
    flex: 1,
    backgroundColor: colors.surface,
    borderTopLeftRadius: 16,
    marginTop: 0,
    minWidth: 0,
    ...(Platform.OS === "web" ? ({ overflow: "hidden" } as any) : {}),
  },
});
