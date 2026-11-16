import { describe, expect, it } from "vitest";
import {
  createInitialAlertState,
  reduceAlertState,
  shouldReshowNotification,
} from "../src/state";

describe("alert state machine", () => {
  it("fires prealert then marks visible", () => {
    let s = createInitialAlertState("a|1");
    s = reduceAlertState(s, { type: "PREALERT_SHOWN" });
    expect(s.prealertSent).toBe(true);
    expect(s.notificationVisible).toBe(true);
    expect(s.activeAlertKind).toBe("pre");
  });

  it("dismiss suppresses further alerts and blocks reshow", () => {
    let s = createInitialAlertState("a|1");
    s = reduceAlertState(s, { type: "PREALERT_SHOWN" });
    s = reduceAlertState(s, { type: "DISMISS" });
    expect(s.dismissed).toBe(true);
    expect(s.notificationVisible).toBe(false);
    expect(shouldReshowNotification(s)).toBe(false);

    const afterGuest = reduceAlertState(s, {
      type: "GUEST_ALERT_SHOWN",
      guestNames: ["X"],
    });
    expect(afterGuest.guestAlertSent).toBe(false);
  });

  it("join clears and stops further alerts", () => {
    let s = createInitialAlertState("a|1");
    s = reduceAlertState(s, {
      type: "GUEST_ALERT_SHOWN",
      guestNames: ["Sam"],
    });
    s = reduceAlertState(s, { type: "JOIN" });
    expect(s.joined).toBe(true);
    expect(s.notificationVisible).toBe(false);
    expect(shouldReshowNotification(s)).toBe(false);
  });

  it("you-joined auto-clears like join", () => {
    let s = createInitialAlertState("a|1");
    s = reduceAlertState(s, { type: "PREALERT_SHOWN" });
    s = reduceAlertState(s, { type: "YOU_JOINED" });
    expect(s.joined).toBe(true);
    expect(shouldReshowNotification(s)).toBe(false);
  });

  it("reshows when notification closed without dismiss/join", () => {
    let s = createInitialAlertState("a|1");
    s = reduceAlertState(s, { type: "PREALERT_SHOWN" });
    s = reduceAlertState(s, { type: "NOTIFICATION_CLOSED" });
    expect(s.notificationVisible).toBe(false);
    expect(s.activeAlertKind).toBe("pre");
    expect(shouldReshowNotification(s)).toBe(true);

    s = reduceAlertState(s, { type: "NOTIFICATION_RESHOWN" });
    expect(s.notificationVisible).toBe(true);
    expect(shouldReshowNotification(s)).toBe(false);
  });
});
