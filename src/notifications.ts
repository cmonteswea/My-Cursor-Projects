import type { AlertKind, MeetEvent } from "./types";

export const NOTIFICATION_BUTTONS = [
  { title: "Join" },
  { title: "Dismiss" },
] as const;

export function notificationId(instanceId: string, kind: AlertKind): string {
  return `meet-alert:${kind}:${instanceId}`;
}

export function parseNotificationId(
  id: string,
): { kind: AlertKind; instanceId: string } | null {
  const prefix = "meet-alert:";
  if (!id.startsWith(prefix)) return null;
  const rest = id.slice(prefix.length);
  const sep = rest.indexOf(":");
  if (sep < 0) return null;
  const kind = rest.slice(0, sep);
  const instanceId = rest.slice(sep + 1);
  if (kind !== "pre" && kind !== "guest") return null;
  if (!instanceId) return null;
  return { kind, instanceId };
}

export function formatLocalTime(date: Date): string {
  return date.toLocaleString(undefined, {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function buildPrealertNotification(
  event: MeetEvent,
  leadMinutes: number,
  silent = false,
): chrome.notifications.NotificationOptions<true> {
  return {
    type: "basic",
    iconUrl: "icons/icon128.png",
    title: `Meeting in ${leadMinutes} minutes`,
    message: `${event.title} · ${formatLocalTime(event.start)}`,
    priority: 2,
    requireInteraction: true,
    buttons: [...NOTIFICATION_BUTTONS],
    silent,
  };
}

export function buildGuestNotification(
  event: MeetEvent,
  guestNames: string[],
  silent = false,
): chrome.notifications.NotificationOptions<true> {
  const who =
    guestNames.length > 0 ? guestNames.slice(0, 3).join(", ") : "Someone";
  return {
    type: "basic",
    iconUrl: "icons/icon128.png",
    title: "Guests have joined",
    message: `${event.title} · ${who}`,
    priority: 2,
    requireInteraction: true,
    buttons: [...NOTIFICATION_BUTTONS],
    silent,
  };
}

export function showNotification(
  id: string,
  options: chrome.notifications.NotificationOptions<true>,
): Promise<string> {
  return new Promise((resolve, reject) => {
    chrome.notifications.create(id, options, (createdId) => {
      const err = chrome.runtime.lastError;
      if (err) reject(new Error(err.message));
      else resolve(createdId);
    });
  });
}

export function clearNotification(id: string): Promise<boolean> {
  return new Promise((resolve, reject) => {
    chrome.notifications.clear(id, (wasCleared) => {
      const err = chrome.runtime.lastError;
      if (err) reject(new Error(err.message));
      else resolve(Boolean(wasCleared));
    });
  });
}
