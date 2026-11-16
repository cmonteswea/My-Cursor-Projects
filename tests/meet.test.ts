import { describe, expect, it } from "vitest";
import {
  extractMeetingCode,
  guestDisplayNames,
  guestsArrived,
  parseParticipants,
  pickActiveConferenceRecord,
  selfIsActiveParticipant,
  type MeetApiParticipant,
} from "../src/meet";

describe("extractMeetingCode", () => {
  it("parses standard meet URLs", () => {
    expect(extractMeetingCode("https://meet.google.com/abc-defg-hij")).toBe(
      "abc-defg-hij",
    );
  });

  it("returns null for non-meet hosts", () => {
    expect(extractMeetingCode("https://zoom.us/j/123")).toBeNull();
  });
});

describe("parseParticipants & guestsArrived", () => {
  const self = "me@example.com";

  it("treats only-self active as no guests", () => {
    const raw: MeetApiParticipant[] = [
      { signedinUser: { user: "me@example.com", displayName: "Me" } },
    ];
    const parts = parseParticipants(raw);
    expect(guestsArrived(parts, self)).toBe(false);
    expect(selfIsActiveParticipant(parts, self)).toBe(true);
  });

  it("detects another signed-in person as a guest", () => {
    const raw: MeetApiParticipant[] = [
      { signedinUser: { user: "me@example.com", displayName: "Me" } },
      { signedinUser: { user: "other@example.com", displayName: "Other" } },
    ];
    const parts = parseParticipants(raw);
    expect(guestsArrived(parts, self)).toBe(true);
    expect(guestDisplayNames(parts, self)).toEqual(["Other"]);
  });

  it("counts anonymous participants as guests", () => {
    const raw: MeetApiParticipant[] = [
      { anonymousUser: { displayName: "Caller" } },
    ];
    const parts = parseParticipants(raw);
    expect(parts[0].anonymous).toBe(true);
    expect(guestsArrived(parts, self)).toBe(true);
  });

  it("ignores ended sessions (latestEndTime set)", () => {
    const raw: MeetApiParticipant[] = [
      {
        signedinUser: { user: "other@example.com", displayName: "Other" },
        latestEndTime: "2026-11-05T15:10:00Z",
      },
    ];
    const parts = parseParticipants(raw);
    expect(parts[0].active).toBe(false);
    expect(guestsArrived(parts, self)).toBe(false);
  });

  it("accepts snake_case latest_end_time as ended", () => {
    const raw: MeetApiParticipant[] = [
      {
        signedinUser: { user: "other@example.com" },
        latest_end_time: "2026-11-05T15:10:00Z",
      },
    ];
    expect(parseParticipants(raw)[0].active).toBe(false);
  });

  it("compares emails case-insensitively", () => {
    const raw: MeetApiParticipant[] = [
      { signedinUser: { user: "Me@Example.com" } },
    ];
    expect(guestsArrived(parseParticipants(raw), "me@example.com")).toBe(false);
  });

  it("treats Meet users/{id} as you and everyone else as a guest", () => {
    const raw: MeetApiParticipant[] = [
      { signedinUser: { user: "users/111", displayName: "Me" } },
      { signedinUser: { user: "users/222", displayName: "Sam" } },
    ];
    const parts = parseParticipants(raw);
    const identity = { email: "me@example.com", userId: "111" };
    expect(parts[0].anonymous).toBe(false);
    expect(parts[0].userId).toBe("111");
    expect(selfIsActiveParticipant(parts, identity)).toBe(true);
    expect(guestsArrived(parts, identity)).toBe(true);
    expect(guestDisplayNames(parts, identity)).toEqual(["Sam"]);
  });

  it("does not alert when the only active participant is you", () => {
    const raw: MeetApiParticipant[] = [
      { signedinUser: { user: "users/111", displayName: "Me" } },
    ];
    expect(
      guestsArrived(parseParticipants(raw), { userId: "111", email: null }),
    ).toBe(false);
  });
});

describe("pickActiveConferenceRecord", () => {
  it("ignores ended conferences and picks the live one", () => {
    expect(
      pickActiveConferenceRecord([
        {
          name: "conferenceRecords/old",
          startTime: "2026-11-05T14:00:00Z",
          endTime: "2026-11-05T15:00:00Z",
        },
        {
          name: "conferenceRecords/live",
          startTime: "2026-11-05T16:00:00Z",
        },
      ]),
    ).toBe("conferenceRecords/live");
  });

  it("returns null when nobody is in a live conference", () => {
    expect(
      pickActiveConferenceRecord([
        {
          name: "conferenceRecords/old",
          endTime: "2026-11-05T15:00:00Z",
        },
      ]),
    ).toBeNull();
  });
});
