import React, { useEffect, useState, useRef } from "react";
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity, ScrollView,
  KeyboardAvoidingView, Platform, ActivityIndicator, Alert, Modal,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system";
import { AudioModule, useAudioRecorder, RecordingPresets } from "expo-audio";
import { api } from "../../src/api";
import { useAuth } from "../../src/auth";
import { colors, radius, space } from "../../src/theme";

type Attachment = { filename: string; type: string; content_b64: string; size: number };

export default function Compose() {
  const router = useRouter();
  const { user } = useAuth();
  const params = useLocalSearchParams<{ to?: string; subject?: string; inReplyTo?: string; threadId?: string; draftId?: string; body?: string }>();
  const [to, setTo] = useState(params.to || "");
  const [subject, setSubject] = useState(params.subject || "");
  const [body, setBody] = useState(params.body || "");
  const [atts, setAtts] = useState<Attachment[]>([]);
  const [sending, setSending] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [draftId, setDraftId] = useState<string | undefined>(params.draftId);
  const [draftSaved, setDraftSaved] = useState<string | null>(null);
  const [includeSignature, setIncludeSignature] = useState<boolean>(true);
  // Voice → Email state
  const audioRecorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const [isRecording, setIsRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [transcribing, setTranscribing] = useState(false);
  const recordingTimer = useRef<any>(null);
  const [aiMenuOpen, setAiMenuOpen] = useState(false);
  const [aiBusy, setAiBusy] = useState<string | null>(null);
  const [aiPromptOpen, setAiPromptOpen] = useState(false);
  const [aiPrompt, setAiPrompt] = useState("");
  const [subjectPicks, setSubjectPicks] = useState<string[]>([]);
  const [subjectPickerOpen, setSubjectPickerOpen] = useState(false);
  const autoSaveRef = useRef<any>(null);
  const initialLoad = useRef(true);

  // Load draft if draftId in params
  useEffect(() => {
    if (!params.draftId) return;
    (async () => {
      try {
        const d = await api<any>(`/mail/${params.draftId}`);
        setTo((d.to_addrs || []).join(", "));
        setSubject(d.subject || "");
        setBody(d.body || "");
        setAtts(d.attachments || []);
        setDraftId(d.id);
      } catch (e) { /* ignore */ }
    })();
  }, [params.draftId]);

  // Auto-save draft on changes (debounced)
  useEffect(() => {
    if (initialLoad.current) { initialLoad.current = false; return; }
    if (!to && !subject && !body) return;
    clearTimeout(autoSaveRef.current);
    autoSaveRef.current = setTimeout(saveDraft, 1500);
    return () => clearTimeout(autoSaveRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [to, subject, body]);

  const saveDraft = async () => {
    if (!user?.email_address) return;
    setSavingDraft(true);
    try {
      const payload = {
        id: draftId,
        to: to.split(/[,;\s]+/).map((s) => s.trim()).filter(Boolean),
        subject, body, attachments: atts,
      };
      const d = await api<any>("/mail/drafts", { method: "POST", body: JSON.stringify(payload) });
      setDraftId(d.id);
      setDraftSaved(new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }));
    } catch (e) { /* ignore */ }
    finally { setSavingDraft(false); }
  };

  const addImage = async () => {
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, base64: true, quality: 0.6 });
    if (res.canceled || !res.assets[0].base64) return;
    const a = res.assets[0];
    setAtts((p) => [...p, { filename: a.fileName || `image-${Date.now()}.jpg`, type: a.mimeType || "image/jpeg", content_b64: a.base64!, size: a.fileSize || (a.base64!.length * 0.75) }]);
  };

  const addFile = async () => {
    try {
      const res = await DocumentPicker.getDocumentAsync({ multiple: false });
      if (res.canceled || !res.assets?.[0]) return;
      const f = res.assets[0];
      const b64 = await FileSystem.readAsStringAsync(f.uri, { encoding: FileSystem.EncodingType.Base64 });
      setAtts((p) => [...p, { filename: f.name, type: f.mimeType || "application/octet-stream", content_b64: b64, size: f.size || b64.length * 0.75 }]);
    } catch (e: any) { Alert.alert("Couldn't attach", e.message); }
  };

  const removeAtt = (i: number) => setAtts((p) => p.filter((_, idx) => idx !== i));

  // ---------------- Voice → Email ----------------
  const startVoice = async () => {
    try {
      const perm = await AudioModule.requestRecordingPermissionsAsync();
      if (!perm.granted) {
        Alert.alert("Microphone access needed", "Enable microphone in Settings to dictate emails with W AI.");
        return;
      }
      await audioRecorder.prepareToRecordAsync();
      audioRecorder.record();
      setIsRecording(true);
      setRecordSeconds(0);
      recordingTimer.current = setInterval(() => setRecordSeconds((s) => s + 1), 1000);
    } catch (e: any) {
      Alert.alert("Couldn't start recording", e.message);
    }
  };

  const stopVoice = async () => {
    try {
      clearInterval(recordingTimer.current);
      recordingTimer.current = null;
      await audioRecorder.stop();
      setIsRecording(false);
      const uri = audioRecorder.uri;
      if (!uri) { Alert.alert("Nothing recorded"); return; }
      setTranscribing(true);
      const b64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
      const mime = Platform.OS === "ios" ? "audio/m4a" : "audio/m4a";
      const res = await api<{ transcript: string; subject: string; body: string }>("/ai/voice-to-email", {
        method: "POST",
        body: JSON.stringify({ audio_b64: b64, mime_type: mime, polish: true }),
      });
      if (res.subject && !subject.trim()) setSubject(res.subject);
      setBody((prev) => (prev.trim() ? `${prev.trim()}\n\n${res.body}` : res.body));
    } catch (e: any) {
      Alert.alert("Voice → email failed", e.message);
    } finally {
      setTranscribing(false);
    }
  };

  const cancelVoice = async () => {
    try {
      clearInterval(recordingTimer.current);
      recordingTimer.current = null;
      await audioRecorder.stop();
    } catch (_) {}
    setIsRecording(false);
    setRecordSeconds(0);
  };

  // ---------------- AI Compose / Rewrite ----------------
  const onAiDraft = async () => {
    const p = aiPrompt.trim();
    if (p.length < 3) { Alert.alert("Tell W AI what to write", "Add a quick prompt like 'thank Sam for the intro' or 'follow up on Friday meeting'."); return; }
    setAiBusy("draft");
    setAiPromptOpen(false);
    setAiMenuOpen(false);
    try {
      const res = await api<{ subject: string; body: string }>("/ai/compose-mail", {
        method: "POST",
        body: JSON.stringify({ prompt: p, tone: "professional" }),
      });
      if (res.subject && !subject.trim()) setSubject(res.subject);
      setBody((prev) => prev.trim() ? `${prev.trim()}\n\n${res.body}` : res.body);
      setAiPrompt("");
    } catch (e: any) { Alert.alert("AI couldn't draft", e.message); }
    finally { setAiBusy(null); }
  };

  const onRewrite = async (mode: "professional" | "friendly" | "shorten" | "expand" | "fix") => {
    if (!body.trim()) { Alert.alert("Write something first", "Add some text in the body for W AI to rewrite."); return; }
    setAiBusy(mode);
    setAiMenuOpen(false);
    try {
      const res = await api<{ text: string }>("/ai/rewrite", {
        method: "POST",
        body: JSON.stringify({ text: body, mode }),
      });
      setBody(res.text);
    } catch (e: any) { Alert.alert("AI couldn't rewrite", e.message); }
    finally { setAiBusy(null); }
  };

  const onSuggestSubject = async () => {
    if (!body.trim() || body.trim().length < 5) { Alert.alert("Add a body first", "Write a bit of body content and W AI will suggest 3 subjects."); return; }
    setAiBusy("subject");
    setAiMenuOpen(false);
    try {
      const res = await api<{ subjects: string[] }>("/ai/subject", { method: "POST", body: JSON.stringify({ body }) });
      if (!res.subjects?.length) { Alert.alert("No suggestions returned"); return; }
      setSubjectPicks(res.subjects);
      setSubjectPickerOpen(true);
    } catch (e: any) { Alert.alert("AI couldn't suggest", e.message); }
    finally { setAiBusy(null); }
  };

  const onSend = async () => {
    const toList = to.split(/[,;\s]+/).map((s) => s.trim()).filter(Boolean);
    if (!toList.length) { Alert.alert("Add a recipient"); return; }
    if (!subject.trim() && !body.trim()) { Alert.alert("Add a subject or body"); return; }
    setSending(true);
    clearTimeout(autoSaveRef.current);
    try {
      const DEFER_S = 15;
      const res = await api<any>("/mail/compose", {
        method: "POST",
        body: JSON.stringify({
          to: toList, subject: subject.trim(), body, attachments: atts,
          draft_id: draftId, in_reply_to: params.inReplyTo, thread_id: params.threadId,
          include_signature: includeSignature,
          defer_seconds: DEFER_S,
        }),
      });
      // Persist a pending undo handle for the inbox snackbar
      try {
        const AsyncStorage = (await import("@react-native-async-storage/async-storage")).default;
        await AsyncStorage.setItem("pendingUndo", JSON.stringify({
          id: res.id,
          expiresAt: Date.now() + DEFER_S * 1000,
          to: toList,
          subject: subject.trim() || "(no subject)",
        }));
      } catch {}
      closeCompose();
    } catch (e: any) { Alert.alert("Couldn't send", e.message); }
    finally { setSending(false); }
  };

  // Close the compose screen — go back if we have history; otherwise fall
  // back to the platform-appropriate inbox so users never get stuck.
  const closeCompose = () => {
    if (router.canGoBack && router.canGoBack()) { router.back(); return; }
    if (Platform.OS === "web" && typeof window !== "undefined" && window.innerWidth >= 720) {
      router.replace("/web/inbox" as any);
    } else {
      router.replace("/(tabs)/mail" as any);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={styles.header}>
          <TouchableOpacity onPress={closeCompose} style={styles.iconBtn} testID="compose-back">
            <Ionicons name="close" size={24} color={colors.text} />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>{params.inReplyTo ? "Reply" : "New email"}</Text>
            {(savingDraft || draftSaved) && (
              <Text style={styles.draftStatus} testID="draft-status">
                {savingDraft ? "Saving draft…" : `Saved ${draftSaved}`}
              </Text>
            )}
          </View>
          <TouchableOpacity onPress={saveDraft} style={styles.draftBtn} testID="save-draft-btn">
            <Ionicons name="archive-outline" size={18} color={colors.primary} />
          </TouchableOpacity>
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
            <TextInput style={styles.fieldInput} value={to} onChangeText={setTo} placeholder="someone@example.com" placeholderTextColor={colors.textMuted} autoCapitalize="none" autoCorrect={false} keyboardType="email-address" testID="compose-to" />
          </View>
          <View style={styles.field}>
            <Text style={styles.fieldLabel}>Subject</Text>
            <TextInput style={styles.fieldInput} value={subject} onChangeText={setSubject} placeholder="Subject" placeholderTextColor={colors.textMuted} testID="compose-subject" />
          </View>
          <TextInput style={styles.body} value={body} onChangeText={setBody} placeholder="Write your email…" placeholderTextColor={colors.textMuted} multiline textAlignVertical="top" testID="compose-body" />
          {!!user?.signature && (
            <TouchableOpacity
              onPress={() => setIncludeSignature(v => !v)}
              activeOpacity={0.7}
              style={styles.sigToggleRow}
              testID="signature-toggle"
            >
              <View style={[styles.sigCheckbox, includeSignature && styles.sigCheckboxOn]}>
                {includeSignature && <Ionicons name="checkmark" size={14} color="#fff" />}
              </View>
              <Text style={styles.sigToggleText}>
                {includeSignature ? "Signature will be appended" : "Signature is off for this email"}
              </Text>
              <Text style={styles.sigPeek} numberOfLines={1}>
                {includeSignature ? (user.signature as any) : ""}
              </Text>
            </TouchableOpacity>
          )}
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
            <TouchableOpacity style={styles.attBtn} onPress={() => setAiMenuOpen(true)} testID="compose-ai-magic">
              {aiBusy ? <ActivityIndicator color={colors.accent} size="small" /> : <Ionicons name="sparkles" size={18} color={colors.accent} />}
              <Text style={styles.attBtnText}>{aiBusy ? "Thinking…" : "W AI"}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.attBtn, isRecording && { backgroundColor: colors.danger }]}
              onPress={isRecording ? stopVoice : startVoice}
              disabled={transcribing}
              testID="compose-voice"
            >
              {transcribing ? (
                <>
                  <ActivityIndicator color={colors.accent} size="small" />
                  <Text style={styles.attBtnText}>Transcribing…</Text>
                </>
              ) : isRecording ? (
                <>
                  <Ionicons name="stop" size={18} color="#fff" />
                  <Text style={[styles.attBtnText, { color: "#fff" }]}>Stop · {String(Math.floor(recordSeconds/60)).padStart(1,"0")}:{String(recordSeconds%60).padStart(2,"0")}</Text>
                </>
              ) : (
                <>
                  <Ionicons name="mic" size={18} color={colors.accent} />
                  <Text style={styles.attBtnText}>Voice</Text>
                </>
              )}
            </TouchableOpacity>
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

      {/* AI Menu Modal */}
      <Modal visible={aiMenuOpen} transparent animationType="fade" onRequestClose={() => setAiMenuOpen(false)}>
        <TouchableOpacity activeOpacity={1} style={styles.modalBackdrop} onPress={() => setAiMenuOpen(false)} testID="ai-menu-backdrop">
          <TouchableOpacity activeOpacity={1} style={styles.sheet} onPress={() => {}}>
            <View style={styles.sheetHandle} />
            <View style={styles.sheetHeader}>
              <Ionicons name="sparkles" size={20} color={colors.accent} />
              <Text style={styles.sheetTitle}>W AI</Text>
              <View style={{ flex: 1 }} />
              <TouchableOpacity onPress={() => setAiMenuOpen(false)} testID="ai-menu-close"><Ionicons name="close" size={22} color={colors.textMuted} /></TouchableOpacity>
            </View>
            <Text style={styles.sheetSection}>Create</Text>
            <AiOption icon="create" label="Draft for me" subtitle="One-line prompt → full email" onPress={() => { setAiMenuOpen(false); setAiPromptOpen(true); }} testID="ai-draft-open" />
            <AiOption icon="reader" label="Suggest subject" subtitle="3 options from your body" onPress={onSuggestSubject} disabled={!body.trim()} testID="ai-suggest-subject" />
            <Text style={styles.sheetSection}>Rewrite</Text>
            <AiOption icon="briefcase" label="Make professional" onPress={() => onRewrite("professional")} disabled={!body.trim()} testID="ai-rewrite-pro" />
            <AiOption icon="happy" label="Make friendly" onPress={() => onRewrite("friendly")} disabled={!body.trim()} testID="ai-rewrite-friendly" />
            <AiOption icon="contract" label="Shorten" onPress={() => onRewrite("shorten")} disabled={!body.trim()} testID="ai-rewrite-shorten" />
            <AiOption icon="expand" label="Expand" onPress={() => onRewrite("expand")} disabled={!body.trim()} testID="ai-rewrite-expand" />
            <AiOption icon="checkmark-done" label="Fix grammar" onPress={() => onRewrite("fix")} disabled={!body.trim()} testID="ai-rewrite-fix" />
            <View style={{ height: 20 }} />
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {/* AI Draft Prompt Modal */}
      <Modal visible={aiPromptOpen} transparent animationType="slide" onRequestClose={() => setAiPromptOpen(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.modalBackdrop}>
          <View style={styles.promptSheet}>
            <View style={styles.sheetHeader}>
              <Ionicons name="sparkles" size={20} color={colors.accent} />
              <Text style={styles.sheetTitle}>Draft for me</Text>
              <View style={{ flex: 1 }} />
              <TouchableOpacity onPress={() => setAiPromptOpen(false)}><Ionicons name="close" size={22} color={colors.textMuted} /></TouchableOpacity>
            </View>
            <Text style={styles.promptHelp}>Describe what you want to write. Keep it short — like a text to a friend.</Text>
            <TextInput
              style={styles.promptInput}
              value={aiPrompt}
              onChangeText={setAiPrompt}
              placeholder={"e.g. 'Thank Sam for the intro and propose a call next week'"}
              placeholderTextColor={colors.textMuted}
              multiline
              autoFocus
              testID="ai-prompt-input"
            />
            <TouchableOpacity style={[styles.aiSubmit, (!aiPrompt.trim() || aiBusy) && { opacity: 0.5 }]} onPress={onAiDraft} disabled={!aiPrompt.trim() || !!aiBusy} testID="ai-prompt-submit">
              {aiBusy ? <ActivityIndicator color="#fff" /> : <>
                <Ionicons name="sparkles" size={16} color="#fff" />
                <Text style={styles.aiSubmitText}>Generate</Text>
              </>}
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Subject Picker Modal */}
      <Modal visible={subjectPickerOpen} transparent animationType="fade" onRequestClose={() => setSubjectPickerOpen(false)}>
        <TouchableOpacity activeOpacity={1} style={styles.modalBackdrop} onPress={() => setSubjectPickerOpen(false)} testID="subject-picker-backdrop">
          <TouchableOpacity activeOpacity={1} style={styles.sheet} onPress={() => {}}>
            <View style={styles.sheetHandle} />
            <View style={styles.sheetHeader}>
              <Ionicons name="reader" size={20} color={colors.accent} />
              <Text style={styles.sheetTitle}>Pick a subject</Text>
              <View style={{ flex: 1 }} />
              <TouchableOpacity onPress={() => setSubjectPickerOpen(false)} testID="subject-picker-close"><Ionicons name="close" size={22} color={colors.textMuted} /></TouchableOpacity>
            </View>
            <Text style={styles.sheetSection}>{subjectPicks.length} suggestion{subjectPicks.length === 1 ? "" : "s"} from W AI</Text>
            {subjectPicks.map((s, i) => (
              <TouchableOpacity
                key={i}
                style={styles.subjectPick}
                onPress={() => { setSubject(s); setSubjectPickerOpen(false); }}
                testID={`subject-pick-${i}`}
                activeOpacity={0.7}
              >
                <View style={styles.aiOptionIcon}><Text style={{ fontWeight: "800", color: colors.accent }}>{i + 1}</Text></View>
                <Text style={styles.subjectPickText}>{s}</Text>
                <Ionicons name="arrow-forward" size={18} color={colors.textMuted} />
              </TouchableOpacity>
            ))}
            <View style={{ height: 20 }} />
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </SafeAreaView>
  );
}

