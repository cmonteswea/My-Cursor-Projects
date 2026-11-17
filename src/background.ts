import {
  deserializeMeetEvents,
  fetchCalendarEvents,
  serializeMeetEvents,
} from "./calendar";
import {
  CALENDAR_HORIZON_MS,
  POLL_ALARM_PERIOD_MINUTES,
  SYNC_ALARM_PERIOD_MINUTES,
  alarmsForEvent,
  isInGuestPollWindow,
  needsPrealertCatchUp,
  parseAlarmName,
} from "./schedule";
import {
  fetchMeetingParticipants,
  guestDisplayNames,
  guestsArrived,
  selfIsActiveParticipant,
} from "./meet";
import {
  DEFAULT_SETTINGS,
  hasConfiguredClientId,
  normalizeSettings,
} from "./settings";
import {
  createInitialAlertState,
  ensureState,
  reduceAlertState,
  shouldReshowNotification,
} from "./state";
import {
  buildGuestNotification,
  buildPrealertNotification,
  clearNotification,
  notificationId,
  parseNotificationId,
  showNotification,
} from "./notifications";
import type { AlertState, MeetEvent, SelfIdentity, Settings } from "./types";
import { STORAGE_KEYS } from "./types";

const OFFSCREEN_URL = "src/audio/offscreen.html";
const PLACEHOLDER_CLIENT = "REPLACE_WITH_OAUTH_CLIENT_ID";

/** Notification ids we closed ourselves; onClosed must not treat those as a swipe-away. */
const ignoreClose = new Set<string>();

/** Serialize storage mutations so Join/Dismiss cannot be overwritten by onClosed. */
let stateQueue: Promise<void> = Promise.resolve();

function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const run = stateQueue.then(fn, fn);
  stateQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function getSettings(): Promise<Settings> {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.settings);
  return normalizeSettings(stored[STORAGE_KEYS.settings]);
}

async function getAlertStates(): Promise<Record<string, AlertState>> {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.alertStates);
  const raw = stored[STORAGE_KEYS.alertStates];
  return raw && typeof raw === "object"
    ? (raw as Record<string, AlertState>)
    : {};
}

async function saveAlertStates(
  states: Record<string, AlertState>,
): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEYS.alertStates]: states });
}

async function setBadge(error: string | null): Promise<void> {
  if (error) {
    await chrome.action.setBadgeBackgroundColor({ color: "#b3261e" });
    await chrome.action.setBadgeText({ text: "!" });
    await chrome.action.setTitle({
      title: `Meet Alert is not working: ${error}\nClick to open settings.`,
    });
  } else {
    await chrome.action.setBadgeText({ text: "" });
    await chrome.action.setTitle({ title: "Meet Alert" });
  }
}

async function setLastError(msg: string | null): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEYS.lastError]: msg });
  await setBadge(msg);
}

async function setMeetApiError(msg: string | null): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEYS.meetApiError]: msg });
}

async function getAccountEmail(): Promise<string | null> {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.accountEmail);
  const v = stored[STORAGE_KEYS.accountEmail];
  return typeof v === "string" && v ? v : null;
}

async function setAccountEmail(email: string | null): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEYS.accountEmail]: email });
}

async function getAccountUserId(): Promise<string | null> {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.accountUserId);
  const v = stored[STORAGE_KEYS.accountUserId];
  return typeof v === "string" && v ? v : null;
}

async function setAccountUserId(userId: string | null): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEYS.accountUserId]: userId });
}

async function getSelfIdentity(): Promise<SelfIdentity> {
  const [email, userId] = await Promise.all([
    getAccountEmail(),
    getAccountUserId(),
  ]);
  return { email, userId };
}

function manifestClientId(): string {
  try {
    const manifest = chrome.runtime.getManifest() as chrome.runtime.ManifestV3;
    return manifest.oauth2?.client_id ?? PLACEHOLDER_CLIENT;
  } catch {
    return PLACEHOLDER_CLIENT;
  }
}

async function getAuthToken(interactive: boolean): Promise<string> {
  const settings = await getSettings();
  if (!hasConfiguredClientId(settings, manifestClientId())) {
    throw new Error(
      "OAuth client ID not configured. Replace REPLACE_WITH_OAUTH_CLIENT_ID in src/manifest.ts and rebuild.",
    );
  }

  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive }, (token) => {
      const err = chrome.runtime.lastError;
      if (err || !token) {
        reject(new Error(err?.message || "Failed to get auth token"));
        return;
      }
      resolve(token);
    });
  });
}

