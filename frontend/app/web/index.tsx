/**
 * /web — root redirect. Any bare visit to /web lands on the Inbox.
 */
import React from "react";
import { Redirect } from "expo-router";

export default function WebIndex() {
  return <Redirect href="/web/inbox" />;
}
