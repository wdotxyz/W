/**
 * Smart back navigation — the app has many deep-linkable routes
 * (/settings/account, /about, /mail/[id], /web/inbox, etc.). When a user
 * opens one of these directly (via URL or a fresh browser tab), the
 * history stack is empty and `router.back()` silently does nothing,
 * stranding them on the page.
 *
 * `smartBack(router)` falls back to the platform-appropriate root when
 * there's nothing to go back to, so users can always escape.
 */
import { Platform } from "react-native";
import type { Router } from "expo-router";

export function smartBack(router: Router) {
  try {
    if (router.canGoBack && router.canGoBack()) {
      router.back();
      return;
    }
  } catch { /* fall through to fallback */ }

  const isDesktopWeb =
    Platform.OS === "web" &&
    typeof window !== "undefined" &&
    window.innerWidth >= 720;

  router.replace((isDesktopWeb ? "/web/inbox" : "/(tabs)/mail") as any);
}
