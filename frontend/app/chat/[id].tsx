import React, { useEffect, useState, useRef, useCallback } from "react";
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity, FlatList, Image,
  KeyboardAvoidingView, Platform, ImageBackground, ActivityIndicator, Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { AudioModule, useAudioRecorder, useAudioPlayer, RecordingPresets } from "expo-audio";
import * as FileSystem from "expo-file-system";
import { api } from "../../src/api";
import { useAuth } from "../../src/auth";
import { Avatar } from "../(tabs)/chats";
import { colors, radius, space } from "../../src/theme";

const AI_USER_ID = "ai-assistant-wave";
const BG = "https://static.prod-images.emergentagent.com/jobs/0a6fb986-57f6-4143-b026-cc3c8d533f4c/images/5dda163c1d940a241699ed3e8a222f28e5989b3a896ee5168284d6ed020ea7bb.png";

export default function ChatScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { user, subscribe, send } = useAuth();
  const [messages, setMessages] = useState<any[]>([]);
  const [chat, setChat] = useState<any>(null);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [typingUser, setTypingUser] = useState<string | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [recordSecs, setRecordSecs] = useState(0);
  const recorder = useAudioRecorder(RecordingPresets.LOW_QUALITY);
  const flatRef = useRef<FlatList>(null);
  const recordTimer = useRef<any>(null);

  const isAi = chat?.member_ids?.includes(AI_USER_ID);

  const load = useCallback(async () => {
    try {
      const chats = await api<any[]>("/chats");
      const c = chats.find((x) => x.id === id);
      setChat(c);
      const msgs = await api<any[]>(`/chats/${id}/messages`);
      setMessages(msgs);
      setTimeout(() => flatRef.current?.scrollToEnd({ animated: false }), 100);
    } catch (e) {
      console.warn(e);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    return subscribe((m: any) => {
      if (m.type === "new_message" && m.chat_id === id) {
        setMessages((prev) => prev.some((x) => x.id === m.message.id) ? prev : [...prev, m.message]);
        setTimeout(() => flatRef.current?.scrollToEnd({ animated: true }), 100);
      } else if (m.type === "typing" && m.chat_id === id && m.user_id !== user?.id) {
        setTypingUser(m.is_typing ? m.user_id : null);
      }
    });
  }, [subscribe, id, user?.id]);

  const onSendText = async () => {
    if (!text.trim() || sending) return;
    const t = text;
    setText("");
    setSending(true);
    try {
      const msg = await api<any>(`/chats/${id}/messages`, {
        method: "POST",
        body: JSON.stringify({ chat_id: id, type: "text", content: t }),
      });
      setMessages((prev) => prev.some((x) => x.id === msg.id) ? prev : [...prev, msg]);
    } catch (e: any) {
      Alert.alert("Error", e.message);
    } finally { setSending(false); }
  };

  const onTyping = (val: string) => {
    setText(val);
    send({ type: "typing", chat_id: id, is_typing: val.length > 0 });
  };

  const onPickImage = async () => {
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images, base64: true, quality: 0.5,
    });
    if (res.canceled || !res.assets[0].base64) return;
    const data = `data:image/jpeg;base64,${res.assets[0].base64}`;
    try {
      const msg = await api<any>(`/chats/${id}/messages`, {
        method: "POST",
        body: JSON.stringify({ chat_id: id, type: "image", content: data }),
      });
      setMessages((prev) => [...prev, msg]);
    } catch (e: any) { Alert.alert("Error", e.message); }
  };

  const startRecording = async () => {
    try {
      const perm = await AudioModule.requestRecordingPermissionsAsync();
      if (!perm.granted) { Alert.alert("Permission needed", "Microphone access is required."); return; }
      await AudioModule.setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      setIsRecording(true);
      setRecordSecs(0);
      recordTimer.current = setInterval(() => setRecordSecs((s) => s + 1), 1000);
    } catch (e: any) { Alert.alert("Recording failed", e.message); }
  };

  const stopRecording = async (cancel = false) => {
    clearInterval(recordTimer.current);
    setIsRecording(false);
    try {
      await recorder.stop();
    } catch {}
    const uri = recorder.uri;
    const dur = recordSecs;
    setRecordSecs(0);
    if (cancel || !uri || dur < 1) return;
    try {
      const b64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
      const data = `data:audio/m4a;base64,${b64}`;
      const msg = await api<any>(`/chats/${id}/messages`, {
        method: "POST",
        body: JSON.stringify({ chat_id: id, type: "voice", content: data, duration: dur }),
      });
      setMessages((prev) => [...prev, msg]);
    } catch (e: any) { Alert.alert("Send failed", e.message); }
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} testID="chat-back-btn">
          <Ionicons name="chevron-back" size={26} color={colors.text} />
        </TouchableOpacity>
        <Avatar uri={chat?.display_avatar} name={chat?.display_name} ai={isAi} size={40} />
        <View style={{ marginLeft: 10, flex: 1 }}>
          <Text style={styles.headerName} numberOfLines={1}>
            {chat?.display_name || "Chat"}
            {isAi && <Text style={{ color: colors.accent }}>  · AI</Text>}
          </Text>
          <Text style={styles.headerSub}>
            {typingUser ? "typing…" : isAi ? "Always available" : chat?.is_group ? `${chat.member_ids?.length || 0} members` : "online"}
          </Text>
        </View>
      </View>

      <ImageBackground source={{ uri: BG }} style={{ flex: 1 }} imageStyle={{ opacity: 0.12 }}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined} keyboardVerticalOffset={90}>
          <FlatList
            ref={flatRef}
            data={messages}
            keyExtractor={(m) => m.id}
            renderItem={({ item }) => <Bubble msg={item} mine={item.sender_id === user?.id} isGroup={chat?.is_group} />}
            contentContainerStyle={{ padding: space.md, paddingBottom: 12 }}
            onContentSizeChange={() => flatRef.current?.scrollToEnd({ animated: false })}
          />

          {isRecording ? (
            <View style={styles.recordBar} testID="recording-bar">
              <View style={styles.recDot} />
              <Text style={styles.recText}>Recording {fmt(recordSecs)}</Text>
              <TouchableOpacity onPress={() => stopRecording(true)} style={styles.recCancel} testID="cancel-record-btn">
                <Ionicons name="trash" size={20} color={colors.danger} />
              </TouchableOpacity>
              <TouchableOpacity onPress={() => stopRecording(false)} style={styles.recSend} testID="send-record-btn">
                <Ionicons name="send" size={18} color="#fff" />
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.inputBar}>
              <TouchableOpacity style={styles.iconBtn} onPress={onPickImage} testID="attach-image-btn">
                <Ionicons name="image" size={22} color={colors.accent} />
              </TouchableOpacity>
              <TextInput
                style={styles.input}
                value={text}
                onChangeText={onTyping}
                placeholder={isAi ? "Ask W AI anything…" : "Message"}
                placeholderTextColor={colors.textMuted}
                multiline
                testID="message-input"
              />
              {text.trim().length > 0 ? (
                <TouchableOpacity style={styles.sendBtn} onPress={onSendText} disabled={sending} testID="send-text-btn">
                  {sending ? <ActivityIndicator color="#fff" size="small" /> : <Ionicons name="send" size={18} color="#fff" />}
                </TouchableOpacity>
              ) : (
                <TouchableOpacity style={styles.sendBtn} onPress={startRecording} testID="record-voice-btn">
                  <Ionicons name="mic" size={20} color="#fff" />
                </TouchableOpacity>
              )}
            </View>
          )}
        </KeyboardAvoidingView>
      </ImageBackground>
    </SafeAreaView>
  );
}

