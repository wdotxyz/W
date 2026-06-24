import React from "react";
import { View, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";

type Props = {
  tier?: string | null;
  size?: number;
  style?: any;
};

/**
 * Renders a Twitter-style blue checkmark next to a user name when the user
 * is on a paid tier (plus or pro). Hidden for free users.
 */
export default function BlueCheck({ tier, size = 14, style }: Props) {
  if (!tier || tier === "free") return null;
  return (
    <View style={[styles.wrap, style]} accessibilityLabel="Verified premium account">
      <Ionicons name="checkmark-circle" size={size} color="#1DA1F2" />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginLeft: 4 },
});
