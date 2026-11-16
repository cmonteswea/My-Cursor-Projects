import type { MeetEvent } from "./types";
import { extractMeetingCode } from "./meet";

/** Raw Calendar API event shape (subset we care about). */
export interface CalendarApiEvent {
  id?: string;
  summary?: string;
  start?: { dateTime?: string; date?: string; timeZone?: string };
  end?: { dateTime?: string; date?: string; timeZone?: string };
  hangoutLink?: string;
  conferenceData?: {
    entryPoints?: Array<{ entryPointType?: string; uri?: string }>;
    conferenceSolution?: { key?: { type?: string }; name?: string };
  };
  attendees?: Array<{ email?: string; displayName?: string; self?: boolean }>;
  status?: string;
}

export interface CalendarListResponse {
  items?: CalendarApiEvent[];
  error?: { code?: number; message?: string };
}

const MEET_HOST = "meet.google.com";

/** True when the event represents a Google Meet conference. */
export function isMeetEvent(event: CalendarApiEvent): boolean {
  if (!event || event.status === "cancelled") return false;

  // All-day events use start.date without dateTime — skip.
  if (event.start?.date && !event.start?.dateTime) return false;
  if (!event.start?.dateTime) return false;

  const hangout = event.hangoutLink || "";
  if (hangout.includes(MEET_HOST)) return true;

  const solutionType = event.conferenceData?.conferenceSolution?.key?.type;
  if (solutionType === "hangoutsMeet") return true;

  const entryPoints = event.conferenceData?.entryPoints ?? [];
  for (const ep of entryPoints) {
    const uri = ep.uri || "";
    if (
      (ep.entryPointType === "video" || !ep.entryPointType) &&
      uri.includes(MEET_HOST)
    ) {
      return true;
    }
  }

  return false;
}

function pickMeetUrl(event: CalendarApiEvent): string | null {
  if (event.hangoutLink && event.hangoutLink.includes(MEET_HOST)) {
    return event.hangoutLink;
  }
  const entryPoints = event.conferenceData?.entryPoints ?? [];
  for (const ep of entryPoints) {
    const uri = ep.uri || "";
    if (uri.includes(MEET_HOST)) return uri;
  }
  return null;
}

/** Build a stable instance id from event id + start ISO. */
export function makeInstanceId(eventId: string, startIso: string): string {
  return `${eventId}|${startIso}`;
}

/** Convert a Calendar API event into a MeetEvent, or null if not applicable. */
export function toMeetEvent(event: CalendarApiEvent): MeetEvent | null {
  if (!isMeetEvent(event)) return null;
  if (!event.id || !event.start?.dateTime) return null;

  const meetUrl = pickMeetUrl(event);
  if (!meetUrl) return null;

  const meetingCode = extractMeetingCode(meetUrl);
  if (!meetingCode) return null;

  const start = new Date(event.start.dateTime);
  const end = event.end?.dateTime
    ? new Date(event.end.dateTime)
    : new Date(start.getTime() + 60 * 60 * 1000);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;

  return {
    instanceId: makeInstanceId(event.id, start.toISOString()),
    eventId: event.id,
    title: event.summary?.trim() || "(No title)",
    start,
    end,
    meetUrl,
    meetingCode,
  };
}

/** How far before "now" to query so in-progress meetings stay visible. */
export const CALENDAR_LOOKBACK_MS = 12 * 60 * 60 * 1000;

/**
 * Keep meetings that have not ended and that start inside the horizon.
 * Ended meetings are dropped so a lookback query does not re-alert them.
 */
export function isActionableMeetEvent(
  event: MeetEvent,
  now: Date,
  horizonMs: number,
): boolean {
  if (event.end.getTime() <= now.getTime()) return false;
  if (event.start.getTime() > now.getTime() + horizonMs) return false;
  return true;
}

/** Filter + map a list of Calendar API events into MeetEvents. */
export function filterMeetEvents(events: CalendarApiEvent[]): MeetEvent[] {
  const out: MeetEvent[] = [];
  for (const ev of events) {
    const meet = toMeetEvent(ev);
    if (meet) out.push(meet);
  }
  return out;
}

/**
 * Fetch upcoming primary calendar events and return Meet events only.
 * Pure regarding Chrome — takes a token and uses fetch.
 */
export async function fetchCalendarEvents(
  token: string,
  now: Date,
  horizonMs: number,
  fetchImpl: typeof fetch = fetch,
): Promise<MeetEvent[]> {
  const timeMin = new Date(now.getTime() - CALENDAR_LOOKBACK_MS).toISOString();
  const timeMax = new Date(now.getTime() + horizonMs).toISOString();

  const params = new URLSearchParams({
    singleEvents: "true",
    orderBy: "startTime",
    timeMin,
    timeMax,
    maxResults: "50",
    fields:
      "items(id,summary,start,end,hangoutLink,conferenceData,attendees,status)",
  });

  const url = `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`;
  const res = await fetchImpl(url, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (res.status === 401) {
    const err = new Error("Unauthorized");
    (err as Error & { status: number }).status = 401;
    throw err;
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Calendar API ${res.status}: ${body.slice(0, 200)}`);
  }

  const data = (await res.json()) as CalendarListResponse;
  return filterMeetEvents(data.items ?? []).filter((event) =>
    isActionableMeetEvent(event, now, horizonMs),
  );
}

export interface StoredMeetEvent {
  instanceId: string;
  eventId: string;
  title: string;
  start: string;
  end: string;
  meetUrl: string;
  meetingCode: string;
}

export function serializeMeetEvents(events: MeetEvent[]): StoredMeetEvent[] {
  return events.map((event) => ({
    instanceId: event.instanceId,
    eventId: event.eventId,
    title: event.title,
    start: event.start.toISOString(),
    end: event.end.toISOString(),
    meetUrl: event.meetUrl,
    meetingCode: event.meetingCode,
  }));
}

export function deserializeMeetEvents(raw: unknown): MeetEvent[] {
  if (!Array.isArray(raw)) return [];
  const out: MeetEvent[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const row = item as Partial<StoredMeetEvent>;
    if (
      !row.instanceId ||
      !row.eventId ||
      !row.start ||
      !row.end ||
      !row.meetUrl ||
      !row.meetingCode
    ) {
      continue;
    }
    const start = new Date(row.start);
    const end = new Date(row.end);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) continue;
    out.push({
      instanceId: row.instanceId,
      eventId: row.eventId,
      title: row.title?.trim() || "(No title)",
      start,
      end,
      meetUrl: row.meetUrl,
      meetingCode: row.meetingCode,
    });
  }
  return out;
}
