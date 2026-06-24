import React, { useState, useCallback, useEffect } from "react";
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Image, RefreshControl,
  ActivityIndicator, Modal, TextInput, KeyboardAvoidingView, Platform, Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { api } from "../../src/api";
import { useAuth } from "../../src/auth";
import { Avatar } from "./chats";
import { colors, radius, space } from "../../src/theme";

const BG_COLORS = ["#0B3B60", "#0A7A90", "#00B4D8", "#FF6B6B", "#FFB400", "#34C759", "#9C27B0", "#1A1A1A"];

type StatusType = { id: string; user_id: string; user_name: string; user_avatar?: string; type: string; content: string; background?: string; created_at: string };
type Contact = { user_id: string; user_name: string; user_avatar?: string; latest: StatusType; count: number; all_viewed: boolean };

export default function UpdatesScreen() {
  const { user } = useAuth();
  const [mine, setMine] = useState<StatusType[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [composeOpen, setComposeOpen] = useState(false);
  const [viewer, setViewer] = useState<{ items: StatusType[]; idx: number } | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await api<{ my_statuses: StatusType[]; contacts: Contact[] }>("/statuses");
      setMine(data.my_statuses);
      setContacts(data.contacts);
    } catch (e) { console.warn(e); }
    finally { setLoading(false); setRefreshing(false); }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const openContact = async (c: Contact) => {
    try {
      const items = await api<StatusType[]>(`/statuses/${c.user_id}`);
      if (items.length) setViewer({ items, idx: 0 });
    } catch (e: any) { Alert.alert("Couldn't open", e.message); }
  };

  const openMine = async () => {
    if (!mine.length) { setComposeOpen(true); return; }
    try {
      const items = await api<StatusType[]>(`/statuses/${user!.id}`);
      if (items.length) setViewer({ items, idx: 0 });
    } catch {}
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.header}>
        <Text style={styles.title}>Watch</Text>
      </View>

      {loading ? (
        <ActivityIndicator color={colors.accent} style={{ marginTop: 40 }} />
      ) : (
        <ScrollView
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.accent} />}
          contentContainerStyle={{ paddingBottom: 40 }}
        >
          {/* My status */}
          <Text style={styles.section}>STATUS</Text>
          <TouchableOpacity style={styles.row} onPress={openMine} testID="my-status-row" activeOpacity={0.7}>
            <View style={styles.avatarWrap}>
              <Avatar uri={user?.avatar} name={user?.name} size={56} />
              {!mine.length && (
                <View style={styles.plusBadge}><Ionicons name="add" size={14} color="#fff" /></View>
              )}
              {!!mine.length && <View style={[styles.ring, { borderColor: colors.accent }]} />}
            </View>
            <View style={{ flex: 1, marginLeft: 14 }}>
              <Text style={styles.name}>My status</Text>
              <Text style={styles.sub}>{mine.length ? `${mine.length} update${mine.length > 1 ? "s" : ""} · tap to view` : "Tap to share a status update"}</Text>
            </View>
            <TouchableOpacity style={styles.composeBtn} onPress={() => setComposeOpen(true)} testID="add-status-btn">
              <Ionicons name="create" size={20} color={colors.primary} />
            </TouchableOpacity>
          </TouchableOpacity>

          {/* Recent updates from contacts */}
          {contacts.length > 0 && (
            <>
              <Text style={styles.section}>RECENT UPDATES</Text>
              {contacts.map((c) => (
                <TouchableOpacity key={c.user_id} style={styles.row} onPress={() => openContact(c)} testID={`status-row-${c.user_id}`} activeOpacity={0.7}>
                  <View style={styles.avatarWrap}>
                    <Avatar uri={c.user_avatar} name={c.user_name} size={56} />
                    <View style={[styles.ring, { borderColor: c.all_viewed ? colors.textMuted : colors.accent }]} />
                  </View>
                  <View style={{ flex: 1, marginLeft: 14 }}>
                    <Text style={styles.name}>{c.user_name}</Text>
                    <Text style={styles.sub}>{c.count} update{c.count > 1 ? "s" : ""} · {timeAgo(c.latest.created_at)}</Text>
                  </View>
                </TouchableOpacity>
              ))}
            </>
          )}

          {!contacts.length && (
            <View style={styles.empty}>
              <Ionicons name="radio-outline" size={48} color={colors.textMuted} />
              <Text style={styles.emptyTitle}>No updates yet</Text>
              <Text style={styles.emptySub}>When contacts post status updates, they will show up here. Updates disappear after 24 hours.</Text>
            </View>
          )}

          <View style={styles.tip}>
            <Ionicons name="information-circle" size={16} color={colors.textMuted} />
            <Text style={styles.tipText}>Updates disappear automatically after 24 hours.</Text>
          </View>
        </ScrollView>
      )}

      <ComposeStatus open={composeOpen} onClose={() => setComposeOpen(false)} onPosted={() => { setComposeOpen(false); load(); }} />
      <StatusViewer viewer={viewer} onClose={() => setViewer(null)} />
    </SafeAreaView>
  );
}

