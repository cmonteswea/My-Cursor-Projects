import type { Settings } from "./types";

export const DEFAULT_SETTINGS: Settings = {
  leadMinutes: 10,
  mute: false,
  oauthClientIdOverride: "",
};

/** Clamp / coerce partial settings into a valid Settings object. */
export function normalizeSettings(raw: unknown): Settings {
  const input =
    raw && typeof raw === "object" ? (raw as Partial<Settings>) : {};

  let leadMinutes =
    typeof input.leadMinutes === "number" && Number.isFinite(input.leadMinutes)
      ? Math.round(input.leadMinutes)
      : DEFAULT_SETTINGS.leadMinutes;

  if (leadMinutes < 0) leadMinutes = 0;
  if (leadMinutes > 24 * 60) leadMinutes = 24 * 60;

  return {
    leadMinutes,
    mute: Boolean(input.mute ?? DEFAULT_SETTINGS.mute),
    oauthClientIdOverride:
      typeof input.oauthClientIdOverride === "string"
        ? input.oauthClientIdOverride.trim()
        : DEFAULT_SETTINGS.oauthClientIdOverride,
  };
}

/**
 * Sign-in uses `chrome.identity.getAuthToken`, which reads the client id
 * from the installed manifest only. An options-page override cannot replace it.
 */
export function hasConfiguredClientId(
  _settings: Settings,
  manifestClientId: string,
): boolean {
  const mid = (manifestClientId || "").trim();
  return Boolean(mid && !mid.includes("REPLACE_WITH"));
}

export function resolveClientId(
  settings: Settings,
  manifestClientId: string,
): string | null {
  const override = settings.oauthClientIdOverride.trim();
  if (override && !override.includes("REPLACE_WITH")) return override;
  const mid = (manifestClientId || "").trim();
  if (mid && !mid.includes("REPLACE_WITH")) return mid;
  return null;
}
