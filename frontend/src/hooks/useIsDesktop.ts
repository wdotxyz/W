/**
 * useIsDesktop — returns true when the app is rendered in a wide viewport
 * (typically a browser on laptop/desktop). Native platforms always return false,
 * so mobile behavior is preserved exactly.
 *
 * Breakpoint: 900px — chosen because that's where a 2-column mail/chat layout
 * becomes actually useful (below that, list + detail crowd each other).
 */
import { Platform, useWindowDimensions } from "react-native";

export const DESKTOP_BREAKPOINT = 900;

export function useIsDesktop(): boolean {
  const { width } = useWindowDimensions();
  if (Platform.OS !== "web") return false;
  return width >= DESKTOP_BREAKPOINT;
}
