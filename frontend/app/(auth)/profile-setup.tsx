import React, { useState } from "react";
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity, KeyboardAvoidingView, Platform, Alert, ActivityIndicator, Image,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import { Ionicons } from "@expo/vector-icons";
import { api } from "../../src/api";
import { useAuth } from "../../src/auth";
import { colors, radius, space } from "../../src/theme";

export default function ProfileSetup() {
  const router = useRouter();
  const { user, setUser } = useAuth();
  const [name, setName] = useState(user?.name || "");
  const [avatar, setAvatar] = useState<string | null>(user?.avatar || null);
  const [saving, setSaving] = useState(false);

  const pickPhoto = async () => {
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      base64: true, quality: 0.6, allowsEditing: true, aspect: [1, 1],
    });
    if (!res.canceled && res.assets[0].base64) {
      setAvatar(`data:image/jpeg;base64,${res.assets[0].base64}`);
    }
  };

  const onSave = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      const updated = await api<any>("/auth/profile", {
        method: "POST",
        body: JSON.stringify({ name: name.trim(), avatar }),
      });
      setUser(updated);
      router.replace("/(tabs)/chats");
    } catch (e: any) {
      Alert.alert("Error", e.message || "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : "height"}>
        <View style={styles.body}>
          <Text style={styles.title}>Set up your profile</Text>
          <Text style={styles.sub}>Add a photo and name so friends recognize you.</Text>

          <TouchableOpacity style={styles.avatarBtn} onPress={pickPhoto} testID="avatar-pick-btn">
            {avatar ? (
              <Image source={{ uri: avatar }} style={styles.avatarImg} />
            ) : (
              <View style={styles.avatarPlaceholder}>
                <Ionicons name="camera" size={28} color={colors.accent} />
              </View>
            )}
            <View style={styles.avatarBadge}>
              <Ionicons name="add" size={16} color="#fff" />
            </View>
          </TouchableOpacity>

          <View style={styles.inputBox}>
            <TextInput
              style={styles.input}
              placeholder="Your name"
              placeholderTextColor={colors.textMuted}
              value={name}
              onChangeText={setName}
              maxLength={40}
              testID="profile-name-input"
            />
          </View>
        </View>

        <TouchableOpacity
          style={[styles.cta, (saving || !name.trim()) && { opacity: 0.5 }]}
          disabled={saving || !name.trim()}
          onPress={onSave}
          testID="profile-save-btn"
        >
          {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.ctaText}>Continue</Text>}
        </TouchableOpacity>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.surface },
  flex: { flex: 1, padding: space.xl },
  body: { flex: 1, marginTop: 32 },
  title: { fontSize: 28, fontWeight: "800", color: colors.text, letterSpacing: -0.5 },
  sub: { fontSize: 15, color: colors.textMuted, marginTop: 6 },
  avatarBtn: { alignSelf: "center", marginTop: 36, marginBottom: 32 },
  avatarImg: { width: 120, height: 120, borderRadius: 60 },
  avatarPlaceholder: {
    width: 120, height: 120, borderRadius: 60, backgroundColor: colors.surface2,
    alignItems: "center", justifyContent: "center",
  },
  avatarBadge: {
    position: "absolute", bottom: 4, right: 4,
    width: 32, height: 32, borderRadius: 16, backgroundColor: colors.accent,
    alignItems: "center", justifyContent: "center", borderWidth: 3, borderColor: "#fff",
  },
  inputBox: { backgroundColor: colors.surface2, borderRadius: radius.lg, paddingHorizontal: 14 },
  input: { fontSize: 17, color: colors.text, paddingVertical: 16 },
  cta: { backgroundColor: colors.primary, padding: 18, borderRadius: radius.xl, alignItems: "center" },
  ctaText: { color: "#fff", fontSize: 17, fontWeight: "700" },
});
