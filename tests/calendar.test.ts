import { describe, expect, it } from "vitest";
import {
  deserializeMeetEvents,
  filterMeetEvents,
  isActionableMeetEvent,
  isMeetEvent,
  makeInstanceId,
  serializeMeetEvents,
  toMeetEvent,
  type CalendarApiEvent,
} from "../src/calendar";

const meetViaHangout: CalendarApiEvent = {
  id: "evt1",
  summary: "Standup",
  start: { dateTime: "2026-11-05T15:00:00-08:00" },
  end: { dateTime: "2026-11-05T15:30:00-08:00" },
  hangoutLink: "https://meet.google.com/abc-defg-hij",
};

const meetViaEntryPoint: CalendarApiEvent = {
  id: "evt2",
  summary: "Design review",
  start: { dateTime: "2026-11-05T16:00:00Z" },
  end: { dateTime: "2026-11-05T17:00:00Z" },
  conferenceData: {
    entryPoints: [
      { entryPointType: "video", uri: "https://meet.google.com/xyz-uvwx-rst" },
    ],
  },
};

const meetViaSolutionKey: CalendarApiEvent = {
  id: "evt3",
  summary: "1:1",
  start: { dateTime: "2026-11-05T18:00:00Z" },
  end: { dateTime: "2026-11-05T18:30:00Z" },
  hangoutLink: "https://meet.google.com/aaa-bbbb-ccc",
  conferenceData: {
    conferenceSolution: { key: { type: "hangoutsMeet" } },
  },
};

const zoomEvent: CalendarApiEvent = {
  id: "zoom1",
  summary: "Zoom call",
  start: { dateTime: "2026-11-05T19:00:00Z" },
  end: { dateTime: "2026-11-05T20:00:00Z" },
  conferenceData: {
    entryPoints: [
      { entryPointType: "video", uri: "https://zoom.us/j/123456789" },
    ],
    conferenceSolution: { key: { type: "addOn" }, name: "Zoom" },
  },
};

const allDay: CalendarApiEvent = {
  id: "allday1",
  summary: "OOO",
  start: { date: "2026-11-05" },
  end: { date: "2026-11-06" },
  hangoutLink: "https://meet.google.com/should-skip",
};

const noConference: CalendarApiEvent = {
  id: "plain1",
  summary: "Focus time",
  start: { dateTime: "2026-11-05T10:00:00Z" },
  end: { dateTime: "2026-11-05T11:00:00Z" },
};

describe("isMeetEvent", () => {
  it("detects hangoutLink Meet URLs", () => {
    expect(isMeetEvent(meetViaHangout)).toBe(true);
  });

  it("detects video entryPoints with meet.google.com", () => {
    expect(isMeetEvent(meetViaEntryPoint)).toBe(true);
  });

  it("detects hangoutsMeet conferenceSolution", () => {
    expect(isMeetEvent(meetViaSolutionKey)).toBe(true);
  });

  it("rejects Zoom conferences", () => {
    expect(isMeetEvent(zoomEvent)).toBe(false);
  });

  it("rejects all-day events even with Meet links", () => {
    expect(isMeetEvent(allDay)).toBe(false);
  });

  it("rejects events with no conference data", () => {
    expect(isMeetEvent(noConference)).toBe(false);
  });
});

describe("toMeetEvent / filterMeetEvents", () => {
  it("builds instance id from event id and start ISO", () => {
    const meet = toMeetEvent(meetViaHangout);
    expect(meet).not.toBeNull();
    expect(meet!.meetingCode).toBe("abc-defg-hij");
    expect(meet!.instanceId).toBe(
      makeInstanceId("evt1", meet!.start.toISOString()),
    );
  });

  it("filters a mixed list down to Meet events only", () => {
    const result = filterMeetEvents([
      meetViaHangout,
      zoomEvent,
      allDay,
      noConference,
      meetViaEntryPoint,
    ]);
    expect(result.map((e) => e.eventId).sort()).toEqual(["evt1", "evt2"]);
  });

  it("drops meetings that already ended and keeps ones in progress", () => {
    const now = new Date("2026-11-05T15:10:00.000Z");
    const ended = toMeetEvent({
      id: "done",
      summary: "Done",
      start: { dateTime: "2026-11-05T14:00:00.000Z" },
      end: { dateTime: "2026-11-05T15:00:00.000Z" },
      hangoutLink: "https://meet.google.com/aaa-bbbb-ccc",
    })!;
    const live = toMeetEvent({
      id: "live",
      summary: "Live",
      start: { dateTime: "2026-11-05T15:00:00.000Z" },
      end: { dateTime: "2026-11-05T15:30:00.000Z" },
      hangoutLink: "https://meet.google.com/bbb-cccc-ddd",
    })!;
    const horizon = 24 * 60 * 60 * 1000;
    expect(isActionableMeetEvent(ended, now, horizon)).toBe(false);
    expect(isActionableMeetEvent(live, now, horizon)).toBe(true);
  });

  it("round-trips events through storage JSON", () => {
    const meet = toMeetEvent(meetViaHangout)!;
    const restored = deserializeMeetEvents(serializeMeetEvents([meet]));
    expect(restored).toHaveLength(1);
    expect(restored[0].instanceId).toBe(meet.instanceId);
    expect(restored[0].start.toISOString()).toBe(meet.start.toISOString());
    expect(restored[0].meetingCode).toBe(meet.meetingCode);
  });
});
