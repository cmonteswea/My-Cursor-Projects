import type { AlertKind, AlertState } from "./types";

export function createInitialAlertState(instanceId: string): AlertState {
  return {
    instanceId,
    prealertSent: false,
    guestAlertSent: false,
    dismissed: false,
    joined: false,
    notificationVisible: false,
    activeAlertKind: null,
    guestNames: [],
  };
}

export function ensureState(
  states: Record<string, AlertState>,
  instanceId: string,
): AlertState {
  if (!states[instanceId]) {
    states[instanceId] = createInitialAlertState(instanceId);
  }
  return states[instanceId];
}

export type AlertAction =
  | { type: "PREALERT_SHOWN"; guestNames?: string[] }
  | { type: "GUEST_ALERT_SHOWN"; guestNames: string[] }
  | { type: "DISMISS" }
  | { type: "JOIN" }
  | { type: "YOU_JOINED" }
  | { type: "NOTIFICATION_CLOSED" }
  | { type: "NOTIFICATION_RESHOWN" };

/**
 * Pure reducer for per-event alert state transitions.
 */
export function reduceAlertState(
  state: AlertState,
  action: AlertAction,
): AlertState {
  switch (action.type) {
    case "PREALERT_SHOWN":
      if (state.dismissed || state.joined) return state;
      return {
        ...state,
        prealertSent: true,
        notificationVisible: true,
        activeAlertKind: "pre",
      };

    case "GUEST_ALERT_SHOWN":
      if (state.dismissed || state.joined) return state;
      return {
        ...state,
        guestAlertSent: true,
        notificationVisible: true,
        activeAlertKind: "guest",
        guestNames: action.guestNames,
      };

    case "DISMISS":
      return {
        ...state,
        dismissed: true,
        notificationVisible: false,
        activeAlertKind: null,
      };

    case "JOIN":
    case "YOU_JOINED":
      return {
        ...state,
        joined: true,
        notificationVisible: false,
        activeAlertKind: null,
      };

    case "NOTIFICATION_CLOSED":
      // OS swipe / close without dismiss/join — mark invisible so poll can reshow.
      if (state.dismissed || state.joined) {
        return { ...state, notificationVisible: false, activeAlertKind: null };
      }
      return {
        ...state,
        notificationVisible: false,
      };

    case "NOTIFICATION_RESHOWN":
      if (state.dismissed || state.joined) return state;
      return {
        ...state,
        notificationVisible: true,
      };

    default:
      return state;
  }
}

/** Whether we should re-show a sticky notification on the next poll. */
export function shouldReshowNotification(state: AlertState): boolean {
  if (state.dismissed || state.joined) return false;
  if (state.notificationVisible) return false;
  if (!state.activeAlertKind) return false;
  // Alert was sent but notification is no longer visible.
  if (state.activeAlertKind === "pre" && state.prealertSent) return true;
  if (state.activeAlertKind === "guest" && state.guestAlertSent) return true;
  return false;
}

export function activeKind(state: AlertState): AlertKind | null {
  return state.activeAlertKind;
}
