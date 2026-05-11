import React, { useState } from "react";
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity, ScrollView,
  KeyboardAvoidingView, Platform, ActivityIndicator, Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system";
import { api } from "../../src/api";
import { useAuth } from "../../src/auth";
import { colors, radius, space } from "../../src/theme";

type Attachment = { filename: string; type: string; content_b64: string; size: number };

export default function Compose() {
  const router = useRouter();
  const { user } = useAuth();
  const params = useLocalSearchParams<{ to?: string; subject?: string }>();
  const [to, setTo] = useState(params.to || "");
  const [subject, setSubject] = useState(params.subject || "");
  const [body, setBody] = useState("");
  const [atts, setAtts] = useState<Attachment[]>([]);
  const [sending, setSending] = useState(false);

  const addImage = async () => {
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images, base64: true, quality: 0.6,
    });
    if (res.canceled || !res.assets[0].base64) return;
    const a = res.assets[0];
    setAtts((p) => [...p, {
      filename: a.fileName || `image-${Date.now()}.jpg`,
      type: a.mimeType || "image/jpeg",
      content_b64: a.base64!,
      size: a.fileSize || (a.base64!.length * 0.75),
    }]);
  };

  const addFile = async () => {
    try {
      const res = await DocumentPicker.getDocumentAsync({ multiple: false });
      if (res.canceled || !res.assets?.[0]) return;
      const f = res.assets[0];
      const b64 = await FileSystem.readAsStringAsync(f.uri, { encoding: FileSystem.EncodingType.Base64 });
      setAtts((p) => [...p, {
        filename: f.name,
        type: f.mimeType || "application/octet-stream",
        content_b64: b64,
        size: f.size || b64.length * 0.75,
      }]);
    } catch (e: any) { Alert.alert("Couldn't attach", e.message); }
  };

  const removeAtt = (i: number) => setAtts((p) => p.filter((_, idx) => idx !== i));

  const onSend = async () => {
    const toList = to.split(/[,;\s]+/).map((s) => s.trim()).filter(Boolean);
    if (!toList.length) { Alert.alert("Add a recipient"); return; }
    if (!subject.trim() && !body.trim()) { Alert.alert("Add a subject or body"); return; }
    setSending(true);
    try {
      const res = await api<any>("/mail/compose", {
        method: "POST",
        body: JSON.stringify({ to: toList, subject: subject.trim(), body, attachments: atts }),
      });
      if (res.delivery_status === "sent") {
        Alert.alert("Sent ✓", "Your email is on its way.");
      } else if (res.delivery_status === "saved_no_provider") {
        Alert.alert("Saved to Sent", "SendGrid isn't configured yet — your email is in the Sent folder.");
      } else {
        Alert.alert("Delivery issue", res.delivery_error || res.delivery_status);
      }
      router.back();
    } catch (e: any) {
      Alert.alert("Couldn't send", e.message);
    } finally { setSending(false); }
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn} testID="compose-back">
            <Ionicons name="close" size={24} color={colors.text} />
          </TouchableOpacity>
          <Text style={styles.title}>New email</Text>
          <TouchableOpacity onPress={onSend} disabled={sending} style={styles.sendBtn} testID="compose-send">
            {sending ? <ActivityIndicator color="#fff" /> : <>
              <Ionicons name="send" size={16} color="#fff" />
              <Text style={styles.sendText}>Send</Text>
            </>}
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={{ paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
          <View style={styles.fromRow}>
            <Text style={styles.fieldLabel}>From</Text>
            <Text style={styles.fromValue}>{user?.email_address}</Text>
          </View>

          <View style={styles.field}>
            <Text style={styles.fieldLabel}>To</Text>
            <TextInput
              style={styles.fieldInput}
              value={to}
              onChangeText={setTo}
              placeholder="someone@example.com"
              placeholderTextColor={colors.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              testID="compose-to"
            />
          </View>

          <View style={styles.field}>
            <Text style={styles.fieldLabel}>Subject</Text>
            <TextInput
              style={styles.fieldInput}
              value={subject}
              onChangeText={setSubject}
              placeholder="Subject"
              placeholderTextColor={colors.textMuted}
              testID="compose-subject"
            />
          </View>

          <TextInput
            style={styles.body}
            value={body}
            onChangeText={setBody}
            placeholder="Write your email…"
            placeholderTextColor={colors.textMuted}
            multiline
            textAlignVertical="top"
            testID="compose-body"
          />

          {!!atts.length && (
            <View style={styles.attsWrap}>
              {atts.map((a, i) => (
                <View key={i} style={styles.attChip} testID={`compose-att-${i}`}>
                  <Ionicons name="document" size={16} color={colors.accent} />
                  <Text style={styles.attName} numberOfLines={1}>{a.filename}</Text>
                  <TouchableOpacity onPress={() => removeAtt(i)} testID={`remove-att-${i}`}>
                    <Ionicons name="close-circle" size={18} color={colors.textMuted} />
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          )}

          <View style={styles.attBar}>
            <TouchableOpacity style={styles.attBtn} onPress={addImage} testID="compose-attach-image">
              <Ionicons name="image" size={18} color={colors.accent} />
              <Text style={styles.attBtnText}>Photo</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.attBtn} onPress={addFile} testID="compose-attach-file">
              <Ionicons name="attach" size={18} color={colors.accent} />
              <Text style={styles.attBtnText}>File</Text>
            </TouchableOpacity>
          </View>
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
  sendBtn: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: colors.primary, paddingHorizontal: 16, paddingVertical: 10, borderRadius: radius.pill },
  sendText: { color: "#fff", fontWeight: "700" },
  fromRow: { flexDirection: "row", alignItems: "center", paddingHorizontal: space.lg, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.border, gap: 16 },
  fromValue: { color: colors.textMuted, flex: 1 },
  field: { paddingHorizontal: space.lg, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.border, flexDirection: "row", alignItems: "center", gap: 16 },
  fieldLabel: { width: 56, fontSize: 14, fontWeight: "700", color: colors.textMuted },
  fieldInput: { flex: 1, fontSize: 15, color: colors.text },
  body: { padding: space.lg, fontSize: 15, color: colors.text, minHeight: 240, lineHeight: 22 },
  attsWrap: { paddingHorizontal: space.lg, gap: 8 },
  attChip: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: colors.surface2, padding: 10, borderRadius: radius.md },
  attName: { flex: 1, fontSize: 13, color: colors.text },
  attBar: { flexDirection: "row", gap: 10, padding: space.lg },
  attBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 14, paddingVertical: 10, borderRadius: radius.pill, backgroundColor: colors.surface2 },
  attBtnText: { color: colors.text, fontWeight: "600" },
});
