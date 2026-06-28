import React, { useEffect, useState, useCallback, useRef } from "react";
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, RefreshControl,
  ActivityIndicator, TextInput, KeyboardAvoidingView, Platform, Alert,
  Animated, ScrollView,
} from "react-native";
import { Swipeable } from "react-native-gesture-handler";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { api } from "../../src/api";
import { useAuth } from "../../src/auth";
import BlueCheck from "../../src/components/BlueCheck";
import { colors, radius, space } from "../../src/theme";

type Folder = "inbox" | "drafts" | "sent" | "starred" | "spam";

export default function MailScreen() {
  const router = useRouter();
  const { user, setUser, subscribe } = useAuth();
  const [folder, setFolder] = useState<Folder>("inbox");
  const [emails, setEmails] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState("");
  const [searchActive, setSearchActive] = useState(false);
  const debounceRef = useRef<any>(null);

  const hasHandle = !!user?.email_address;

  const load = useCallback(async (q?: string) => {
    if (!hasHandle) { setLoading(false); return; }
    try {
      const path = q ? `/mail/search?q=${encodeURIComponent(q)}` : `/mail/${folder}`;
      const data = await api<any[]>(path);
      // Group by thread_id (latest message per thread)
      const grouped = groupByThread(data);
      setEmails(grouped);
    } catch (e) { console.warn(e); }
    finally { setLoading(false); setRefreshing(false); }
  }, [folder, hasHandle]);

  useFocusEffect(useCallback(() => { if (!searchActive) load(); }, [load, searchActive]));

  useEffect(() => {
    return subscribe((m: any) => {
      if (folder === "inbox" && !searchActive && (m.type === "new_email" || m.type === "mail_deleted")) load();
    });
  }, [subscribe, folder, load, searchActive]);

  useEffect(() => {
    if (!searchActive) return;
    clearTimeout(debounceRef.current);
    if (!search.trim()) { setEmails([]); return; }
    debounceRef.current = setTimeout(() => load(search.trim()), 300);
  }, [search, searchActive, load]);

  if (!hasHandle) return <HandlePicker onClaimed={(u) => setUser(u)} />;

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.header}>
        {searchActive ? (
          <View style={styles.searchRow}>
            <Ionicons name="search" size={18} color={colors.textMuted} />
            <TextInput
              style={styles.searchInput}
              value={search}
              onChangeText={setSearch}
              placeholder="Search mail"
              placeholderTextColor={colors.textMuted}
              autoFocus
              testID="mail-search-input"
            />
            <TouchableOpacity onPress={() => { setSearchActive(false); setSearch(""); load(); }} testID="mail-search-close">
              <Ionicons name="close" size={20} color={colors.textMuted} />
            </TouchableOpacity>
          </View>
        ) : (
          <>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>Inbox</Text>
              <Text style={styles.addr} testID="my-email-addr">{user.email_address}</Text>
            </View>
            <TouchableOpacity style={styles.iconBtn} onPress={() => router.push("/chats")} testID="open-chat-btn">
              <Ionicons name="chatbubbles" size={20} color={colors.primary} />
            </TouchableOpacity>
            <TouchableOpacity style={styles.iconBtn} onPress={() => setSearchActive(true)} testID="mail-search-btn">
              <Ionicons name="search" size={20} color={colors.primary} />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.iconBtn}
              onPress={() => { setRefreshing(true); load(searchActive ? search.trim() : undefined); }}
              testID="mail-refresh-btn"
              disabled={refreshing}
            >
              {refreshing
                ? <ActivityIndicator color={colors.primary} size="small" />
                : <Ionicons name="refresh" size={20} color={colors.primary} />}
            </TouchableOpacity>
          </>
        )}
      </View>

      {!searchActive && (
        <View style={styles.tabsRow}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.tabsScroll}
            testID="mail-tabs-carousel"
          >
            <FolderTab icon="mail" label="Inbox" active={folder === "inbox"} onPress={() => setFolder("inbox")} testID="mail-tab-inbox" />
            <FolderTab icon="star" label="Starred" active={folder === "starred"} onPress={() => setFolder("starred")} testID="mail-tab-starred" />
            <FolderTab icon="document-text" label="Drafts" active={folder === "drafts"} onPress={() => setFolder("drafts")} testID="mail-tab-drafts" />
            <FolderTab icon="send" label="Sent" active={folder === "sent"} onPress={() => setFolder("sent")} testID="mail-tab-sent" />
            <FolderTab icon="warning" label="Spam" active={folder === "spam"} onPress={() => setFolder("spam")} testID="mail-tab-spam" />
          </ScrollView>
          {(folder === "inbox" || folder === "spam") && (
            <TouchableOpacity
              onPress={async () => {
                try {
                  const endpoint = folder === "spam" ? "/ai/verify-spam" : "/ai/scan-inbox-spam";
                  const res: any = await api(endpoint, { method: "POST" });
                  const verb = folder === "spam" ? "released back to Inbox" : "moved to Spam";
                  const count = folder === "spam" ? res?.released : res?.moved;
                  Alert.alert(
                    "AI scan complete",
                    count ? `${count} email${count === 1 ? "" : "s"} ${verb}.` : `No changes — scanned ${res?.scanned || 0} email${res?.scanned === 1 ? "" : "s"}.`,
                  );
                  load();
                } catch (e: any) {
                  Alert.alert("Scan failed", e?.message || "Please try again.");
                }
              }}
              style={styles.aiScanBtn}
              testID="ai-spam-scan-btn"
              activeOpacity={0.85}
            >
              <Ionicons name="sparkles" size={14} color="#fff" />
              <Text style={styles.aiScanText}>{folder === "spam" ? "Verify" : "Scan"}</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {loading ? (
        <ActivityIndicator color={colors.accent} style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={emails}
          keyExtractor={(m) => m.id}
          renderItem={({ item }) => (
            <SwipeableRow
              mail={item}
              folder={folder}
              ghostMail={(user as any)?.ghost_mail_enabled !== false}
              onPress={() => {
                if (folder === "drafts") router.push({ pathname: "/mail/compose", params: { draftId: item.id } });
                else if (item.thread_id) router.push(`/mail/thread/${item.thread_id}`);
                else router.push(`/mail/${item.id}`);
              }}
              onAfterAction={() => load()}
            />
          )}
          ItemSeparatorComponent={() => <View style={styles.sep} />}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Ionicons
                name={
                  searchActive ? "search-outline"
                    : folder === "inbox" ? "mail-open-outline"
                    : folder === "starred" ? "star-outline"
                    : folder === "drafts" ? "document-text-outline"
                    : folder === "spam" ? "warning-outline"
                    : "send-outline"
                }
                size={48}
                color={colors.textMuted}
              />
              <Text style={styles.emptyTitle}>
                {searchActive ? (search ? "No results" : "Search your mail")
                  : folder === "inbox" ? "Inbox empty"
                  : folder === "starred" ? "Nothing saved yet"
                  : folder === "drafts" ? "No drafts"
                  : folder === "spam" ? "No spam — nice"
                  : "No sent mail"}
              </Text>
              {!searchActive && (
                <Text style={styles.emptySub}>
                  {folder === "inbox"
                    ? `Send emails to ${user.email_address} from any provider.`
                    : folder === "starred" ? "Open a thread and tap Save to keep it forever."
                    : folder === "drafts" ? "Drafts you save while composing will appear here."
                    : folder === "spam" ? "Tap Verify to have AI double-check the spam folder for false positives."
                    : "Tap the pencil to compose."}
                </Text>
              )}
            </View>
          }
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(searchActive ? search.trim() : undefined); }} tintColor={colors.accent} />}
          contentContainerStyle={{ paddingBottom: 100 }}
        />
      )}

      <TouchableOpacity
        style={styles.floatingCompose}
        onPress={() => router.push("/mail/compose")}
        testID="compose-fab"
        activeOpacity={0.85}
      >
        <Ionicons name="create" size={26} color="#fff" />
      </TouchableOpacity>
    </SafeAreaView>
  );
}

