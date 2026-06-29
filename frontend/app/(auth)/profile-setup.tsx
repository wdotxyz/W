import React, { useState } from "react";
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity, KeyboardAvoidingView,
  Platform, Alert, ActivityIndicator, Image, ScrollView,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import { Ionicons } from "@expo/vector-icons";
import { api } from "../../src/api";
import { useAuth } from "../../src/auth";
import { colors, radius, space } from "../../src/theme";

const ABOUT_PRESETS = [
  "Available",
  "Busy",
  "At work",
  "Sleeping",
  "On vacation",
  "Focusing",
];

export default function ProfileSetup() {
  const router = useRouter();
  const { user, setUser } = useAuth();
  const [name, setName] = useState(user?.name || "");
  const [about, setAbout] = useState((user as any)?.about || "");
  const [avatar, setAvatar] = useState<string | null>(user?.avatar || null);
  const [saving, setSaving] = useState(false);

  const pickPhoto = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") {
      Alert.alert("Photos permission needed", "Enable photo library access in Settings to choose a profile picture.");
      return;
    }
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      base64: true,
      quality: 0.5,
      allowsEditing: true,
      aspect: [1, 1],
    });
    if (!res.canceled && res.assets[0].base64) {
      // Keep base64 under ~1.5 MB to stay within the MVP storage cap
      const sizeMB = (res.assets[0].base64.length * 0.75) / (1024 * 1024);
      if (sizeMB > 1.5) {
        Alert.alert("Image too large", "Please pick a smaller image (under ~1.5 MB) or crop it tighter.");
        return;
      }
      setAvatar(`data:image/jpeg;base64,${res.assets[0].base64}`);
    }
  };

  const onSave = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      const updated = await api<any>("/auth/profile", {
        method: "POST",
        body: JSON.stringify({ name: name.trim(), avatar, about: about.trim() || undefined }),
      });
      setUser(updated);
      router.replace("/(tabs)/mail");
    } catch (e: any) {
      Alert.alert("Error", e.message || "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const canGoBack = router.canGoBack();

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => (canGoBack ? router.back() : router.replace("/(auth)/signin"))}
          style={styles.iconBtn}
          testID="profile-setup-back"
          activeOpacity={0.7}
        >
          <Ionicons name="chevron-back" size={26} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Set up your profile</Text>
        <View style={{ width: 40 }} />
      </View>

      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          <Text style={styles.sub}>Add a photo, your name, and a status so people recognize you.</Text>

          <TouchableOpacity style={styles.avatarBtn} onPress={pickPhoto} testID="avatar-pick-btn" activeOpacity={0.85}>
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

          <Text style={styles.fieldLabel}>Your name</Text>
          <View style={styles.inputBox}>
            <TextInput
              style={styles.input}
              placeholder="e.g. Your name"
              placeholderTextColor={colors.textMuted}
              value={name}
              onChangeText={setName}
              maxLength={40}
              testID="profile-name-input"
            />
          </View>

          <Text style={styles.fieldLabel}>Status</Text>
          <View style={styles.inputBox}>
            <TextInput
              style={styles.input}
              placeholder="What are you up to?"
              placeholderTextColor={colors.textMuted}
              value={about}
              onChangeText={setAbout}
              maxLength={139}
              testID="profile-about-input"
            />
          </View>

          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.presetRow}>
            {ABOUT_PRESETS.map((p) => (
              <TouchableOpacity
                key={p}
                onPress={() => setAbout(p)}
                style={[styles.presetChip, about === p && styles.presetChipOn]}
                testID={`status-preset-${p}`}
                activeOpacity={0.7}
              >
                <Text style={[styles.presetText, about === p && { color: "#fff" }]}>{p}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </ScrollView>

        <View style={{ padding: space.xl }}>
          <TouchableOpacity
            style={[styles.cta, (saving || !name.trim()) && { opacity: 0.5 }]}
            disabled={saving || !name.trim()}
            onPress={onSave}
            testID="profile-save-btn"
            activeOpacity={0.85}
          >
            {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.ctaText}>Continue</Text>}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: "row", alignItems: "center", padding: space.md, gap: 8, borderBottomWidth: 1, borderBottomColor: colors.border },
  iconBtn: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  headerTitle: { flex: 1, fontSize: 17, fontWeight: "800", color: colors.text },
  flex: { flex: 1 },
  body: { padding: space.xl, paddingBottom: 40 },
  sub: { fontSize: 14, color: colors.textMuted, lineHeight: 20 },
  avatarBtn: { alignSelf: "center", marginTop: 24, marginBottom: 24 },
  avatarImg: { width: 110, height: 110, borderRadius: 55 },
  avatarPlaceholder: { width: 110, height: 110, borderRadius: 55, backgroundColor: colors.surface2, alignItems: "center", justifyContent: "center" },
  avatarBadge: { position: "absolute", bottom: 2, right: 2, width: 30, height: 30, borderRadius: 15, backgroundColor: colors.accent, alignItems: "center", justifyContent: "center", borderWidth: 3, borderColor: "#fff" },
  fieldLabel: { fontSize: 12, color: colors.textMuted, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.5, marginTop: 14, marginBottom: 6 },
  inputBox: { backgroundColor: colors.surface2, borderRadius: radius.lg, paddingHorizontal: 14 },
  input: { fontSize: 16, color: colors.text, paddingVertical: Platform.OS === "ios" ? 14 : 10, fontWeight: "600" },
  presetRow: { gap: 8, paddingVertical: 12, paddingRight: 8 },
  presetChip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.border },
  presetChipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  presetText: { fontSize: 13, color: colors.text, fontWeight: "700" },
  cta: { backgroundColor: colors.primary, padding: 16, borderRadius: radius.xl, alignItems: "center" },
  ctaText: { color: "#fff", fontSize: 16, fontWeight: "800" },
});
