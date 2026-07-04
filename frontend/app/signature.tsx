import React, { useState, useEffect } from "react";
import { View, Text, StyleSheet, TextInput, TouchableOpacity, KeyboardAvoidingView, Platform, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { api } from "../src/api";
import { useAuth } from "../src/auth";
import { colors, radius, space } from "../src/theme";
import { smartBack } from "../src/utils/nav";

export default function SignatureScreen() {
  const router = useRouter();
  const { user, setUser } = useAuth();
  const [sig, setSig] = useState<string>((user as any)?.signature || "");
  const [saving, setSaving] = useState(false);

  const onSave = async () => {
    setSaving(true);
    try {
      const res = await api<{ signature: string }>("/auth/signature", {
        method: "PATCH",
        body: JSON.stringify({ signature: sig }),
      });
      if (user) setUser({ ...user, signature: res.signature } as any);
      smartBack(router);
    } finally { setSaving(false); }
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => smartBack(router)} style={styles.iconBtn} testID="sig-back">
            <Ionicons name="chevron-back" size={26} color={colors.text} />
          </TouchableOpacity>
          <Text style={styles.title}>Email signature</Text>
          <TouchableOpacity onPress={onSave} disabled={saving} style={styles.saveBtn} testID="sig-save-btn">
            {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveText}>Save</Text>}
          </TouchableOpacity>
        </View>
        <Text style={styles.hint}>Appended to every email you send. Leave empty to disable.</Text>
        <TextInput
          style={styles.area}
          value={sig}
          onChangeText={setSig}
          placeholder={"e.g. — Jonny\nFounder, W"}
          placeholderTextColor={colors.textMuted}
          multiline
          textAlignVertical="top"
          maxLength={1000}
          testID="signature-input"
        />
        <Text style={styles.counter}>{sig.length}/1000</Text>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: "row", alignItems: "center", padding: space.md, gap: 8, borderBottomWidth: 1, borderBottomColor: colors.border },
  iconBtn: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  title: { flex: 1, fontSize: 18, fontWeight: "800", color: colors.text },
  saveBtn: { backgroundColor: colors.primary, paddingHorizontal: 16, paddingVertical: 10, borderRadius: radius.pill },
  saveText: { color: "#fff", fontWeight: "700" },
  hint: { color: colors.textMuted, fontSize: 13, padding: space.lg },
  area: { marginHorizontal: space.lg, padding: 14, backgroundColor: colors.surface2, borderRadius: radius.lg, fontSize: 15, color: colors.text, minHeight: 220, lineHeight: 22 },
  counter: { textAlign: "right", color: colors.textMuted, fontSize: 12, paddingHorizontal: space.lg, marginTop: 6 },
});