async function removeCachedAuthToken(token: string): Promise<void> {
  return new Promise((resolve) => {
    chrome.identity.removeCachedAuthToken({ token }, () => resolve());
  });
}

async function withAuth<T>(
  interactive: boolean,
  fn: (token: string) => Promise<T>,
): Promise<T> {
  let token = await getAuthToken(interactive);
  try {
    return await fn(token);
  } catch (err) {
    const status = (err as { status?: number })?.status;
    if (status === 401) {
      await removeCachedAuthToken(token);
      token = await getAuthToken(interactive);
      return await fn(token);
    }
    throw err;
  }
}

async function fetchAccountProfile(
  token: string,
): Promise<{ email: string | null; userId: string | null }> {
  try {
    const res = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return { email: null, userId: null };
    const data = (await res.json()) as { email?: string; id?: string };
    return {
      email: data.email?.toLowerCase() ?? null,
      userId: data.id ? String(data.id) : null,
    };
  } catch {
    return { email: null, userId: null };
  }
}

async function ensureOffscreen(): Promise<void> {
  const contexts = await chrome.runtime.getContexts?.({
    contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
  });
  if (contexts && contexts.length > 0) return;

  try {
    await chrome.offscreen.createDocument({
      url: OFFSCREEN_URL,
      reasons: [chrome.offscreen.Reason.AUDIO_PLAYBACK],
      justification: "Play meeting alert chime when no tab is focused",
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!/already|exists/i.test(msg)) {
      console.warn("offscreen create failed", msg);
    }
  }
}

async function playChime(force = false): Promise<void> {
  const settings = await getSettings();
  if (settings.mute && !force) return;
  try {
    await ensureOffscreen();
    await chrome.runtime.sendMessage({ type: "PLAY_CHIME" });
  } catch (err) {
    console.warn("chime failed", err);
  }
}

let cachedEvents: MeetEvent[] | null = null;

async function getEvents(): Promise<MeetEvent[]> {
  if (cachedEvents) return cachedEvents;
  const stored = await chrome.storage.local.get(STORAGE_KEYS.meetEvents);
  cachedEvents = deserializeMeetEvents(stored[STORAGE_KEYS.meetEvents]);
  return cachedEvents;
}

async function setEvents(events: MeetEvent[]): Promise<void> {
  cachedEvents = events;
  await chrome.storage.local.set({
    [STORAGE_KEYS.meetEvents]: serializeMeetEvents(events),
  });
}

function pruneAlertStates(
  states: Record<string, AlertState>,
  events: MeetEvent[],
): Record<string, AlertState> {
  const live = new Set(events.map((event) => event.instanceId));
  const next: Record<string, AlertState> = {};
  for (const [id, state] of Object.entries(states)) {
    if (live.has(id)) next[id] = state;
  }
  return next;
}

async function clearNotificationQuiet(id: string): Promise<void> {
  ignoreClose.add(id);
  try {
    await clearNotification(id);
  } finally {
    setTimeout(() => ignoreClose.delete(id), 2000);
  }
}

async function openMeetUrl(url: string): Promise<void> {
  await chrome.tabs.create({ url, active: true });
}

async function firePrealert(event: MeetEvent, settings: Settings): Promise<void> {
  const states = await getAlertStates();
  const state = ensureState(states, event.instanceId);
  if (state.dismissed || state.joined || state.prealertSent) {
    await saveAlertStates(states);
    return;
  }

  const id = notificationId(event.instanceId, "pre");
  await showNotification(
    id,
    buildPrealertNotification(event, settings.leadMinutes, settings.mute),
  );
  states[event.instanceId] = reduceAlertState(state, { type: "PREALERT_SHOWN" });
  await saveAlertStates(states);
  await playChime();
}

async function fireGuestAlert(event: MeetEvent, names: string[]): Promise<void> {
  const states = await getAlertStates();
  const state = ensureState(states, event.instanceId);
  if (state.dismissed || state.joined || state.guestAlertSent) {
    await saveAlertStates(states);
    return;
  }

  const settings = await getSettings();
  await clearNotificationQuiet(notificationId(event.instanceId, "pre"));
  const id = notificationId(event.instanceId, "guest");
  await showNotification(id, buildGuestNotification(event, names, settings.mute));
  states[event.instanceId] = reduceAlertState(state, {
    type: "GUEST_ALERT_SHOWN",
    guestNames: names,
  });
  await saveAlertStates(states);
  await playChime();
}

async function reshowIfNeeded(
  event: MeetEvent,
  state: AlertState,
): Promise<AlertState> {
  if (!shouldReshowNotification(state) || !state.activeAlertKind) return state;
  const settings = await getSettings();
  const kind = state.activeAlertKind;
  const id = notificationId(event.instanceId, kind);
  if (kind === "pre") {
    await showNotification(
      id,
      buildPrealertNotification(event, settings.leadMinutes, settings.mute),
    );
  } else {
    await showNotification(
      id,
      buildGuestNotification(event, state.guestNames, settings.mute),
    );
  }
  return reduceAlertState(state, { type: "NOTIFICATION_RESHOWN" });
}

async function reconcileAlarms(
  events: MeetEvent[],
  settings: Settings,
): Promise<void> {
  const now = new Date();
  const states = await getAlertStates();

  const all = await chrome.alarms.getAll();
  for (const a of all) {
    if (a.name.startsWith("pre:") || a.name.startsWith("start:")) {
      await chrome.alarms.clear(a.name);
    }
  }

  for (const event of events) {
    const state = states[event.instanceId];
    for (const plan of alarmsForEvent(event, settings, now, state)) {
      await chrome.alarms.create(plan.name, { when: plan.when.getTime() });
    }
  }

  await chrome.alarms.create("poll", {
    periodInMinutes: POLL_ALARM_PERIOD_MINUTES,
  });
  await chrome.alarms.create("sync", {
    periodInMinutes: SYNC_ALARM_PERIOD_MINUTES,
  });
}

async function syncCalendar(interactive = false): Promise<void> {
  try {
    const settings = await getSettings();
    if (!hasConfiguredClientId(settings, manifestClientId())) {
      await setLastError(
        "OAuth client ID not configured. Replace REPLACE_WITH_OAUTH_CLIENT_ID in src/manifest.ts and rebuild.",
      );
      return;
    }

    const events = await withAuth(interactive, async (token) => {
      const profile = await fetchAccountProfile(token);
      if (profile.email) await setAccountEmail(profile.email);
      if (profile.userId) await setAccountUserId(profile.userId);
      return fetchCalendarEvents(token, new Date(), CALENDAR_HORIZON_MS);
    });

    await setEvents(events);
    let states = pruneAlertStates(await getAlertStates(), events);
    await saveAlertStates(states);
    await setLastError(null);
    await reconcileAlarms(events, settings);

    const now = new Date();
    states = await getAlertStates();
    for (const event of events) {
      const state = states[event.instanceId];
      if (needsPrealertCatchUp(event, settings, now, state)) {
        await firePrealert(event, settings);
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("sync failed", msg);
    await setLastError(msg);
  }
}

async function pollGuests(): Promise<void> {
  const now = new Date();
  const settings = await getSettings();
  let states = await getAlertStates();

  let events = await getEvents();
  if (events.length === 0) {
    try {
      await syncCalendar(false);
    } catch {
      /* lastError already set */
    }
    events = await getEvents();
  }
  let meetError: string | null = null;
  const self = await getSelfIdentity();

  for (const event of events) {
    let state = ensureState(states, event.instanceId);

    if (needsPrealertCatchUp(event, settings, now, state)) {
      await firePrealert(event, settings);
      states = await getAlertStates();
      state = ensureState(states, event.instanceId);
    }

    if (shouldReshowNotification(state)) {
      state = await reshowIfNeeded(event, state);
      states[event.instanceId] = state;
      await saveAlertStates(states);
    }

    if (!isInGuestPollWindow(event, now, state)) continue;

    try {
      const participants = await withAuth(false, (token) =>
        fetchMeetingParticipants(token, event.meetingCode),
      );

      if (selfIsActiveParticipant(participants, self)) {
        state = reduceAlertState(state, { type: "YOU_JOINED" });
        states[event.instanceId] = state;
        await saveAlertStates(states);
        await clearNotification(notificationId(event.instanceId, "pre"));
        await clearNotification(notificationId(event.instanceId, "guest"));
        continue;
      }

      if (!state.guestAlertSent && guestsArrived(participants, self)) {
        const names = guestDisplayNames(participants, self);
        await fireGuestAlert(event, names);
        states = await getAlertStates();
      }
    } catch (err) {
      const status = (err as { status?: number })?.status;
      const msg = err instanceof Error ? err.message : String(err);
      if (status === 403) {
        meetError =
          "Meet API returned 403 — check that meetings.space.readonly is granted and the Meet API is enabled.";
      } else {
        meetError = msg;
      }
      console.warn("guest poll error", event.instanceId, msg);
    }
  }

  await setMeetApiError(meetError);
}

async function findEvent(instanceId: string): Promise<MeetEvent | undefined> {
  const events = await getEvents();
  return events.find((e) => e.instanceId === instanceId);
}

chrome.notifications.onButtonClicked.addListener((id, buttonIndex) => {
  void enqueue(async () => {
    const parsed = parseNotificationId(id);
    if (!parsed) return;
    const states = await getAlertStates();
    const state = ensureState(states, parsed.instanceId);
    const event = await findEvent(parsed.instanceId);

    if (buttonIndex === 0) {
      states[parsed.instanceId] = reduceAlertState(state, { type: "JOIN" });
      await saveAlertStates(states);
      await clearNotification(id);
      if (event) await openMeetUrl(event.meetUrl);
    } else if (buttonIndex === 1) {
      states[parsed.instanceId] = reduceAlertState(state, { type: "DISMISS" });
      await saveAlertStates(states);
      await clearNotification(id);
    }
  });
});

chrome.notifications.onClicked.addListener((id) => {
  void enqueue(async () => {
    const parsed = parseNotificationId(id);
    if (!parsed) return;
    const event = await findEvent(parsed.instanceId);
    if (event) await openMeetUrl(event.meetUrl);
  });
});

chrome.notifications.onClosed.addListener((id) => {
  void enqueue(async () => {
    if (ignoreClose.has(id)) return;
    const parsed = parseNotificationId(id);
    if (!parsed) return;
    const states = await getAlertStates();
    const state = states[parsed.instanceId];
    if (!state) return;
    if (state.dismissed || state.joined) return;
    if (state.notificationVisible) {
      states[parsed.instanceId] = reduceAlertState(state, {
        type: "NOTIFICATION_CLOSED",
      });
      await saveAlertStates(states);
    }
  });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  void enqueue(async () => {
    const parsed = parseAlarmName(alarm.name);
    if (!parsed) return;

    if (parsed.kind === "sync") {
      await syncCalendar(false);
      return;
    }

    if (parsed.kind === "poll") {
      await pollGuests();
      return;
    }

    if (parsed.kind === "pre" && parsed.instanceId) {
      const settings = await getSettings();
      const event = await findEvent(parsed.instanceId);
      if (event) await firePrealert(event, settings);
      return;
    }

    if (parsed.kind === "start" && parsed.instanceId) {
      await pollGuests();
    }
  });
});

chrome.action.onClicked.addListener(() => {
  void chrome.runtime.openOptionsPage();
});

chrome.runtime.onInstalled.addListener(() => {
  void enqueue(async () => {
    const existing = await chrome.storage.local.get(STORAGE_KEYS.settings);
    if (!existing[STORAGE_KEYS.settings]) {
      await chrome.storage.local.set({
        [STORAGE_KEYS.settings]: DEFAULT_SETTINGS,
      });
    }
    await syncCalendar(false);
  });
});

chrome.runtime.onStartup.addListener(() => {
  void enqueue(() => syncCalendar(false));
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || typeof message !== "object") return false;

  if (message.type === "SYNC_NOW") {
    void enqueue(() => syncCalendar(Boolean(message.interactive)))
      .then(() => sendResponse({ ok: true }))
      .catch((err: unknown) =>
        sendResponse({
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    return true;
  }

  if (message.type === "SIGN_IN") {
    void enqueue(() => syncCalendar(true))
      .then(() => sendResponse({ ok: true }))
      .catch((err: unknown) =>
        sendResponse({
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    return true;
  }

  if (message.type === "SETTINGS_UPDATED") {
    void enqueue(async () => {
      const settings = await getSettings();
      const events = await getEvents();
      await reconcileAlarms(events, settings);
      const now = new Date();
      for (const event of events) {
        const states = await getAlertStates();
        if (
          needsPrealertCatchUp(event, settings, now, states[event.instanceId])
        ) {
          await firePrealert(event, settings);
        }
      }
    })
      .then(() => sendResponse({ ok: true }))
      .catch((err: unknown) =>
        sendResponse({
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    return true;
  }

  if (message.type === "PLAY_CHIME_TEST") {
    void playChime(true)
      .then(() => sendResponse({ ok: true }))
      .catch((err: unknown) =>
        sendResponse({
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    return true;
  }

  return false;
});

void chrome.alarms.create("poll", { periodInMinutes: POLL_ALARM_PERIOD_MINUTES });
void chrome.alarms.create("sync", { periodInMinutes: SYNC_ALARM_PERIOD_MINUTES });

export { createInitialAlertState };
