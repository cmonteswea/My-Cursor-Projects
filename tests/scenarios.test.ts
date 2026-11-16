import { describe, expect, it } from "vitest";
import { filterMeetEvents, type CalendarApiEvent } from "../src/calendar";
import {
  guestDisplayNames,
  guestsArrived,
  parseParticipants,
  selfIsActiveParticipant,
} from "../src/meet";
import { parseNotificationId } from "../src/notifications";
import { needsPrealertCatchUp, prealertTime } from "../src/schedule";
import { DEFAULT_SETTINGS } from "../src/settings";
import {
  createInitialAlertState,
  reduceAlertState,
  shouldReshowNotification,
} from "../src/state";
import type { MeetEvent } from "../src/types";

const start = new Date("2026-11-05T15:00:00.000Z");
const event: MeetEvent = {
  instanceId: "evt|2026-11-05T15:00:00.000Z",
  eventId: "evt",
  title: "Design review",
  start,
  end: new Date("2026-11-05T15:30:00.000Z"),
  meetUrl: "https://meet.google.com/abc-defg-hij",
  meetingCode: "abc-defg-hij",
};

describe("verification scenarios", () => {
  it("skips non-Meet events", () => {
    const items: CalendarApiEvent[] = [
      {
        id: "zoom",
        summary: "Zoom",
        start: { dateTime: "2026-11-05T15:00:00.000Z" },
        end: { dateTime: "2026-11-05T16:00:00.000Z" },
        conferenceData: {
          entryPoints: [{ entryPointType: "video", uri: "https://zoom.us/j/1" }],
        },
      },
      {
        id: "allday",
        summary: "OOO",
        start: { date: "2026-11-05" },
        hangoutLink: "https://meet.google.com/abc-defg-hij",
      },
    ];
    expect(filterMeetEvents(items)).toEqual([]);
  });

  it("schedules the pre-alert 10 minutes before start", () => {
    expect(prealertTime(event, DEFAULT_SETTINGS.leadMinutes).toISOString()).toBe(
      "2026-11-05T14:50:00.000Z",
    );
    const now = new Date("2026-11-05T14:50:00.000Z");
    expect(needsPrealertCatchUp(event, DEFAULT_SETTINGS, now, undefined)).toBe(
      true,
    );
  });

  it("keeps a sticky alert until dismiss, and does not re-alert after dismiss", () => {
    let state = reduceAlertState(createInitialAlertState(event.instanceId), {
      type: "PREALERT_SHOWN",
    });
    state = reduceAlertState(state, { type: "NOTIFICATION_CLOSED" });
    expect(shouldReshowNotification(state)).toBe(true);
    state = reduceAlertState(state, { type: "DISMISS" });
    expect(shouldReshowNotification(state)).toBe(false);
    expect(
      needsPrealertCatchUp(
        event,
        DEFAULT_SETTINGS,
        new Date("2026-11-05T14:55:00.000Z"),
        state,
      ),
    ).toBe(false);
  });

  it("alerts when someone other than you has joined, then clears when you join", () => {
    const participants = parseParticipants([
      { signedinUser: { user: "users/111", displayName: "You" } },
      { signedinUser: { user: "users/222", displayName: "Guest" } },
    ]);
    const self = { email: "you@wmg.com", userId: "111" };
    expect(selfIsActiveParticipant(participants, self)).toBe(true);
    expect(guestsArrived(participants, self)).toBe(true);
    expect(guestDisplayNames(participants, self)).toEqual(["Guest"]);

    let state = reduceAlertState(createInitialAlertState(event.instanceId), {
      type: "GUEST_ALERT_SHOWN",
      guestNames: ["Guest"],
    });
    state = reduceAlertState(state, { type: "YOU_JOINED" });
    expect(state.joined).toBe(true);
    expect(shouldReshowNotification(state)).toBe(false);
  });

  it("parses notification ids that contain ISO timestamps", () => {
    const id = `meet-alert:guest:${event.instanceId}`;
    expect(parseNotificationId(id)).toEqual({
      kind: "guest",
      instanceId: event.instanceId,
    });
  });
});
