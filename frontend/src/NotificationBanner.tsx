import React, { useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, Animated, Platform } from "react-native";
import { useRouter, usePathname } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "../src/auth";
import { colors, radius, space } from "../src/theme";

const AI_USER_ID = "ai-assistant-wave";

type Banner = {
  chatId: string;
  title: string;
  body: string;
  isAi: boolean;
};

function playSound() {
  if (Platform.OS !== "web" || typeof window === "undefined") return;
  try {
    const AudioCtx = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "sine";
    o.frequency.setValueAtTime(880, ctx.currentTime);
    o.frequency.exponentialRampToValueAtTime(440, ctx.currentTime + 0.18);
    g.gain.setValueAtTime(0.001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.22);
    o.connect(g); g.connect(ctx.destination);
    o.start(); o.stop(ctx.currentTime + 0.25);
  } catch {}
}

export default function NotificationBanner() {
  const { user, subscribe } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [banner, setBanner] = useState<Banner | null>(null);
  const slideY = useRef(new Animated.Value(-100)).current;
  const hideTimer = useRef<any>(null);

  useEffect(() => {
    if (!user) return;
    return subscribe(async (msg: any) => {
      if (msg.type !== "new_message") return;
      const m = msg.message;
      if (!m || m.sender_id === user.id) return;

      // Don't show banner if user is currently viewing this chat
      if (pathname?.includes(`/chat/${msg.chat_id}`)) return;

      const notif: any = (user as any).notif || {};
      if (notif.mute_all) return;

      // Fetch chat metadata for display name
      let title = m.sender_name || "New message";
      let isAi = m.sender_id === AI_USER_ID;
      let body: string;
      if (m.type === "image") body = "📷 Photo";
      else if (m.type === "voice") body = "🎤 Voice note";
      else body = notif.show_preview === false ? "New message" : (m.content || "");

      // Respect sound prefs
      const isGroup = !!msg.is_group;
      const soundOk = isGroup ? notif.group_sounds !== false : notif.message_sounds !== false;
      if (soundOk) playSound();

      setBanner({ chatId: msg.chat_id, title, body, isAi });
      Animated.spring(slideY, { toValue: 0, useNativeDriver: true, bounciness: 6 }).start();
      clearTimeout(hideTimer.current);
      hideTimer.current = setTimeout(dismiss, 4000);
    });
  }, [subscribe, user, pathname, slideY]);

  const dismiss = () => {
    Animated.timing(slideY, { toValue: -120, duration: 220, useNativeDriver: true }).start(() => setBanner(null));
  };

  const open = () => {
    if (!banner) return;
    const id = banner.chatId;
    dismiss();
    router.push(`/chat/${id}`);
  };

  if (!banner) return null;

  return (
    <Animated.View pointerEvents="box-none" style={[styles.wrap, { transform: [{ translateY: slideY }] }]}>
      <TouchableOpacity activeOpacity={0.9} onPress={open} style={styles.card} testID="notif-banner">
        <View style={[styles.icon, banner.isAi && { backgroundColor: colors.accent }]}>
          <Ionicons name={banner.isAi ? "sparkles" : "chatbubble"} size={18} color="#fff" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.title} numberOfLines={1}>{banner.title}</Text>
          <Text style={styles.body} numberOfLines={2}>{banner.body}</Text>
        </View>
        <TouchableOpacity onPress={dismiss} style={styles.dismiss} testID="notif-dismiss">
          <Ionicons name="close" size={18} color={colors.textMuted} />
        </TouchableOpacity>
      </TouchableOpacity>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: "absolute", top: 0, left: 0, right: 0, paddingTop: Platform.OS === "ios" ? 50 : 24, paddingHorizontal: space.md, zIndex: 9999 },
  card: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: "#fff", padding: 12, borderRadius: radius.xl, borderWidth: 1, borderColor: colors.border, shadowColor: "#000", shadowOpacity: 0.12, shadowRadius: 16, shadowOffset: { width: 0, height: 6 }, elevation: 8 },
  icon: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" },
  title: { fontWeight: "800", color: colors.text, fontSize: 15 },
  body: { color: colors.textMuted, fontSize: 13, marginTop: 2 },
  dismiss: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },
});
