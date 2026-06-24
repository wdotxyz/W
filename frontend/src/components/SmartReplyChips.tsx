import React, { useEffect, useState, useCallback } from "react";
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { api } from "../api";
import { colors, radius, space } from "../theme";

/**
 * SmartReplyChips
 * Tiny AI-powered reply suggestion bar. Loads 3 short suggestions and renders
 * them as tappable pills. Use in chat composer or mail thread view.
 *
 * Modes:
 *   - "chat" : POST /api/ai/smart-reply/chat/{chatId}
 *   - "mail" : POST /api/ai/smart-reply  (you pass messages directly)
 *
 * Props:
 *   - chatId?: load from a chat directly (mode "chat")
 *   - messages?: [{role:"me"|"them", text}]
 *   - mode?: "chat" | "mail" (default "chat")
 *   - autoLoad?: boolean (default true)
 *   - onSelect: (text) => void
 *   - hidden?: boolean (force-hide the bar; e.g. while composing)
 */
type Msg = { role: "me" | "them"; text: string };
type Props = {
  chatId?: string;
  messages?: Msg[];
  mode?: "chat" | "mail";
  autoLoad?: boolean;
  onSelect: (text: string) => void;
  hidden?: boolean;
  testID?: string;
};

export default function SmartReplyChips({ chatId, messages, mode = "chat", autoLoad = true, onSelect, hidden, testID }: Props) {
  const [items, setItems] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  const fetchSuggestions = useCallback(async () => {
    setLoading(true);
    try {
      let res: { suggestions?: string[] };
      if (chatId) {
        res = await api(`/ai/smart-reply/chat/${chatId}`, { method: "POST" });
      } else if (messages?.length) {
        res = await api("/ai/smart-reply", { method: "POST", body: JSON.stringify({ messages, mode }) });
      } else {
        res = { suggestions: [] };
      }
      setItems((res.suggestions || []).slice(0, 3));
    } catch (_) { setItems([]); }
    finally { setLoading(false); }
  }, [chatId, messages, mode]);

  useEffect(() => {
    if (autoLoad && !hidden && !dismissed) fetchSuggestions();
  }, [autoLoad, hidden, dismissed, fetchSuggestions]);

  if (hidden || dismissed) return null;
  if (!loading && items.length === 0) return null;

  return (
    <View style={styles.wrap} testID={testID || "smart-replies"}>
      <View style={styles.headerRow}>
        <Ionicons name="sparkles" size={12} color={colors.accent} />
        <Text style={styles.headerText}>AI suggestions</Text>
        <View style={{ flex: 1 }} />
        <TouchableOpacity onPress={fetchSuggestions} disabled={loading} hitSlop={8} testID="smart-refresh">
          <Ionicons name="refresh" size={14} color={colors.textMuted} />
        </TouchableOpacity>
        <TouchableOpacity onPress={() => setDismissed(true)} hitSlop={8} style={{ marginLeft: 10 }} testID="smart-dismiss">
          <Ionicons name="close" size={14} color={colors.textMuted} />
        </TouchableOpacity>
      </View>
      {loading ? (
        <View style={styles.loadingRow}>
          <ActivityIndicator color={colors.accent} size="small" />
          <Text style={styles.loadingTxt}>Thinking…</Text>
        </View>
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
          {items.map((t, i) => (
            <TouchableOpacity key={i} onPress={() => onSelect(t)} style={styles.chip} testID={`smart-chip-${i}`} activeOpacity={0.7}>
              <Text style={styles.chipText} numberOfLines={2}>{t}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: space.md, paddingVertical: 8, gap: 6, backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.border },
  headerRow: { flexDirection: "row", alignItems: "center", gap: 5 },
  headerText: { fontSize: 11, fontWeight: "700", color: colors.accent, textTransform: "uppercase", letterSpacing: 0.4 },
  loadingRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 6 },
  loadingTxt: { fontSize: 12, color: colors.textMuted },
  chip: {
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: radius.pill,
    backgroundColor: "#E8F5F7", borderWidth: 1, borderColor: "#B3E0E8",
    maxWidth: 240,
  },
  chipText: { fontSize: 13, color: colors.primary, fontWeight: "600" },
});
