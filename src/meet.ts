import type { ParticipantInfo, SelfIdentity } from "./types";

/** Extract meeting code from a meet.google.com URL. */
export function extractMeetingCode(url: string): string | null {
  try {
    const u = new URL(url);
    if (!u.hostname.includes("meet.google.com")) return null;
    const parts = u.pathname.split("/").filter(Boolean);
    for (const part of parts) {
      if (part === "lookup" || part === "landing") continue;
      if (/^[a-z0-9][-a-z0-9]*$/i.test(part) && part.length >= 3) {
        return part.toLowerCase();
      }
    }
    return null;
  } catch {
    return null;
  }
}

/** Raw Meet API participant resource (subset). */
export interface MeetApiParticipant {
  name?: string;
  user?: string;
  anonymousUser?: { displayName?: string };
  phoneUser?: { displayName?: string };
  signedinUser?: {
    user?: string;
    displayName?: string;
  };
  earliestStartTime?: string;
  latestEndTime?: string;
  /** snake_case variant some serializers emit */
  latest_end_time?: string;
}

export interface MeetApiParticipantsResponse {
  participants?: MeetApiParticipant[];
  nextPageToken?: string;
}

export interface ConferenceRecordSummary {
  name?: string;
  startTime?: string;
  endTime?: string;
}

export interface MeetApiConferenceRecordsResponse {
  conferenceRecords?: ConferenceRecordSummary[];
}

export interface MeetApiSpace {
  name?: string;
  meetingCode?: string;
  meetingUri?: string;
}

function isActiveParticipant(p: MeetApiParticipant): boolean {
  const end = p.latestEndTime ?? p.latest_end_time;
  return end == null || end === "";
}

