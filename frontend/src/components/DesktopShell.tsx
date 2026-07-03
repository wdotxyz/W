/**
 * DesktopShell — the left-sidebar + centered-content wrapper used on wide
 * web viewports. Renders nothing extra on mobile (the child is returned as-is).
 *
 * The sidebar mirrors the mobile bottom tabs so users can jump between
 * Inbox / Chats / Contacts / Watch / Settings at any time without going
 * through a hamburger menu.
 */
import React from "react";
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter, usePathname } from "expo-router";
import { colors, radius } from "../theme";
import { useIsDesktop } from "../hooks/useIsDesktop";
import { useAuth } from "../auth";

type NavItem = {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  route: string;
  match: (path: string) => boolean;
};

const NAV: NavItem[] = [
  {
    label: "Inbox",
    icon: "mail",
    route: "/(tabs)/mail",
    match: (p) => p.startsWith("/mail") || p === "/" || p.includes("(tabs)/mail"),
  },
  {
    label: "Chats",
    icon: "chatbubbles",
    route: "/chats",
    match: (p) => p.startsWith("/chat") || p === "/chats",
  },
  {
    label: "Contacts",
    icon: "people",
    route: "/contacts",
    match: (p) => p.startsWith("/contacts"),
  },
  {
    label: "Watch",
    icon: "play-circle",
    route: "/(tabs)/updates",
    match: (p) => p.includes("updates"),
  },
  {
    label: "Settings",
    icon: "person-circle",
    route: "/(tabs)/settings",
    match: (p) => p.includes("settings"),
  },
];

type Props = {
  children: React.ReactNode;
  /** If true, the content column is not width-capped (used by full-bleed screens like chat). */
  fullBleed?: boolean;
};

export default function DesktopShell({ children, fullBleed = false }: Props) {
  const isDesktop = useIsDesktop();
  const router = useRouter();
  const pathname = usePathname() || "";
  const { user } = useAuth();

  if (!isDesktop) return <>{children}</>;

  return (
    <View style={styles.root} testID="desktop-shell">
      <View style={styles.sidebar} testID="desktop-sidebar">
        <View style={styles.brand}>
          <View style={styles.brandDot}>
            <Text style={styles.brandLetter}>W</Text>
          </View>
          <Text style={styles.brandName}>W</Text>
        </View>

        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingVertical: 8 }}>
          {NAV.map((n) => {
            const active = n.match(pathname);
            return (
              <TouchableOpacity
                key={n.route}
                style={[styles.navItem, active && styles.navItemActive]}
                onPress={() => router.push(n.route as any)}
                testID={`sidebar-nav-${n.label.toLowerCase()}`}
                activeOpacity={0.75}
              >
                <Ionicons
                  name={n.icon}
                  size={20}
                  color={active ? colors.primary : colors.textMuted}
                />
                <Text style={[styles.navLabel, active && styles.navLabelActive]}>{n.label}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        {!!user && (
          <TouchableOpacity
            style={styles.userBox}
            onPress={() => router.push("/(tabs)/settings" as any)}
            testID="sidebar-user"
          >
            <View style={styles.userAvatar}>
              <Text style={styles.userAvatarTxt}>{(user.name || user.email_address || "?").charAt(0).toUpperCase()}</Text>
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.userName} numberOfLines={1}>{user.name || "You"}</Text>
              <Text style={styles.userMail} numberOfLines={1}>{user.email_address || user.email || ""}</Text>
            </View>
          </TouchableOpacity>
        )}
      </View>

      <View style={styles.mainCol}>
        <View style={[styles.contentArea, !fullBleed && styles.contentAreaCapped]}>{children}</View>
      </View>
    </View>
  );
}

const SIDEBAR_WIDTH = 260;
const CONTENT_MAX = 1180;

const styles = StyleSheet.create({
  root: {
    flex: 1,
    flexDirection: "row",
    backgroundColor: colors.surface2,
    ...(Platform.OS === "web" ? ({ minHeight: "100vh" } as any) : {}),
  },
  sidebar: {
    width: SIDEBAR_WIDTH,
    backgroundColor: "#fff",
    borderRightWidth: 1,
    borderRightColor: colors.border,
    paddingHorizontal: 12,
    paddingTop: 22,
    paddingBottom: 16,
  },
  brand: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 8,
    paddingBottom: 22,
  },
  brandDot: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  brandLetter: { color: "#fff", fontWeight: "800", fontSize: 17 },
  brandName: { fontSize: 20, fontWeight: "800", color: colors.text, letterSpacing: -0.5 },
  navItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 11,
    borderRadius: radius.md,
    marginBottom: 2,
  },
  navItemActive: { backgroundColor: colors.surface2 },
  navLabel: { fontSize: 15, color: colors.textMuted, fontWeight: "600" },
  navLabelActive: { color: colors.text, fontWeight: "700" },
  userBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 10,
    borderRadius: radius.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    marginTop: 4,
    paddingTop: 12,
  },
  userAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.primaryLight,
    alignItems: "center",
    justifyContent: "center",
  },
  userAvatarTxt: { color: "#fff", fontWeight: "800", fontSize: 14 },
  userName: { fontSize: 13, fontWeight: "700", color: colors.text },
  userMail: { fontSize: 11, color: colors.textMuted, marginTop: 1 },
  mainCol: {
    flex: 1,
    alignItems: "center",
    backgroundColor: colors.surface2,
    minWidth: 0,
  },
  contentArea: {
    flex: 1,
    width: "100%",
    backgroundColor: colors.surface,
  },
  contentAreaCapped: {
    maxWidth: CONTENT_MAX,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: colors.border,
  },
});
