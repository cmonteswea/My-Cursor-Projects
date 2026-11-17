import {
  DEFAULT_SETTINGS,
  hasConfiguredClientId,
  normalizeSettings,
} from "./settings";
import { STORAGE_KEYS, type Settings } from "./types";

const PLACEHOLDER = "REPLACE_WITH_OAUTH_CLIENT_ID";

function $(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id}`);
  return el;
}

function manifestClientId(): string {
  try {
    const m = chrome.runtime.getManifest() as chrome.runtime.ManifestV3;
    return m.oauth2?.client_id ?? PLACEHOLDER;
  } catch {
    return PLACEHOLDER;
  }
}

async function loadSettings(): Promise<Settings> {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.settings);
  return normalizeSettings(stored[STORAGE_KEYS.settings] ?? DEFAULT_SETTINGS);
}

async function saveSettings(partial: Partial<Settings>): Promise<Settings> {
  const current = await loadSettings();
  const next = normalizeSettings({ ...current, ...partial });
  await chrome.storage.local.set({ [STORAGE_KEYS.settings]: next });
  return next;
}

function setLog(el: HTMLElement, value: string | null): void {
  const text = value && value.trim() ? value : "None";
  el.textContent = text;
  el.classList.toggle("has-error", Boolean(value && value.trim()));
}

function updateOauthError(settings: Settings): void {
  const errEl = $("oauth-error");
  const clientId = manifestClientId();
  const manifestEl = $("manifest-client");
  const idLine = `Extension ID (use as the OAuth Application ID): ${chrome.runtime.id}`;
  manifestEl.textContent = hasConfiguredClientId(settings, clientId)
    ? `Manifest client ID: ${clientId}\n${idLine}`
    : `Manifest client ID: not set\n${idLine}`;
  if (!hasConfiguredClientId(settings, clientId)) {
    errEl.hidden = false;
    errEl.textContent =
      "No OAuth client ID in the installed manifest. Replace REPLACE_WITH_OAUTH_CLIENT_ID in src/manifest.ts, rebuild, and reload the extension.";
  } else {
    errEl.hidden = true;
    errEl.textContent = "";
  }
}

async function refreshStatus(): Promise<void> {
  const data = await chrome.storage.local.get([
    STORAGE_KEYS.accountEmail,
    STORAGE_KEYS.lastError,
    STORAGE_KEYS.meetApiError,
    STORAGE_KEYS.settings,
  ]);

  const email = data[STORAGE_KEYS.accountEmail] as string | null | undefined;
  const accountEl = $("account-status");
  accountEl.textContent = email ? `Signed in as ${email}` : "Not signed in";

  setLog($("last-error"), (data[STORAGE_KEYS.lastError] as string | null) ?? null);
  setLog(
    $("meet-error"),
    (data[STORAGE_KEYS.meetApiError] as string | null) ?? null,
  );

  const settings = normalizeSettings(data[STORAGE_KEYS.settings]);
  ($("lead-minutes") as HTMLInputElement).value = String(settings.leadMinutes);
  ($("mute") as HTMLInputElement).checked = settings.mute;
  updateOauthError(settings);
}

function sendMessage<T>(message: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      const err = chrome.runtime.lastError;
      if (err) {
        reject(new Error(err.message));
        return;
      }
      resolve(response as T);
    });
  });
}

async function init(): Promise<void> {
  await refreshStatus();

  $("sign-in").addEventListener("click", () => {
    void (async () => {
      const settings = await loadSettings();
      updateOauthError(settings);
      if (!hasConfiguredClientId(settings, manifestClientId())) return;
      try {
        await sendMessage({ type: "SIGN_IN" });
      } catch (err) {
        await chrome.storage.local.set({
          [STORAGE_KEYS.lastError]:
            err instanceof Error ? err.message : String(err),
        });
      }
      await refreshStatus();
    })();
  });

  $("sync-now").addEventListener("click", () => {
    void (async () => {
      try {
        await sendMessage({ type: "SYNC_NOW", interactive: false });
      } catch (err) {
        await chrome.storage.local.set({
          [STORAGE_KEYS.lastError]:
            err instanceof Error ? err.message : String(err),
        });
      }
      await refreshStatus();
    })();
  });

  $("test-chime").addEventListener("click", () => {
    void sendMessage({ type: "PLAY_CHIME_TEST" }).catch(console.warn);
  });

  $("lead-minutes").addEventListener("change", () => {
    void (async () => {
      const raw = Number(($("lead-minutes") as HTMLInputElement).value);
      await saveSettings({ leadMinutes: Number.isFinite(raw) ? raw : 10 });
      try {
        await sendMessage({ type: "SETTINGS_UPDATED" });
      } catch (err) {
        console.warn("reschedule failed", err);
      }
      await refreshStatus();
    })();
  });

  $("mute").addEventListener("change", () => {
    void (async () => {
      await saveSettings({
        mute: ($("mute") as HTMLInputElement).checked,
      });
    })();
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (
      STORAGE_KEYS.accountEmail in changes ||
      STORAGE_KEYS.lastError in changes ||
      STORAGE_KEYS.meetApiError in changes ||
      STORAGE_KEYS.settings in changes
    ) {
      void refreshStatus();
    }
  });
}

void init();