const ComposeStatus = ({ open, onClose, onPosted }: { open: boolean; onClose: () => void; onPosted: () => void }) => {
  const [text, setText] = useState("");
  const [bg, setBg] = useState(BG_COLORS[0]);
  const [posting, setPosting] = useState(false);

  useEffect(() => { if (!open) { setText(""); setBg(BG_COLORS[0]); } }, [open]);

  const post = async (type: "text" | "image", content: string) => {
    setPosting(true);
    try {
      await api("/statuses", { method: "POST", body: JSON.stringify({ type, content, background: type === "text" ? bg : null }) });
      onPosted();
    } catch (e: any) { Alert.alert("Failed", e.message); }
    finally { setPosting(false); }
  };

  const onPostText = () => { if (!text.trim()) return; post("text", text.trim()); };
  const onPickImage = async () => {
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, base64: true, quality: 0.6 });
    if (res.canceled || !res.assets[0].base64) return;
    await post("image", `data:image/jpeg;base64,${res.assets[0].base64}`);
  };

  return (
    <Modal visible={open} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={[styles.safe, { backgroundColor: bg }]} edges={["top", "bottom"]}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <View style={styles.composeHeader}>
            <TouchableOpacity onPress={onClose} style={styles.iconBtn} testID="status-close"><Ionicons name="close" size={26} color="#fff" /></TouchableOpacity>
            <Text style={styles.composeTitle}>Post status</Text>
            <TouchableOpacity onPress={onPostText} disabled={posting || !text.trim()} style={[styles.postBtn, (!text.trim() || posting) && { opacity: 0.5 }]} testID="status-post-btn">
              {posting ? <ActivityIndicator color={colors.primary} /> : <Text style={styles.postBtnText}>Post</Text>}
            </TouchableOpacity>
          </View>
          <View style={styles.composeBody}>
            <TextInput
              style={styles.composeInput}
              value={text}
              onChangeText={setText}
              placeholder="Type a status…"
              placeholderTextColor="rgba(255,255,255,0.55)"
              multiline
              maxLength={300}
              autoFocus
              testID="status-text-input"
            />
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.colorRow}>
            {BG_COLORS.map((c) => (
              <TouchableOpacity key={c} onPress={() => setBg(c)} style={[styles.colorDot, { backgroundColor: c }, bg === c && styles.colorDotOn]} testID={`color-${c}`} />
            ))}
          </ScrollView>
          <TouchableOpacity style={styles.imgBtn} onPress={onPickImage} testID="status-image-btn">
            <Ionicons name="image" size={20} color="#fff" />
            <Text style={styles.imgBtnText}>Post photo instead</Text>
          </TouchableOpacity>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
};

const StatusViewer = ({ viewer, onClose }: { viewer: { items: StatusType[]; idx: number } | null; onClose: () => void }) => {
  const [idx, setIdx] = useState(0);
  useEffect(() => { if (viewer) setIdx(viewer.idx); }, [viewer]);
  useEffect(() => {
    if (!viewer) return;
    const t = setTimeout(() => {
      if (idx < viewer.items.length - 1) setIdx(idx + 1);
      else onClose();
    }, 4500);
    return () => clearTimeout(t);
  }, [viewer, idx, onClose]);
  if (!viewer) return null;
  const cur = viewer.items[idx];
  return (
    <Modal visible={true} animationType="fade" onRequestClose={onClose}>
      <View style={[styles.viewer, { backgroundColor: cur.type === "text" ? (cur.background || "#000") : "#000" }]}>
        <View style={styles.progressRow}>
          {viewer.items.map((_, i) => (
            <View key={i} style={[styles.progressBar, { backgroundColor: i <= idx ? "#fff" : "rgba(255,255,255,0.35)" }]} />
          ))}
        </View>
        <View style={styles.viewerHeader}>
          <Avatar uri={cur.user_avatar} name={cur.user_name} size={36} />
          <Text style={styles.viewerName}>{cur.user_name}</Text>
          <Text style={styles.viewerTime}>{timeAgo(cur.created_at)}</Text>
          <TouchableOpacity onPress={onClose} style={styles.iconBtn} testID="viewer-close"><Ionicons name="close" size={26} color="#fff" /></TouchableOpacity>
        </View>
        <View style={styles.viewerBody}>
          {cur.type === "image" ? (
            <Image source={{ uri: cur.content }} style={styles.viewerImg} resizeMode="contain" />
          ) : (
            <Text style={styles.viewerText}>{cur.content}</Text>
          )}
        </View>
        <TouchableOpacity style={styles.tapLeft} onPress={() => idx > 0 && setIdx(idx - 1)} />
        <TouchableOpacity style={styles.tapRight} onPress={() => idx < viewer.items.length - 1 ? setIdx(idx + 1) : onClose()} />
      </View>
    </Modal>
  );
};

