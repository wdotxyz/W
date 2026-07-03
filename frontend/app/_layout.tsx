import React from "react";
import { Stack, usePathname } from "expo-router";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { StatusBar } from "expo-status-bar";
import { AuthProvider, useAuth } from "../src/auth";
import NotificationBanner from "../src/NotificationBanner";
import DesktopShell from "../src/components/DesktopShell";
import { useIsDesktop } from "../src/hooks/useIsDesktop";

/**
 * Paths where the desktop shell should NOT wrap the content:
 *   - unauthenticated auth screens (own layout / branding)
 *   - the landing "index" screen
 *   - fullscreen modals we want to render edge-to-edge
 */
function shouldSkipShell(path: string) {
  if (!path || path === "/") return true;
  if (path.startsWith("/(auth)")) return true;
  if (path.startsWith("/signin") || path.startsWith("/signup")) return true;
  if (path.startsWith("/two-factor")) return true;
  return false;
}

/**
 * Certain screens want to occupy the full width of the content column even
 * on desktop (e.g. an active chat conversation). This lets us disable the
 * max-width cap for them.
 */
function isFullBleed(path: string) {
  if (!path) return false;
  return path.startsWith("/chat/") || path.startsWith("/mail/compose");
}

function ShellWrapper({ children }: { children: React.ReactNode }) {
  const isDesktop = useIsDesktop();
  const pathname = usePathname() || "";
  const { user } = useAuth();

  if (!isDesktop) return <>{children}</>;
  if (!user) return <>{children}</>;
  if (shouldSkipShell(pathname)) return <>{children}</>;

  return <DesktopShell fullBleed={isFullBleed(pathname)}>{children}</DesktopShell>;
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <AuthProvider>
          <StatusBar style="dark" />
          <ShellWrapper>
            <Stack screenOptions={{ headerShown: false, animation: "slide_from_right" }}>
              <Stack.Screen name="index" />
              <Stack.Screen name="(auth)" />
              <Stack.Screen name="(tabs)" />
              <Stack.Screen name="chat/[id]" />
              <Stack.Screen name="new-chat" options={{ presentation: "modal" }} />
              <Stack.Screen name="new-group" options={{ presentation: "modal" }} />
              <Stack.Screen name="notification-settings" />
              <Stack.Screen name="signature" />
              <Stack.Screen name="mail" />
            </Stack>
          </ShellWrapper>
          <NotificationBanner />
        </AuthProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