/** Split Meet `signedinUser.user` into an email and/or a Google user id. */
export function parseSignedInUser(user: string | undefined): {
  email?: string;
  userId?: string;
} {
  if (!user) return {};
  const trimmed = user.trim();
  if (!trimmed) return {};
  if (trimmed.includes("@")) return { email: trimmed.toLowerCase() };
  const userId = trimmed.replace(/^users\//, "");
  return userId ? { userId } : {};
}

export function normalizeSelf(
  self: string | SelfIdentity | null | undefined,
): { email: string; userId: string } {
  if (!self) return { email: "", userId: "" };
  if (typeof self === "string") {
    const parsed = parseSignedInUser(self);
    return { email: parsed.email ?? "", userId: parsed.userId ?? "" };
  }
  const email = (self.email || "").trim().toLowerCase();
  const userId = (self.userId || "").trim().replace(/^users\//, "");
  return { email, userId };
}

export function isSelfParticipant(
  participant: ParticipantInfo,
  self: string | SelfIdentity | null | undefined,
): boolean {
  const id = normalizeSelf(self);
  if (id.userId && participant.userId && participant.userId === id.userId) {
    return true;
  }
  if (id.email && participant.email && participant.email === id.email) {
    return true;
  }
  return false;
}

/** Parse Meet API participant resources into ParticipantInfo. */
export function parseParticipants(
  raw: MeetApiParticipant[] | undefined | null,
): ParticipantInfo[] {
  if (!raw) return [];
  return raw.map((p) => {
    const identity = parseSignedInUser(p.signedinUser?.user);
    const displayName =
      p.signedinUser?.displayName ||
      p.anonymousUser?.displayName ||
      p.phoneUser?.displayName ||
      undefined;
    const anonymous = !identity.email && !identity.userId;
    return {
      email: identity.email,
      userId: identity.userId,
      displayName,
      active: isActiveParticipant(p),
      anonymous,
    };
  });
}

/**
 * A guest has arrived when there is at least one active participant who is
 * not the signed-in user. Anonymous / phone participants count as guests.
 */
export function guestsArrived(
  participants: ParticipantInfo[],
  self: string | SelfIdentity | null | undefined,
): boolean {
  const active = participants.filter((p) => p.active);
  if (active.length === 0) return false;

  for (const p of active) {
    if (isSelfParticipant(p, self)) continue;
    return true;
  }
  return false;
}

/** Display names of active guests (excluding self). */
export function guestDisplayNames(
  participants: ParticipantInfo[],
  self: string | SelfIdentity | null | undefined,
): string[] {
  const names: string[] = [];
  for (const p of participants) {
    if (!p.active) continue;
    if (isSelfParticipant(p, self)) continue;
    if (p.displayName) names.push(p.displayName);
    else if (p.email) names.push(p.email);
    else names.push("Guest");
  }
  return names;
}

/** True when the signed-in user is an active participant. */
export function selfIsActiveParticipant(
  participants: ParticipantInfo[],
  self: string | SelfIdentity | null | undefined,
): boolean {
  const id = normalizeSelf(self);
  if (!id.email && !id.userId) return false;
  return participants.some((p) => p.active && isSelfParticipant(p, id));
}

/**
 * Prefer a conference that is still live (no end time).
 * Ended records are ignored so a previous meeting in the same space
 * does not look like guests are in the room.
 */
export function pickActiveConferenceRecord(
  records: ConferenceRecordSummary[] | undefined | null,
): string | null {
  if (!records?.length) return null;
  const active = records.filter((record) => record.name && !record.endTime);
  active.sort((a, b) => {
    const aStart = a.startTime ? Date.parse(a.startTime) : 0;
    const bStart = b.startTime ? Date.parse(b.startTime) : 0;
    return bStart - aStart;
  });
  return active[0]?.name ?? null;
}

function httpError(message: string, status: number): Error {
  const err = new Error(message);
  (err as Error & { status: number }).status = status;
  return err;
}

export async function fetchSpace(
  token: string,
  meetingCode: string,
  fetchImpl: typeof fetch = fetch,
): Promise<MeetApiSpace> {
  const url = `https://meet.googleapis.com/v2/spaces/${encodeURIComponent(meetingCode)}`;
  const res = await fetchImpl(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 401) throw httpError("Unauthorized", 401);
  if (res.status === 403) throw httpError("Meet API forbidden", 403);
  if (!res.ok) throw new Error(`Meet space API ${res.status}`);
  return (await res.json()) as MeetApiSpace;
}

export async function fetchLatestConferenceRecordName(
  token: string,
  meetingCode: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
  const filter = `space.meeting_code="${meetingCode}"`;
  const params = new URLSearchParams({
    filter,
    pageSize: "25",
  });
  const url = `https://meet.googleapis.com/v2/conferenceRecords?${params}`;
  const res = await fetchImpl(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 401) throw httpError("Unauthorized", 401);
  if (res.status === 403) throw httpError("Meet API forbidden", 403);
  if (!res.ok) throw new Error(`Meet conferenceRecords API ${res.status}`);
  const data = (await res.json()) as MeetApiConferenceRecordsResponse;
  return pickActiveConferenceRecord(data.conferenceRecords);
}

export async function fetchActiveParticipants(
  token: string,
  conferenceRecordName: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ParticipantInfo[]> {
  const filter = "latest_end_time IS NULL";
  const params = new URLSearchParams({ filter, pageSize: "100" });
  const url = `https://meet.googleapis.com/v2/${conferenceRecordName}/participants?${params}`;
  const res = await fetchImpl(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 401) throw httpError("Unauthorized", 401);
  if (res.status === 403) throw httpError("Meet API forbidden", 403);
  if (!res.ok) throw new Error(`Meet participants API ${res.status}`);
  const data = (await res.json()) as MeetApiParticipantsResponse;
  return parseParticipants(data.participants);
}

/**
 * High-level: resolve meeting code → latest live conference → active participants.
 * Returns an empty array when no live conference record exists yet.
 */
export async function fetchMeetingParticipants(
  token: string,
  meetingCode: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ParticipantInfo[]> {
  await fetchSpace(token, meetingCode, fetchImpl);
  const recordName = await fetchLatestConferenceRecordName(
    token,
    meetingCode,
    fetchImpl,
  );
  if (!recordName) return [];
  return fetchActiveParticipants(token, recordName, fetchImpl);
}
