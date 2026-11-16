import { defineManifest } from "@crxjs/vite-plugin";

export default defineManifest({
  manifest_version: 3,
  name: "Meet Alert",
  version: "1.0.0",
  description:
    "Sticky audible and visual alerts for upcoming Google Meet events and when guests join.",
  icons: {
    "16": "icons/icon16.png",
    "48": "icons/icon48.png",
    "128": "icons/icon128.png",
  },
  action: {
    default_title: "Meet Alert",
    default_icon: {
      "16": "icons/icon16.png",
      "48": "icons/icon48.png",
    },
  },
  background: {
    service_worker: "src/background.ts",
    type: "module",
  },
  options_ui: {
    page: "src/options.html",
    open_in_tab: true,
  },
  permissions: [
    "alarms",
    "notifications",
    "storage",
    "identity",
    "offscreen",
    "tabs",
  ],
  host_permissions: [
    "https://www.googleapis.com/*",
    "https://meet.googleapis.com/*",
    "https://accounts.google.com/*",
    "https://meet.google.com/*",
  ],
  oauth2: {
    client_id: "REPLACE_WITH_OAUTH_CLIENT_ID",
    scopes: [
      "https://www.googleapis.com/auth/calendar.events.readonly",
      "https://www.googleapis.com/auth/meetings.space.readonly",
      "https://www.googleapis.com/auth/userinfo.email",
      "https://www.googleapis.com/auth/userinfo.profile",
    ],
  },
});
