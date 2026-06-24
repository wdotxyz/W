import React, { useState } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView, TextInput, Alert,
  KeyboardAvoidingView, Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "../../src/auth";
import { colors, radius, space } from "../../src/theme";

export default function ChangePhoneScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const [phone, setPhone] = useState("");

  const onContinue = () => {
    const trimmed = phone.trim();
    if (!trimmed || trimmed.length < 6) {
      Alert.alert("Enter a valid number", "Please include the country code, e.g. +1 555 123 4567.");
      return;
    }
    Alert.alert(
      "Verify your new number",
      `We\u2019ll text a code to ${trimmed} to confirm it\u2019s yours. Phone number change is rolling out soon.`,
      [{ text: "OK" }],
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn} testID="change-phone-back">
          <Ionicons name="chevron-back" size={26} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.title}>Change phone number</Text>
        <View style={{ width: 40 }} />
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <View style={styles.hero}>
            <View style={styles.iconWrap}><Ionicons name="call" size={28} color={colors.accent} /></View>
            <Text style={styles.heroTitle}>Update your number</Text>
            <Text style={styles.heroBody}>Your chats, mail, and contacts stay intact — only the phone number on your account changes.</Text>
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>Current number</Text>
            <View style={styles.readonly}>
              <Ionicons name="call-outline" size={18} color={colors.textMuted} />
              <Text style={styles.readonlyText}>{user?.phone || "Not set"}</Text>
            </View>
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>New phone number</Text>
            <View style={styles.input}>
              <Ionicons name="call" size={18} color={colors.accent} />
              <TextInput
                style={styles.inputText}
                value={phone}
                onChangeText={setPhone}
                placeholder="+1 555 123 4567"
                placeholderTextColor={colors.textMuted}
                keyboardType="phone-pad"
                autoFocus
                testID="new-phone-input"
              />
            </View>
            <Text style={styles.help}>Include the country code. We\u2019ll text you a 6-digit code to verify it.</Text>
          </View>

          <TouchableOpacity onPress={onContinue} style={styles.cta} activeOpacity={0.85} testID="send-code-btn">
            <Text style={styles.ctaText}>Send verification code</Text>
            <Ionicons name="arrow-forward" size={18} color="#fff" />
          </TouchableOpacity>

          <Text style={styles.foot}>
            Phone change rolls out alongside SMS-based 2FA. Today, this saves your new number for verification once the backend is live.
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: "row", alignItems: "center", padding: space.md, gap: 8, borderBottomWidth: 1, borderBottomColor: colors.border },
  iconBtn: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  title: { flex: 1, fontSize: 18, fontWeight: "800", color: colors.text },
  scroll: { padding: space.xl, gap: 18 },
  hero: { backgroundColor: colors.surface2, borderRadius: radius.xl, padding: 18, alignItems: "center" },
  iconWrap: { width: 56, height: 56, borderRadius: 28, backgroundColor: "#E8F5F7", alignItems: "center", justifyContent: "center", marginBottom: 10 },
  heroTitle: { fontSize: 17, fontWeight: "800", color: colors.text, textAlign: "center" },
  heroBody: { fontSize: 13, color: colors.textMuted, textAlign: "center", lineHeight: 18, marginTop: 4 },
  field: { gap: 8 },
  label: { fontSize: 12, color: colors.textMuted, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.5 },
  readonly: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: colors.surface2, padding: 14, borderRadius: radius.lg },
  readonlyText: { fontSize: 15, color: colors.textMuted, fontWeight: "600" },
  input: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: colors.surface2, paddingHorizontal: 14, paddingVertical: Platform.OS === "ios" ? 14 : 6, borderRadius: radius.lg, borderWidth: 1.5, borderColor: "#D6E5EA" },
  inputText: { flex: 1, fontSize: 16, color: colors.text, fontWeight: "600" },
  help: { fontSize: 12, color: colors.textMuted, lineHeight: 17 },
  cta: { backgroundColor: colors.primary, borderRadius: radius.xl, paddingVertical: 14, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  ctaText: { color: "#fff", fontSize: 15, fontWeight: "800" },
  foot: { fontSize: 11.5, color: colors.textMuted, textAlign: "center", lineHeight: 16 },
});