// Group by thread_id, keep latest per thread, attach count
function groupByThread(rows: any[]): any[] {
  const byThread: Record<string, any[]> = {};
  for (const r of rows) {
    const k = r.thread_id || r.id;
    (byThread[k] = byThread[k] || []).push(r);
  }
  const out = Object.values(byThread).map((arr) => {
    arr.sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
    const top = arr[0];
    return { ...top, _thread_count: arr.length };
  });
  out.sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
  return out;
}

const FolderTab = ({ label, icon, active, onPress, testID }: any) => (
  <TouchableOpacity onPress={onPress} style={[styles.foldBtn, active && styles.foldBtnOn]} testID={testID} activeOpacity={0.75}>
    {icon ? (
      <Ionicons name={icon} size={14} color={active ? "#fff" : colors.textMuted} style={{ marginRight: 6 }} />
    ) : null}
    <Text style={[styles.foldText, active && styles.foldTextOn]}>{label}</Text>
  </TouchableOpacity>
);

const MailRow = ({ mail, folder, onPress, ghostMail }: any) => {
  const unread = folder === "inbox" && !mail.read;
  const isGhost = folder === "inbox" && ghostMail && !mail.starred;
  const who = folder === "inbox" || folder === "starred" ? (mail.from_name || mail.from_addr) : folder === "drafts" ? `Draft: ${(mail.to_addrs || []).join(", ") || "—"}` : (mail.to_addrs?.join(", ") || "—");
  const preview = (mail.body || "").replace(/\s+/g, " ").slice(0, 90);
  return (
    <TouchableOpacity onPress={onPress} style={styles.row} testID={`mail-row-${mail.id}`} activeOpacity={0.7}>
      <View style={[styles.dot, unread ? { backgroundColor: colors.accent } : { backgroundColor: "transparent" }]} />
      <View style={{ flex: 1 }}>
        <View style={styles.rowTop}>
          <Text style={[styles.who, unread && { fontWeight: "800" }]} numberOfLines={1}>{who}</Text>
          {(folder === "inbox" || folder === "starred") && <BlueCheck tier={mail.from_tier} size={13} />}
          {mail.starred && <Ionicons name="star" size={13} color="#E0A300" />}
          {isGhost && (
            <View style={styles.ghostPill} testID={`ghost-${mail.id}`}>
              <Text style={styles.ghostPillText}>👻</Text>
            </View>
          )}
          {mail._thread_count > 1 && <Text style={styles.threadCount}>· {mail._thread_count}</Text>}
          <Text style={styles.time}>{formatDate(mail.created_at)}</Text>
        </View>
        <Text style={[styles.subj, unread && { fontWeight: "700", color: colors.text }]} numberOfLines={1}>{mail.subject || "(no subject)"}</Text>
        <Text style={styles.preview} numberOfLines={1}>{preview}</Text>
        {!!mail.attachments?.length && (
          <View style={styles.attachRow}>
            <Ionicons name="attach" size={14} color={colors.textMuted} />
            <Text style={styles.attachTxt}>{mail.attachments.length} attachment{mail.attachments.length > 1 ? "s" : ""}</Text>
          </View>
        )}
      </View>
    </TouchableOpacity>
  );
};

