/** Normalized Meet calendar event used throughout the extension. */
export interface MeetEvent {
  /** Stable instance id: event.id + "|" + start ISO */
  instanceId: string;
  eventId: string;
  title: string;
  start: Date;
  end: Date;
  meetUrl: string;
  meetingCode: string;
}

export interface Settings {
  /** Minutes before start for the pre-alert. Default 10. */
  leadMinutes: number;
  /** When true, skip the offscreen chime. */
  mute: boolean;
  /** Optional OAuth client id override (stored in options). */
  oauthClientIdOverride: string;
}

export type AlertKind = "pre" | "guest";

export interface AlertState {
  instanceId: string;
  /** Pre-alert already fired (or catch-up fired). */
  prealertSent: boolean;
  /** Guest-joined alert already fired. */
  guestAlertSent: boolean;
  /** User dismissed — suppress further alerts for this instance. */
  dismissed: boolean;
  /** User pressed Join (or self detected in Meet) — stop further alerts. */
  joined: boolean;
  /** Whether a sticky notification is currently expected to be visible. */
  notificationVisible: boolean;
  /** Which alert kind the current/last sticky notification represents. */
  activeAlertKind: AlertKind | null;
  /** Display names of guests shown in the last guest alert, if any. */
  guestNames: string[];
}

export interface ParticipantInfo {
  /** Email if the Meet payload included one (not typical for Meet API v2). */
  email?: string;
  /**
   * Google user id without the `users/` prefix.
   * Meet API `signedinUser.user` is `users/{id}`, not an email.
   */
  userId?: string;
  displayName?: string;
  /** True when session has no end time (still in the call). */
  active: boolean;
  /** True when no email and no user id (anonymous / phone). */
  anonymous: boolean;
}

/** Signed-in account, used to tell "you" apart from guests. */
export interface SelfIdentity {
  email?: string | null;
  /** Google account id from userinfo (`id`), without a `users/` prefix. */
  userId?: string | null;
}

export interface StorageSnapshot {
  settings: Settings;
  alertStates: Record<string, AlertState>;
  lastError: string | null;
  meetApiError: string | null;
  accountEmail: string | null;
}

export const STORAGE_KEYS = {
  settings: "settings",
  alertStates: "alertStates",
  lastError: "lastError",
  meetApiError: "meetApiError",
  accountEmail: "accountEmail",
  accountUserId: "accountUserId",
  meetEvents: "meetEvents",
} as const;
