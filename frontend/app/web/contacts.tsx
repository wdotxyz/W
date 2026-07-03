/**
 * /web/contacts — MVP stub reusing the mobile Contacts screen so users can
 * invite people from desktop today. Full Gmail-style contact management
 * comes in a later iteration.
 */
import React from "react";
import { View, StyleSheet } from "react-native";
import ContactsScreen from "../contacts";
import { colors } from "../../src/theme";

export default function WebContacts() {
  return (
    <View style={styles.wrap} testID="web-contacts-wrap">
      <ContactsScreen />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.surface },
});