// Swipeable wrapper around MailRow. Left swipe = Archive, Right swipe = Star.
const SwipeableRow = ({ mail, folder, onPress, ghostMail, onAfterAction }: any) => {
  const swipeRef = useRef<Swipeable | null>(null);

  const doStar = async () => {
    try { await api(`/mail/${mail.id}/star`, { method: "PATCH" }); }
    catch (e: any) { Alert.alert("Couldn't star", e.message); }
    finally { swipeRef.current?.close(); onAfterAction?.(); }
  };
  const doArchive = async () => {
    try { await api(`/mail/${mail.id}/archive`, { method: "PATCH" }); }
    catch (e: any) { Alert.alert("Couldn't archive", e.message); }
    finally { swipeRef.current?.close(); onAfterAction?.(); }
  };
  const doSnooze = async () => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(9, 0, 0, 0);
    try { await api(`/mail/${mail.id}/snooze`, { method: "PATCH", body: JSON.stringify({ until: tomorrow.toISOString() }) }); }
    catch (e: any) { Alert.alert("Couldn't snooze", e.message); }
    finally { swipeRef.current?.close(); onAfterAction?.(); }
  };

  // Swipes are only meaningful for inbox / starred — for drafts & sent we just render the row.
  if (folder !== "inbox" && folder !== "starred") {
    return <MailRow mail={mail} folder={folder} onPress={onPress} ghostMail={ghostMail} />;
  }

  const renderRight = (progress: Animated.AnimatedInterpolation<number>) => {
    const scale = progress.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1], extrapolate: "clamp" });
    return (
      <Animated.View style={[styles.actionRight, { transform: [{ scale }] }]}>
        <TouchableOpacity onPress={doStar} style={[styles.actionBtn, { backgroundColor: "#E0A300" }]} testID={`swipe-star-${mail.id}`}>
          <Ionicons name={mail.starred ? "star" : "star-outline"} size={20} color="#fff" />
          <Text style={styles.actionText}>{mail.starred ? "Unstar" : "Star"}</Text>
        </TouchableOpacity>
      </Animated.View>
    );
  };
  const renderLeft = (progress: Animated.AnimatedInterpolation<number>) => {
    const scale = progress.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1], extrapolate: "clamp" });
    return (
      <Animated.View style={[styles.actionLeft, { transform: [{ scale }] }]}>
        <TouchableOpacity onPress={doSnooze} style={[styles.actionBtn, { backgroundColor: colors.accent }]} testID={`swipe-snooze-${mail.id}`}>
          <Ionicons name="time" size={20} color="#fff" />
          <Text style={styles.actionText}>Snooze</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={doArchive} style={[styles.actionBtn, { backgroundColor: colors.primary }]} testID={`swipe-archive-${mail.id}`}>
          <Ionicons name="archive" size={20} color="#fff" />
          <Text style={styles.actionText}>Archive</Text>
        </TouchableOpacity>
      </Animated.View>
    );
  };

  return (
    <Swipeable
      ref={(r) => { swipeRef.current = r; }}
      renderRightActions={renderRight}
      renderLeftActions={renderLeft}
      friction={2}
      rightThreshold={40}
      leftThreshold={40}
      overshootFriction={8}
    >
      <View style={{ backgroundColor: colors.surface }}>
        <MailRow mail={mail} folder={folder} onPress={onPress} ghostMail={ghostMail} />
      </View>
    </Swipeable>
  );
};

