/**
 * /web/chats — MVP stub. Reuses the mobile Chats screen so W-to-W
 * messaging works on desktop today, while we design the dedicated
 * Gmail-style two-column chat layout in a later iteration.
 */
import React from "react";
import { View, StyleSheet } from "react-native";
import ChatsScreen from "../chats";
import { colors } from "../../src/theme";

export default function WebChats() {
  return (
    <View style={styles.wrap} testID="web-chats-wrap">
      <ChatsScreen />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.surface },
});