const Bubble = ({ msg, mine, isGroup }: any) => {
  const sentStyle = mine ? styles.bubMine : styles.bubTheir;
  return (
    <View style={[styles.bubRow, mine ? { justifyContent: "flex-end" } : { justifyContent: "flex-start" }]}>
      <View style={[styles.bubble, sentStyle]} testID={`msg-${msg.id}`}>
        {!mine && isGroup && <Text style={styles.bubName}>{msg.sender_name}</Text>}
        {msg.type === "text" && <Text style={styles.bubText}>{msg.content}</Text>}
        {msg.type === "image" && <Image source={{ uri: msg.content }} style={styles.bubImage} />}
        {msg.type === "voice" && <VoicePlayer uri={msg.content} duration={msg.duration} mine={mine} />}
        <Text style={styles.bubTime}>{new Date(msg.created_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</Text>
      </View>
    </View>
  );
};

const VoicePlayer = ({ uri, duration, mine }: any) => {
  const player = useAudioPlayer({ uri });
  const [playing, setPlaying] = useState(false);
  const toggle = () => {
    if (playing) { player.pause(); setPlaying(false); }
    else { player.seekTo(0); player.play(); setPlaying(true); setTimeout(() => setPlaying(false), (duration || 1) * 1000); }
  };
  return (
    <TouchableOpacity onPress={toggle} style={styles.voiceRow} testID="voice-player">
      <Ionicons name={playing ? "pause-circle" : "play-circle"} size={32} color={mine ? colors.accent : colors.primary} />
      <View style={styles.voiceWave}>
        {Array.from({ length: 18 }).map((_, i) => (
          <View key={i} style={[styles.voiceBar, { height: 6 + ((i * 3) % 16), backgroundColor: mine ? colors.accent : colors.primaryLight }]} />
        ))}
      </View>
      <Text style={styles.voiceDur}>{fmt(duration || 0)}</Text>
    </TouchableOpacity>
  );
};

function fmt(s: number) {
  const m = Math.floor(s / 60); const ss = s % 60;
  return `${m}:${String(ss).padStart(2, "0")}`;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 8, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: "#fff" },
  backBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  headerName: { fontSize: 16, fontWeight: "700", color: colors.text },
  headerSub: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  bubRow: { flexDirection: "row", marginVertical: 4 },
  bubble: { maxWidth: "78%", padding: 10, borderRadius: 18, shadowColor: "#000", shadowOpacity: 0.04, shadowRadius: 4, shadowOffset: { width: 0, height: 1 }, elevation: 1 },
  bubMine: { backgroundColor: colors.bubbleSent, borderBottomRightRadius: 4 },
  bubTheir: { backgroundColor: "#fff", borderBottomLeftRadius: 4, borderWidth: 1, borderColor: colors.border },
  bubName: { fontSize: 12, fontWeight: "700", color: colors.accent, marginBottom: 2 },
  bubText: { fontSize: 15, color: colors.text, lineHeight: 20 },
  bubImage: { width: 220, height: 220, borderRadius: 12 },
  bubTime: { fontSize: 10, color: colors.textMuted, alignSelf: "flex-end", marginTop: 4 },
  inputBar: { flexDirection: "row", alignItems: "flex-end", backgroundColor: "#fff", padding: 8, gap: 8, borderTopWidth: 1, borderTopColor: colors.border },
  iconBtn: { width: 42, height: 42, borderRadius: 21, backgroundColor: colors.surface2, alignItems: "center", justifyContent: "center" },
  input: { flex: 1, backgroundColor: colors.surface2, borderRadius: 22, paddingHorizontal: 16, paddingVertical: Platform.OS === "ios" ? 12 : 8, fontSize: 15, color: colors.text, maxHeight: 120 },
  sendBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" },
  recordBar: { flexDirection: "row", alignItems: "center", backgroundColor: "#fff", padding: 12, gap: 12, borderTopWidth: 1, borderTopColor: colors.border },
  recDot: { width: 12, height: 12, borderRadius: 6, backgroundColor: colors.danger },
  recText: { flex: 1, fontSize: 15, color: colors.text, fontWeight: "600" },
  recCancel: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface2 },
  recSend: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" },
  voiceRow: { flexDirection: "row", alignItems: "center", gap: 8, minWidth: 200 },
  voiceWave: { flexDirection: "row", alignItems: "center", gap: 2, flex: 1 },
  voiceBar: { width: 2, borderRadius: 1 },
  voiceDur: { fontSize: 12, color: colors.textMuted, fontWeight: "600" },
});
