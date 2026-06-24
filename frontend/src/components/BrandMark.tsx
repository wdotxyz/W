import React from "react";
import { Image, StyleSheet, ImageStyle, StyleProp } from "react-native";

type Props = {
  size?: number;
  style?: StyleProp<ImageStyle>;
  testID?: string;
};

/**
 * Reusable W brand mark — uses the user-provided logo asset.
 * Never paired with a "W" wordmark — the logo IS the wordmark.
 */
export default function BrandMark({ size = 32, style, testID }: Props) {
  return (
    <Image
      source={require("../../assets/images/brand-logo.png")}
      style={[styles.img, { width: size, height: size }, style]}
      resizeMode="contain"
      testID={testID || "brand-mark"}
    />
  );
}

const styles = StyleSheet.create({
  img: {},
});