function timeAgo(iso: string) {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.surface },
  header: { padding: space.xl, paddingBottom: space.md },
  title: { fontSize: 28, fontWeight: "800", color: colors.text, letterSpacing: -0.5 },
  section: { paddingHorizontal: space.xl, paddingTop: 16, paddingBottom: 8, color: colors.textMuted, fontSize: 12, fontWeight: "800", letterSpacing: 1.2 },
  row: { flexDirection: "row", alignItems: "center", paddingHorizontal: space.xl, paddingVertical: 10 },
  avatarWrap: { position: "relative", width: 64, height: 64, alignItems: "center", justifyContent: "center" },
  ring: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, borderRadius: 32, borderWidth: 2.5 },
  plusBadge: { position: "absolute", right: 2, bottom: 2, width: 22, height: 22, borderRadius: 11, backgroundColor: colors.accent, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: "#fff" },
  composeBtn: { width: 42, height: 42, borderRadius: 21, backgroundColor: colors.surface2, alignItems: "center", justifyContent: "center" },
  name: { fontSize: 16, fontWeight: "700", color: colors.text },
  sub: { fontSize: 13, color: colors.textMuted, marginTop: 2 },
  empty: { alignItems: "center", marginTop: 30, paddingHorizontal: 40 },
  emptyTitle: { fontSize: 18, fontWeight: "700", color: colors.text, marginTop: 12 },
  emptySub: { color: colors.textMuted, marginTop: 4, textAlign: "center", lineHeight: 19 },
  tip: { flexDirection: "row", gap: 8, alignItems: "center", marginTop: 24, padding: 14, marginHorizontal: space.xl, backgroundColor: colors.surface2, borderRadius: radius.md },
  tipText: { color: colors.textMuted, fontSize: 12, flex: 1 },

  composeHeader: { flexDirection: "row", alignItems: "center", padding: space.md, gap: 8 },
  iconBtn: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  composeTitle: { flex: 1, color: "#fff", fontSize: 18, fontWeight: "700" },
  postBtn: { backgroundColor: "#fff", paddingHorizontal: 18, paddingVertical: 10, borderRadius: radius.pill },
  postBtnText: { color: colors.primary, fontWeight: "800" },
  composeBody: { flex: 1, padding: space.xl, justifyContent: "center" },
  composeInput: { color: "#fff", fontSize: 28, lineHeight: 36, fontWeight: "600", textAlign: "center" },
  colorRow: { paddingHorizontal: space.xl, gap: 10, paddingVertical: 16 },
  colorDot: { width: 36, height: 36, borderRadius: 18 },
  colorDotOn: { borderWidth: 3, borderColor: "#fff" },
  imgBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, padding: 16, borderTopWidth: 1, borderTopColor: "rgba(255,255,255,0.18)" },
  imgBtnText: { color: "#fff", fontWeight: "700" },

  viewer: { flex: 1 },
  progressRow: { flexDirection: "row", gap: 4, paddingHorizontal: 8, paddingTop: 48 },
  progressBar: { flex: 1, height: 3, borderRadius: 2 },
  viewerHeader: { flexDirection: "row", alignItems: "center", paddingHorizontal: 12, paddingTop: 12, gap: 10 },
  viewerName: { flex: 1, color: "#fff", fontWeight: "700" },
  viewerTime: { color: "rgba(255,255,255,0.7)", fontSize: 12 },
  viewerBody: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 24 },
  viewerText: { color: "#fff", fontSize: 28, textAlign: "center", lineHeight: 38, fontWeight: "600" },
  viewerImg: { width: "100%", height: "100%" },
  tapLeft: { position: "absolute", left: 0, top: 80, bottom: 0, width: "30%" },
  tapRight: { position: "absolute", right: 0, top: 80, bottom: 0, width: "70%" },
});
