import { defineManifest } from "@crxjs/vite-plugin";

export default defineManifest({
  manifest_version: 3,
  name: "Meet Alert",
  version: "1.0.0",
  // Pins the unpacked extension ID to fjejebimnlglcfcjfkfnpfcaodphpphd so the
  // OAuth client's Application ID keeps matching after rebuilds and moves.
  key: "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAsna0FuiXmtvY8alq/iD1tY1jn/xncOihJmGpGAmWUffom6zJtJst7FKsSslXFqqieL9gM2lHvsA5tkWqxyCsghh7p5b1UtBgSvc2MUcnWixfok1zqFmaE47lsSjBMZNTNtKEa1NOZw5LZy1ABOTDF8maKQlC4z57rKFCxe+ddYwDr4SlZu3IJ3PJw0iymU0HKRqGfbi8KR1LZ/GM5JqawuzQT3NMp6EjSp+kidc3HBhAv7CLC1P/5tMzE2mbGIgwONhokGXkfrhPigkq0d7CM0wO5ukDqtW/oDXnJqXXl3RF7gpjKi3uYq9vTmcE9ysJBaiu588nb4HQTlNrky869QIDAQAB",
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
