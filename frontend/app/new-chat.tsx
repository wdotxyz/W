import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { api } from "../src/api";
import { Avatar } from "./chats";
import { colors, space, radius } from "../src/theme";

export default function NewChat() {
  const router = useRouter();
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    api<any[]>("/users").then(setUsers).finally(() => setLoading(false));
  }, []);

  const onPick = async (u: any) => {
    if (creating) return;
    setCreating(true);
    try {
      const c = await api<any>("/chats", {
        method: "POST",
        body: JSON.stringify({ member_ids: [u.id], is_group: false }),
      });
      router.replace(`/chat/${c.id}`);
    } finally { setCreating(false); }
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn} testID="newchat-close">
          <Ionicons name="close" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.title}>New chat</Text>
      </View>
      {loading ? <ActivityIndicator color={colors.accent} style={{ marginTop: 30 }} /> : (
        <FlatList
          data={users}
          keyExtractor={(u) => u.id}
          renderItem={({ item }) => (
            <TouchableOpacity style={styles.row} onPress={() => onPick(item)} testID={`pick-user-${item.id}`}>
              <Avatar uri={item.avatar} name={item.name || item.phone} ai={item.is_ai} size={48} />
              <View style={{ marginLeft: 12, flex: 1 }}>
                <Text style={styles.name}>{item.name || item.phone}</Text>
                <Text style={styles.about} numberOfLines={1}>{item.about}</Text>
              </View>
            </TouchableOpacity>
          )}
          ItemSeparatorComponent={() => <View style={{ height: 1, backgroundColor: colors.border, marginLeft: 76 }} />}
          ListEmptyComponent={<Text style={styles.empty}>No other users yet. Invite a friend to sign up!</Text>}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: "row", alignItems: "center", padding: space.md, gap: 8 },
  iconBtn: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 20, fontWeight: "800", color: colors.text },
  row: { flexDirection: "row", alignItems: "center", padding: space.lg },
  name: { fontSize: 16, fontWeight: "700", color: colors.text },
  about: { fontSize: 13, color: colors.textMuted, marginTop: 2 },
  empty: { textAlign: "center", color: colors.textMuted, marginTop: 60, paddingHorizontal: 40 },
});
