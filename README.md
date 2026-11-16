# Meet Alert

Chrome MV3 extension that watches Google Calendar for Google Meet events and fires **sticky** audible + visual notifications:

1. **N minutes before start** (default 10, configurable)
2. **After the meeting has started** and at least one participant who is **not** you has joined

Alerts use `chrome.notifications` with `requireInteraction: true`, priority 2, and **Join** / **Dismiss** buttons. They stay until Join, Dismiss, or you appear as an active Meet participant. If the OS dismisses the toast, it is re-shown on the next poll.

Works with **no focused tab**: service worker + `chrome.alarms` + `chrome.notifications` + an offscreen document that plays a short chime (unless muted).

> **Constraint:** Chrome must be running for alerts to fire. Service workers and alarms do not run when the browser is fully quit.

## Load unpacked

1. Install dependencies and build:

   ```bash
   npm install
   npm run build
   ```

2. Open `chrome://extensions`, enable **Developer mode**.
3. Click **Load unpacked** and select the `dist/` folder produced by Vite/`@crxjs`.
4. Open the extension **Options** page to sign in and configure settings.

For local iteration you can also run `npm run dev` and load the CRXJS dev output as instructed in the terminal.

## OAuth client setup

1. In [Google Cloud Console](https://console.cloud.google.com/), create (or pick) a project.
2. Enable **Google Calendar API** and **Google Meet API**.
3. Configure the OAuth consent screen (External or Internal). Add scopes:
   - `https://www.googleapis.com/auth/calendar.events.readonly`
   - `https://www.googleapis.com/auth/meetings.space.readonly`
   - `https://www.googleapis.com/auth/userinfo.email`
   - `https://www.googleapis.com/auth/userinfo.profile`
4. Create credentials → **OAuth client ID** → Application type **Chrome extension**.
5. Set the **Application ID** to your extension ID from `chrome://extensions`.
6. Copy the client ID (`….apps.googleusercontent.com`).

### Wire the client ID

**Required for Sign-in:** replace `REPLACE_WITH_OAUTH_CLIENT_ID` in `src/manifest.ts` and rebuild. `chrome.identity.getAuthToken` reads the client ID from the installed manifest. Until a real client ID is present, Options shows a clear error.

`userinfo.email` and `userinfo.profile` identify you so a meeting you are already in does not count as “guests arrived”. Meet’s participant resource uses `users/{id}`, not an email address.

### Token behavior

Auth uses `chrome.identity.getAuthToken({ interactive })`. On HTTP 401 the extension calls `chrome.identity.removeCachedAuthToken` and retries once.

## Permissions

| Permission / host | Why |
| --- | --- |
| `alarms` | Sync every 5 min; poll guests every 30s; per-event pre/start alarms |
| `notifications` | Sticky Join/Dismiss alerts |
| `storage` | Settings, per-event alert state, errors, account email |
| `identity` | OAuth tokens |
| `offscreen` | Play chime with no open tab |
| `tabs` | Open Meet URL on Join / body click |
| `www.googleapis.com` | Calendar + userinfo |
| `meet.googleapis.com` | Spaces / conference records / participants |
| `accounts.google.com` | OAuth |
| `meet.google.com` | Open meetings |

## Development

```bash
npm install
npm test
npm run typecheck
npm run build
```

## Behavior notes

- **Join** opens the Meet URL and marks the instance joined (no further alerts).
- **Dismiss** suppresses further alerts for that instance.
- Notification **body** click opens Meet but does **not** mark joined.
- If Meet API returns **403**, Options shows a Meet API error; the pre-alert still works.
- Guest detection uses the **live** conference record (no end time).
- In-progress meetings stay on the watch list (calendar query looks back 12 hours and drops events that have already ended).
- Alerts run only while Chrome is open.
