import React, { useEffect } from "react";
import { View, ActivityIndicator, StyleSheet } from "react-native";
import { Redirect } from "expo-router";
import { useAuth } from "../src/auth";
import { colors } from "../src/theme";
import BrandMark from "../src/components/BrandMark";

export default function Index() {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <View style={styles.c}>
        <BrandMark size={72} style={{ marginBottom: 20 }} />
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }
  if (!user) return <Redirect href="/(auth)/signin" />;
  if (!user.name) return <Redirect href="/(auth)/profile-setup" />;
  return <Redirect href="/(tabs)/updates" />;
}

const styles = StyleSheet.create({
  c: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface },
});