function formatDate(iso?: string) {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString())
    return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return d.toLocaleDateString([], { day: "2-digit", month: "short" });
}

// ---------- Handle Picker ----------
const HandlePicker = ({ onClaimed }: { onClaimed: (u: any) => void }) => {
  const [handle, setHandle] = useState("");
  const [status, setStatus] = useState<{ available?: boolean; reason?: string; checking?: boolean }>({});
  const [claiming, setClaiming] = useState(false);
  useEffect(() => {
    if (handle.length < 3) { setStatus({}); return; }
    setStatus({ checking: true });
    const t = setTimeout(async () => {
      try {
        const res = await api<any>(`/mail/check-handle/${encodeURIComponent(handle)}`);
        setStatus({ available: res.available, reason: res.reason });
      } catch { setStatus({}); }
    }, 350);
    return () => clearTimeout(t);
  }, [handle]);
  const onClaim = async () => {
    setClaiming(true);
    try {
      const u = await api<any>("/mail/claim-handle", { method: "POST", body: JSON.stringify({ handle: handle.trim().toLowerCase() }) });
      onClaimed(u);
    } catch (e: any) { Alert.alert("Couldn't claim", e.message); } finally { setClaiming(false); }
  };
  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : "height"}>
        <View style={styles.pickWrap}>
          <View style={styles.heroIcon}><Ionicons name="mail" size={36} color="#fff" /></View>
          <Text style={styles.pickTitle}>Claim your @w.xyz address</Text>
          <Text style={styles.pickSub}>Pick a handle that's yours. Real email — send to anyone, receive from anyone.</Text>
          <View style={styles.handleRow}>
            <TextInput style={styles.handleInput} placeholder="yourhandle" placeholderTextColor={colors.textMuted}
              value={handle} onChangeText={(t) => setHandle(t.toLowerCase().replace(/[^a-z0-9._-]/g, "").slice(0, 32))}
              autoCapitalize="none" autoCorrect={false} autoFocus testID="handle-input" />
            <Text style={styles.domain}>@w.xyz</Text>
          </View>
          {status.checking && <Text style={styles.statusLine}>Checking…</Text>}
          {!status.checking && status.available === true && <Text style={[styles.statusLine, { color: colors.success }]}>✓ Available</Text>}
          {!status.checking && status.available === false && <Text style={[styles.statusLine, { color: colors.danger }]}>✕ {status.reason || "Taken"}</Text>}
          <TouchableOpacity style={[styles.claimBtn, (!status.available || claiming) && { opacity: 0.5 }]}
            disabled={!status.available || claiming} onPress={onClaim} testID="claim-handle-btn">
            {claiming ? <ActivityIndicator color="#fff" /> : <Text style={styles.claimText}>Claim {handle}@w.xyz</Text>}
          </TouchableOpacity>
          <Text style={styles.legal}>Reserved handles (admin, support, etc.) are not allowed.</Text>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.surface },
  header: { paddingHorizontal: space.xl, paddingVertical: space.md, flexDirection: "row", alignItems: "center", gap: 8 },
  title: { fontSize: 28, fontWeight: "800", color: colors.text, letterSpacing: -0.5 },
  addr: { color: colors.textMuted, fontSize: 13, marginTop: 2 },
  iconBtn: { width: 42, height: 42, borderRadius: 21, backgroundColor: colors.surface2, alignItems: "center", justifyContent: "center" },
  floatingCompose: {
    position: "absolute",
    right: 20,
    bottom: 24,
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 6,
  },
  searchRow: { flex: 1, flexDirection: "row", alignItems: "center", backgroundColor: colors.surface2, borderRadius: radius.pill, paddingHorizontal: 14, gap: 8 },
  searchInput: { flex: 1, fontSize: 15, color: colors.text, paddingVertical: 10 },
  tabs: { flexDirection: "row", gap: 8, paddingHorizontal: space.xl, marginBottom: 8 },
  tabsRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingRight: space.xl, marginBottom: 8 },
  tabsScroll: { paddingHorizontal: space.xl, gap: 8, paddingVertical: 2 },
  foldBtn: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: radius.pill, backgroundColor: colors.surface2, flexDirection: "row", alignItems: "center" },
  foldBtnOn: { backgroundColor: colors.primary },
  aiScanBtn: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 12, paddingVertical: 7, borderRadius: radius.pill, backgroundColor: colors.accent },
  aiScanText: { color: "#fff", fontSize: 12.5, fontWeight: "800", letterSpacing: 0.2 },
  foldText: { color: colors.textMuted, fontWeight: "700", fontSize: 13 },
  foldTextOn: { color: "#fff" },
  row: { flexDirection: "row", alignItems: "flex-start", paddingHorizontal: space.xl, paddingVertical: 12, gap: 10 },
  dot: { width: 10, height: 10, borderRadius: 5, marginTop: 7 },
  rowTop: { flexDirection: "row", alignItems: "center", gap: 6 },
  who: { fontSize: 15, fontWeight: "700", color: colors.text, flex: 1 },
  threadCount: { fontSize: 12, color: colors.accent, fontWeight: "700" },
  time: { fontSize: 12, color: colors.textMuted },
  subj: { fontSize: 14, color: colors.text, marginTop: 2 },
  preview: { fontSize: 13, color: colors.textMuted, marginTop: 2 },
  attachRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 4 },
  attachTxt: { fontSize: 12, color: colors.textMuted },
  sep: { height: 1, backgroundColor: colors.border, marginLeft: 50 },
  ghostPill: { paddingHorizontal: 5, paddingVertical: 2, borderRadius: 8, backgroundColor: "#FFF4E5", borderWidth: 1, borderColor: "#FFE0B2" },
  ghostPillText: { fontSize: 11 },
  actionRight: { flexDirection: "row", alignItems: "center", justifyContent: "flex-end", paddingHorizontal: 8 },
  actionLeft: { flexDirection: "row", alignItems: "center", justifyContent: "flex-start", paddingHorizontal: 8 },
  actionBtn: { width: 78, height: "85%", alignItems: "center", justifyContent: "center", borderRadius: radius.lg, marginHorizontal: 4, gap: 4 },
  actionText: { color: "#fff", fontWeight: "700", fontSize: 11 },
  empty: { alignItems: "center", marginTop: 60, paddingHorizontal: 40 },
  emptyTitle: { fontSize: 18, fontWeight: "700", color: colors.text, marginTop: 12 },
  emptySub: { color: colors.textMuted, marginTop: 4, textAlign: "center", lineHeight: 19 },

  pickWrap: { flex: 1, padding: space.xl, justifyContent: "center" },
  heroIcon: { width: 72, height: 72, borderRadius: 22, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center", marginBottom: 18 },
  pickTitle: { fontSize: 26, fontWeight: "800", color: colors.text, letterSpacing: -0.5 },
  pickSub: { fontSize: 14, color: colors.textMuted, marginTop: 6, marginBottom: 24, lineHeight: 20 },
  handleRow: { flexDirection: "row", alignItems: "center", backgroundColor: colors.surface2, borderRadius: radius.lg, paddingLeft: 14, paddingRight: 12 },
  handleInput: { flex: 1, fontSize: 18, color: colors.text, paddingVertical: 16, fontWeight: "600", minWidth: 0 },
  domain: { fontSize: 16, color: colors.accent, fontWeight: "700", flexShrink: 0, marginLeft: 8, includeFontPadding: false as any },
  statusLine: { marginTop: 10, fontSize: 13, color: colors.textMuted, fontWeight: "600" },
  claimBtn: { marginTop: 22, backgroundColor: colors.primary, padding: 16, borderRadius: radius.xl, alignItems: "center" },
  claimText: { color: "#fff", fontSize: 16, fontWeight: "700" },
  legal: { textAlign: "center", color: colors.textMuted, fontSize: 12, marginTop: 14 },
});
