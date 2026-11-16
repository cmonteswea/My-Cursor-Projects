import { describe, expect, it } from "vitest";
import {
  alarmsForEvent,
  isInGuestPollWindow,
  needsPrealertCatchUp,
  parseAlarmName,
  prealertTime,
} from "../src/schedule";
import { createInitialAlertState, reduceAlertState } from "../src/state";
import { DEFAULT_SETTINGS } from "../src/settings";
import type { MeetEvent } from "../src/types";

function eventAt(startIso: string, endIso: string): MeetEvent {
  return {
    instanceId: `id|${startIso}`,
    eventId: "id",
    title: "Test",
    start: new Date(startIso),
    end: new Date(endIso),
    meetUrl: "https://meet.google.com/abc-defg-hij",
    meetingCode: "abc-defg-hij",
  };
}

describe("prealertTime", () => {
  it("subtracts lead minutes from start", () => {
    const ev = eventAt("2026-11-05T15:00:00.000Z", "2026-11-05T16:00:00.000Z");
    const pre = prealertTime(ev, 10);
    expect(pre.toISOString()).toBe("2026-11-05T14:50:00.000Z");
  });
});

describe("alarmsForEvent", () => {
  it("schedules pre and start when both are in the future", () => {
    const ev = eventAt("2026-11-05T15:00:00.000Z", "2026-11-05T16:00:00.000Z");
    const now = new Date("2026-11-05T14:00:00.000Z");
    const plans = alarmsForEvent(ev, DEFAULT_SETTINGS, now, undefined);
    expect(plans.map((p) => p.name)).toEqual([
      `pre:${ev.instanceId}`,
      `start:${ev.instanceId}`,
    ]);
  });

  it("skips alarms after dismiss", () => {
    const ev = eventAt("2026-11-05T15:00:00.000Z", "2026-11-05T16:00:00.000Z");
    const now = new Date("2026-11-05T14:00:00.000Z");
    const state = reduceAlertState(createInitialAlertState(ev.instanceId), {
      type: "DISMISS",
    });
    expect(alarmsForEvent(ev, DEFAULT_SETTINGS, now, state)).toEqual([]);
  });
});

describe("guest window and catch-up", () => {
  it("polls only between start and end", () => {
    const ev = eventAt("2026-11-05T15:00:00.000Z", "2026-11-05T16:00:00.000Z");
    expect(
      isInGuestPollWindow(ev, new Date("2026-11-05T15:10:00.000Z"), undefined),
    ).toBe(true);
    expect(
      isInGuestPollWindow(ev, new Date("2026-11-05T14:00:00.000Z"), undefined),
    ).toBe(false);
  });

  it("catches up a missed pre-alert before start", () => {
    const ev = eventAt("2026-11-05T15:00:00.000Z", "2026-11-05T16:00:00.000Z");
    expect(
      needsPrealertCatchUp(
        ev,
        DEFAULT_SETTINGS,
        new Date("2026-11-05T14:55:00.000Z"),
        undefined,
      ),
    ).toBe(true);
  });
});

describe("parseAlarmName", () => {
  it("parses poll, sync, and per-event alarms", () => {
    expect(parseAlarmName("poll")).toEqual({ kind: "poll" });
    expect(parseAlarmName("sync")).toEqual({ kind: "sync" });
    expect(parseAlarmName("pre:evt|2026-11-05T15:00:00.000Z")).toEqual({
      kind: "pre",
      instanceId: "evt|2026-11-05T15:00:00.000Z",
    });
  });
});
