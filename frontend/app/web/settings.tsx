/**
 * /web/settings — MVP stub reusing the mobile Settings screen inside the
 * web shell. Full desktop-native settings design is a later iteration.
 */
import React from "react";
import { View, StyleSheet } from "react-native";
import SettingsScreen from "../(tabs)/settings";
import { colors } from "../../src/theme";

export default function WebSettings() {
  return (
    <View style={styles.wrap} testID="web-settings-wrap">
      <SettingsScreen />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.surface },
});
