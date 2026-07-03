/**
 * /web/compose — for the MVP we redirect to the existing mail compose screen,
 * which already handles web rendering. When we polish, this will be an
 * inline right-side sheet like Gmail's compose window.
 */
import React from "react";
import { Redirect, useLocalSearchParams } from "expo-router";

export default function WebCompose() {
  const params = useLocalSearchParams();
  // Preserve any prefill params (to, subject, inReplyTo, etc.) so replies work.
  const search = new URLSearchParams(params as any).toString();
  const href = search ? `/mail/compose?${search}` : "/mail/compose";
  return <Redirect href={href as any} />;
}