function AiOption({ icon, label, subtitle, onPress, disabled, testID }: any) {
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      style={[styles.aiOption, disabled && { opacity: 0.4 }]}
      testID={testID}
      activeOpacity={0.7}
    >
      <View style={styles.aiOptionIcon}><Ionicons name={icon} size={18} color={colors.accent} /></View>
      <View style={{ flex: 1 }}>
        <Text style={styles.aiOptionLabel}>{label}</Text>
        {!!subtitle && <Text style={styles.aiOptionSub}>{subtitle}</Text>}
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: "row", alignItems: "center", padding: space.md, gap: 8, borderBottomWidth: 1, borderBottomColor: colors.border },
  iconBtn: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 18, fontWeight: "800", color: colors.text },
  draftStatus: { fontSize: 11, color: colors.textMuted, marginTop: 2 },
  draftBtn: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface2 },
  sendBtn: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: colors.primary, paddingHorizontal: 16, paddingVertical: 10, borderRadius: radius.pill },
  sendText: { color: "#fff", fontWeight: "700" },
  fromRow: { flexDirection: "row", alignItems: "center", paddingHorizontal: space.lg, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.border, gap: 16 },
  fromValue: { color: colors.textMuted, flex: 1 },
  field: { paddingHorizontal: space.lg, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.border, flexDirection: "row", alignItems: "center", gap: 16 },
  fieldLabel: { width: 56, fontSize: 14, fontWeight: "700", color: colors.textMuted },
  fieldInput: { flex: 1, fontSize: 15, color: colors.text },
  body: { padding: space.lg, fontSize: 15, color: colors.text, minHeight: 220, lineHeight: 22 },
  sigHint: { fontSize: 12, color: colors.textMuted, paddingHorizontal: space.lg, fontStyle: "italic" },
  sigToggleRow: { flexDirection: "row", alignItems: "center", gap: 10, marginHorizontal: space.lg, paddingHorizontal: 12, paddingVertical: 10, backgroundColor: colors.surface2, borderRadius: radius.lg },
  sigCheckbox: { width: 20, height: 20, borderRadius: 5, borderWidth: 1.5, borderColor: colors.textMuted, alignItems: "center", justifyContent: "center" },
  sigCheckboxOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  sigToggleText: { fontSize: 12.5, fontWeight: "700", color: colors.text },
  sigPeek: { flex: 1, fontSize: 11.5, color: colors.textMuted, fontStyle: "italic", textAlign: "right" },
  attsWrap: { paddingHorizontal: space.lg, gap: 8, marginTop: 12 },
  attChip: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: colors.surface2, padding: 10, borderRadius: radius.md },
  attName: { flex: 1, fontSize: 13, color: colors.text },
  attBar: { flexDirection: "row", gap: 10, padding: space.lg, flexWrap: "wrap" },
  attBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 14, paddingVertical: 10, borderRadius: radius.pill, backgroundColor: colors.surface2 },
  attBtnText: { color: colors.text, fontWeight: "600" },
  // AI modal
  modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: space.lg, paddingTop: 10 },
  sheetHandle: { alignSelf: "center", width: 36, height: 4, borderRadius: 2, backgroundColor: colors.border, marginBottom: 14 },
  sheetHeader: { flexDirection: "row", alignItems: "center", gap: 8, paddingBottom: 8 },
  sheetTitle: { fontSize: 18, fontWeight: "800", color: colors.text },
  sheetSection: { fontSize: 11, fontWeight: "800", color: colors.textMuted, textTransform: "uppercase", letterSpacing: 0.5, marginTop: 14, marginBottom: 4 },
  aiOption: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12, paddingHorizontal: 4 },
  aiOptionIcon: { width: 34, height: 34, borderRadius: 17, backgroundColor: "#E8F5F7", alignItems: "center", justifyContent: "center" },
  aiOptionLabel: { fontSize: 15, fontWeight: "700", color: colors.text },
  aiOptionSub: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  // Subject picker
  subjectPick: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 14, paddingHorizontal: 10, borderRadius: radius.lg, backgroundColor: colors.surface2, marginTop: 8 },
  subjectPickText: { flex: 1, fontSize: 14.5, fontWeight: "600", color: colors.text, lineHeight: 20 },
  // Prompt sheet
  promptSheet: { backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: space.lg, gap: 12 },
  promptHelp: { fontSize: 13, color: colors.textMuted, lineHeight: 18 },
  promptInput: { backgroundColor: colors.surface2, borderRadius: radius.lg, padding: 14, fontSize: 15, color: colors.text, minHeight: 96, textAlignVertical: "top" },
  aiSubmit: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: colors.primary, paddingVertical: 14, borderRadius: radius.pill },
  aiSubmitText: { color: "#fff", fontWeight: "800", fontSize: 15 },
});
