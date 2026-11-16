import type { AlertState, MeetEvent, Settings } from "./types";

export interface AlarmPlan {
  /** chrome.alarms name */
  name: string;
  /** When the alarm should fire */
  when: Date;
}

/** Absolute time for the pre-start alert. */
export function prealertTime(event: MeetEvent, leadMinutes: number): Date {
  return new Date(event.start.getTime() - leadMinutes * 60_000);
}

/**
 * Decide which one-shot alarms to schedule for an event.
 * - pre:<id> at prealert time (if still in the future)
 * - start:<id> at event start (if still in the future) to begin guest polling consideration
 */
export function alarmsForEvent(
  event: MeetEvent,
  settings: Settings,
  now: Date,
  state: AlertState | undefined,
): AlarmPlan[] {
  if (state?.dismissed || state?.joined) return [];

  const plans: AlarmPlan[] = [];
  const pre = prealertTime(event, settings.leadMinutes);

  if (!state?.prealertSent && pre.getTime() > now.getTime()) {
    plans.push({ name: `pre:${event.instanceId}`, when: pre });
  }

  if (event.start.getTime() > now.getTime()) {
    plans.push({ name: `start:${event.instanceId}`, when: event.start });
  }

  return plans;
}

/**
 * Guest-poll window: meeting has started, not yet ended, and alerts not
 * suppressed via dismiss/join.
 */
export function isInGuestPollWindow(
  event: MeetEvent,
  now: Date,
  state: AlertState | undefined,
): boolean {
  if (state?.dismissed || state?.joined) return false;
  return event.start.getTime() <= now.getTime() && now.getTime() < event.end.getTime();
}

/** True when prealert time has passed, meeting not started, and prealert not yet sent. */
export function needsPrealertCatchUp(
  event: MeetEvent,
  settings: Settings,
  now: Date,
  state: AlertState | undefined,
): boolean {
  if (state?.dismissed || state?.joined || state?.prealertSent) return false;
  if (now.getTime() >= event.start.getTime()) return false;
  const pre = prealertTime(event, settings.leadMinutes);
  return now.getTime() >= pre.getTime();
}

export function parseAlarmName(
  name: string,
): { kind: "pre" | "start" | "poll" | "sync"; instanceId?: string } | null {
  if (name === "poll") return { kind: "poll" };
  if (name === "sync") return { kind: "sync" };
  if (name.startsWith("pre:")) return { kind: "pre", instanceId: name.slice(4) };
  if (name.startsWith("start:"))
    return { kind: "start", instanceId: name.slice(6) };
  return null;
}

export const POLL_ALARM_PERIOD_MINUTES = 0.5;
export const SYNC_ALARM_PERIOD_MINUTES = 5;
/** How far ahead to fetch calendar events. */
export const CALENDAR_HORIZON_MS = 24 * 60 * 60 * 1000;
