import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, FlatList, TouchableOpacity, TextInput, ActivityIndicator, Alert } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { api } from "../src/api";
import { Avatar } from "./chats";
import { colors, space, radius } from "../src/theme";
import { smartBack } from "../src/utils/nav";

export default function NewGroup() {
  const router = useRouter();
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    api<any[]>("/users").then(setUsers).finally(() => setLoading(false));
  }, []);

  const toggle = (id: string) => {
    setSelected((s) => {
      const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n;
    });
  };

  const onCreate = async () => {
    if (!name.trim()) { Alert.alert("Group name required"); return; }
    if (selected.size < 1) { Alert.alert("Add at least 1 member"); return; }
    setCreating(true);
    try {
      const c = await api<any>("/chats", {
        method: "POST",
        body: JSON.stringify({ member_ids: Array.from(selected), is_group: true, name: name.trim() }),
      });
      router.replace(`/chat/${c.id}`);
    } finally { setCreating(false); }
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => smartBack(router)} style={styles.iconBtn} testID="newgroup-close">
          <Ionicons name="close" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.title}>New group</Text>
      </View>
      <View style={styles.nameBox}>
        <TextInput
          style={styles.nameInput}
          placeholder="Group name"
          placeholderTextColor={colors.textMuted}
          value={name}
          onChangeText={setName}
          maxLength={40}
          testID="group-name-input"
        />
      </View>
      <Text style={styles.section}>Members ({selected.size})</Text>
      {loading ? <ActivityIndicator color={colors.accent} style={{ marginTop: 30 }} /> : (
        <FlatList
          data={users}
          keyExtractor={(u) => u.id}
          renderItem={({ item }) => {
            const on = selected.has(item.id);
            return (
              <TouchableOpacity style={styles.row} onPress={() => toggle(item.id)} testID={`toggle-user-${item.id}`}>
                <Avatar uri={item.avatar} name={item.name || item.phone} ai={item.is_ai} size={48} />
                <View style={{ marginLeft: 12, flex: 1 }}>
                  <Text style={styles.name}>{item.name || item.phone}</Text>
                </View>
                <View style={[styles.check, on && styles.checkOn]}>
                  {on && <Ionicons name="checkmark" size={16} color="#fff" />}
                </View>
              </TouchableOpacity>
            );
          }}
          ItemSeparatorComponent={() => <View style={{ height: 1, backgroundColor: colors.border, marginLeft: 76 }} />}
        />
      )}
      <TouchableOpacity
        style={[styles.cta, (creating || !name.trim() || selected.size === 0) && { opacity: 0.5 }]}
        disabled={creating || !name.trim() || selected.size === 0}
        onPress={onCreate}
        testID="create-group-btn"
      >
        {creating ? <ActivityIndicator color="#fff" /> : <Text style={styles.ctaText}>Create group</Text>}
      </TouchableOpacity>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: "row", alignItems: "center", padding: space.md, gap: 8 },
  iconBtn: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 20, fontWeight: "800", color: colors.text },
  nameBox: { backgroundColor: colors.surface2, marginHorizontal: space.lg, borderRadius: radius.lg, paddingHorizontal: 14 },
  nameInput: { fontSize: 16, color: colors.text, paddingVertical: 14 },
  section: { paddingHorizontal: space.lg, paddingVertical: 12, color: colors.textMuted, fontWeight: "700", textTransform: "uppercase", fontSize: 12, letterSpacing: 1 },
  row: { flexDirection: "row", alignItems: "center", padding: space.md, paddingHorizontal: space.lg },
  name: { fontSize: 16, fontWeight: "600", color: colors.text },
  check: { width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: colors.border, alignItems: "center", justifyContent: "center" },
  checkOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  cta: { backgroundColor: colors.primary, padding: 16, borderRadius: radius.xl, alignItems: "center", margin: space.lg },
  ctaText: { color: "#fff", fontWeight: "700", fontSize: 16 },
});
