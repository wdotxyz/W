// Centralised feature flags for the W app.
// Flip these back on once the MVP is launched.

// Premium / billing UI is hidden across the app until post-MVP.
// Re-enable to surface W Premium row, upgrade CTAs, and the /billing/upgrade pricing page.
export const SHOW_PREMIUM = false;

// Ghost Mail is a standard always-on feature for the MVP.
// When we ship paid tiers, flip this to true so users can disable it from Mail Settings.
export const SHOW_GHOST_MAIL_TOGGLE = false;
