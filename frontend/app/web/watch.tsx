/**
 * /web/watch — MVP stub reusing the mobile Watch/Updates screen.
 */
import React from "react";
import { View, StyleSheet } from "react-native";
import UpdatesScreen from "../(tabs)/updates";
import { colors } from "../../src/theme";

export default function WebWatch() {
  return (
    <View style={styles.wrap} testID="web-watch-wrap">
      <UpdatesScreen />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.surface },
});
