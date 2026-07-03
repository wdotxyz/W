import React, { useEffect } from "react";
import { Tabs, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "../../src/theme";
import { useAuth } from "../../src/auth";
import { useIsDesktop } from "../../src/hooks/useIsDesktop";

export default function TabsLayout() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const isDesktop = useIsDesktop();

  useEffect(() => {
    if (!loading && !user) {
      router.replace("/(auth)/signin");
    }
  }, [loading, user, router]);

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textMuted,
        // Hide the bottom tab bar on desktop web — the DesktopShell sidebar
        // already provides the same navigation, and duplicated nav feels off.
        tabBarStyle: isDesktop
          ? { display: "none" }
          : { borderTopColor: colors.border, height: 64, paddingTop: 6, paddingBottom: 8 },
        tabBarLabelStyle: { fontSize: 12, fontWeight: "600" },
      }}
    >
      <Tabs.Screen
        name="updates"
        options={{
          title: "Watch",
          tabBarIcon: ({ color, size }) => <Ionicons name="play-circle" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="mail"
        options={{
          title: "Inbox",
          tabBarIcon: ({ color, size }) => <Ionicons name="mail" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: "Settings",
          tabBarIcon: ({ color, size }) => <Ionicons name="person-circle" size={size} color={color} />,
        }}
      />
    </Tabs>
  );
}
