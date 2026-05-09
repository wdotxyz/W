import React, { useEffect, useState, useCallback } from "react";
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, Image, RefreshControl, ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { api } from "../../src/api";
import { useAuth } from "../../src/auth";
import { colors, radius, space } from "../../src/theme";

const AI_USER_ID = "ai-assistant-wave";

export default function ChatsScreen() {
  const router = useRouter();
  const { subscribe, user } = useAuth();
  const [chats, setChats] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await api<any[]>("/chats");
      // Make sure AI chat exists
      const hasAi = data.some((c) => c.member_ids?.includes(AI_USER_ID));
      if (!hasAi) {
        const aiChat = await api<any>("/ai/start-chat", { method: "POST" });
        data.unshift(aiChat);
      }
      setChats(data);
    } catch (e) {
      console.warn(e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  useEffect(() => {
    return subscribe((msg: any) => {
      if (msg.type === "new_message") load();
    });
  }, [subscribe, load]);

  const renderItem = ({ item }: any) => {
    const isAi = item.member_ids?.includes(AI_USER_ID);
    const last = item.last_message;
    const lastText = !last
      ? (isAi ? "Tap to chat with Wave AI" : "Say hi 👋")
      : last.type === "image" ? "📷 Photo"
      : last.type === "voice" ? "🎤 Voice note"
      : last.content;
    return (
      <TouchableOpacity
        style={styles.row}
        onPress={() => router.push(`/chat/${item.id}`)}
        testID={`chat-row-${item.id}`}
        activeOpacity={0.7}
      >
        <Avatar uri={item.display_avatar} name={item.display_name} ai={isAi} />
        <View style={styles.rowMid}>
          <View style={styles.rowTop}>
            <Text style={styles.name} numberOfLines={1}>
              {item.display_name || "Chat"}
              {isAi && <Text style={styles.aiTag}>  · AI</Text>}
            </Text>
            {!!last && <Text style={styles.time}>{formatTime(last.created_at)}</Text>}
          </View>
          <View style={styles.rowBottom}>
            <Text style={styles.preview} numberOfLines={1}>{lastText}</Text>
            {item.unread > 0 && (
              <View style={styles.badge}><Text style={styles.badgeText}>{item.unread}</Text></View>
            )}
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.header}>
        <View>
          <Text style={styles.brand}>Wave</Text>
          <Text style={styles.welcome}>Hi {user?.name?.split(" ")[0] || "there"} 👋</Text>
        </View>
        <View style={styles.headerActions}>
          <TouchableOpacity style={styles.iconBtn} onPress={() => router.push("/new-group")} testID="new-group-btn">
            <Ionicons name="people" size={22} color={colors.primary} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.iconBtn} onPress={() => router.push("/new-chat")} testID="new-chat-btn">
            <Ionicons name="create" size={22} color={colors.primary} />
          </TouchableOpacity>
        </View>
      </View>

      {loading ? (
        <ActivityIndicator color={colors.accent} style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={chats}
          keyExtractor={(c) => c.id}
          renderItem={renderItem}
          ItemSeparatorComponent={() => <View style={styles.sep} />}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Ionicons name="chatbubbles-outline" size={48} color={colors.textMuted} />
              <Text style={styles.emptyTitle}>No chats yet</Text>
              <Text style={styles.emptySub}>Tap the pencil to start one.</Text>
            </View>
          }
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.accent} />}
          contentContainerStyle={{ paddingBottom: 40 }}
        />
      )}
    </SafeAreaView>
  );
}

export const Avatar = ({ uri, name, ai, size = 54 }: any) => {
  const initial = (name || "?").trim().charAt(0).toUpperCase();
  if (uri) {
    return (
      <View>
        <Image source={{ uri }} style={{ width: size, height: size, borderRadius: size / 2 }} />
        {ai && <View style={[styles.aiDot, { width: size * 0.32, height: size * 0.32, borderRadius: size }]}><Ionicons name="sparkles" size={size * 0.18} color="#fff" /></View>}
      </View>
    );
  }
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: ai ? colors.accent : colors.primaryLight, alignItems: "center", justifyContent: "center" }}>
      <Text style={{ color: "#fff", fontSize: size * 0.4, fontWeight: "700" }}>{initial}</Text>
      {ai && <View style={[styles.aiDot, { width: size * 0.32, height: size * 0.32, borderRadius: size }]}><Ionicons name="sparkles" size={size * 0.18} color="#fff" /></View>}
    </View>
  );
};

function formatTime(iso?: string) {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString())
    return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const diff = (now.getTime() - d.getTime()) / 86400000;
  if (diff < 7) return d.toLocaleDateString([], { weekday: "short" });
  return d.toLocaleDateString([], { day: "2-digit", month: "short" });
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.surface },
  header: { paddingHorizontal: space.xl, paddingVertical: space.md, flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  brand: { fontSize: 30, fontWeight: "800", color: colors.primary, letterSpacing: -0.5 },
  welcome: { fontSize: 13, color: colors.textMuted, marginTop: 2 },
  headerActions: { flexDirection: "row", gap: 8 },
  iconBtn: { width: 42, height: 42, borderRadius: 21, backgroundColor: colors.surface2, alignItems: "center", justifyContent: "center" },
  row: { flexDirection: "row", alignItems: "center", paddingHorizontal: space.xl, paddingVertical: 12 },
  rowMid: { flex: 1, marginLeft: 14 },
  rowTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  rowBottom: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 4 },
  name: { fontSize: 16, fontWeight: "700", color: colors.text, flex: 1 },
  aiTag: { color: colors.accent, fontWeight: "800", fontSize: 12 },
  time: { fontSize: 12, color: colors.textMuted, marginLeft: 8 },
  preview: { color: colors.textMuted, fontSize: 14, flex: 1 },
  badge: { backgroundColor: colors.accent, minWidth: 22, height: 22, borderRadius: 11, paddingHorizontal: 7, alignItems: "center", justifyContent: "center", marginLeft: 8 },
  badgeText: { color: "#fff", fontWeight: "800", fontSize: 11 },
  sep: { height: 1, backgroundColor: colors.border, marginLeft: 86 },
  empty: { alignItems: "center", marginTop: 80, paddingHorizontal: 40 },
  emptyTitle: { fontSize: 18, fontWeight: "700", color: colors.text, marginTop: 12 },
  emptySub: { color: colors.textMuted, marginTop: 4, textAlign: "center" },
  aiDot: { position: "absolute", bottom: -2, right: -2, backgroundColor: colors.accentGlow, borderWidth: 2, borderColor: "#fff", alignItems: "center", justifyContent: "center" },
});
