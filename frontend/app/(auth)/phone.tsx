import React, { useState } from "react";
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity,
  KeyboardAvoidingView, Platform, Alert, ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { api } from "../../src/api";
import { colors, radius, space } from "../../src/theme";

export default function PhoneScreen() {
  const router = useRouter();
  const [phone, setPhone] = useState("");
  const [country, setCountry] = useState("+1");
  const [loading, setLoading] = useState(false);

  const onContinue = async () => {
    const full = `${country}${phone.replace(/\D/g, "")}`;
    if (phone.length < 6) {
      Alert.alert("Invalid phone", "Please enter a valid phone number.");
      return;
    }
    setLoading(true);
    try {
      const res = await api<{ dev_otp: string }>("/auth/send-otp", {
        method: "POST",
        body: JSON.stringify({ phone: full }),
      });
      router.push({ pathname: "/(auth)/otp", params: { phone: full, devOtp: res.dev_otp } });
    } catch (e: any) {
      Alert.alert("Error", e.message || "Failed to send OTP");
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : "height"}>
        <TouchableOpacity onPress={() => router.back()} style={styles.back} testID="phone-back-btn">
          <Ionicons name="chevron-back" size={26} color={colors.text} />
        </TouchableOpacity>
        <View style={styles.body}>
          <Text style={styles.title}>Your phone number</Text>
          <Text style={styles.sub}>We'll send a 6-digit code to verify it's you.</Text>
          <View style={styles.row}>
            <View style={styles.country}>
              <TextInput
                style={styles.countryInput}
                value={country}
                onChangeText={setCountry}
                maxLength={5}
                keyboardType="phone-pad"
                testID="phone-country-input"
              />
            </View>
            <View style={styles.phoneBox}>
              <TextInput
                style={styles.phoneInput}
                value={phone}
                onChangeText={setPhone}
                placeholder="Phone number"
                placeholderTextColor={colors.textMuted}
                keyboardType="phone-pad"
                autoFocus
                testID="phone-input"
              />
            </View>
          </View>
          <Text style={styles.hint}>Dev mode: OTP will be shown on the next screen.</Text>
        </View>
        <TouchableOpacity
          style={[styles.cta, (loading || !phone) && { opacity: 0.5 }]}
          disabled={loading || !phone}
          onPress={onContinue}
          testID="phone-continue-btn"
        >
          {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.ctaText}>Continue</Text>}
        </TouchableOpacity>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.surface },
  flex: { flex: 1, padding: space.xl },
  back: { width: 44, height: 44, alignItems: "center", justifyContent: "center", marginLeft: -8 },
  body: { flex: 1, marginTop: space.lg },
  title: { fontSize: 28, fontWeight: "800", color: colors.text, letterSpacing: -0.5 },
  sub: { fontSize: 15, color: colors.textMuted, marginTop: 6, marginBottom: 32 },
  row: { flexDirection: "row", gap: 10 },
  country: { backgroundColor: colors.surface2, borderRadius: radius.lg, paddingHorizontal: 10, justifyContent: "center", width: 72 },
  countryInput: { fontSize: 18, color: colors.text, fontWeight: "600", textAlign: "center" },
  phoneBox: { flex: 1, backgroundColor: colors.surface2, borderRadius: radius.lg, paddingHorizontal: 14 },
  phoneInput: { fontSize: 18, color: colors.text, paddingVertical: 16, fontWeight: "500" },
  hint: { color: colors.textMuted, fontSize: 13, marginTop: 14 },
  cta: { backgroundColor: colors.primary, padding: 18, borderRadius: radius.xl, alignItems: "center" },
  ctaText: { color: "#fff", fontSize: 17, fontWeight: "700" },
});
