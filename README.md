# Daymark

Daymark is a local-first to-do PWA with due dates, filters, editable task groups, and a stealth-dark theme. Tasks and groups remain on the device. Optional deadline alarms sync only alarm-enabled task details and push-subscription data to a Cloudflare Worker and D1 database.

## Install on Android

1. Open [Daymark](https://zooninja.github.io/daymark-todo/) in Chrome on your Android device.
2. Tap **Install app**, or open Chrome's **⋮** menu and choose **Install app** or **Add to Home screen**.
3. Open Daymark once while online so its app files can be cached. Tasks and groups are stored in that browser on that device; clearing site data removes them.

For alarms, set a deadline date and time, enable **Set an alarm**, choose a lead time, and allow notifications. Android uses the notification sound and vibration settings for Daymark. A PWA cannot force an exact alarm, override Do Not Disturb, or select a custom alarm tone; delivery may be delayed by Android or the push service. The reminder service must be deployed and reachable when you create or cancel an alarm. If you clear Daymark's site data, an already-synced alarm may still fire.

## Enable deadline alarms

The static app works without a server, but background reminders require the Cloudflare Worker in `backend/`.

1. From `backend/`, run `npm install` and `npm run generate:vapid`. The public key is printed; the private key is saved in the gitignored `backend/.dev.vars`.
2. Put the printed public key in `VAPID_PUBLIC_KEY` in `backend/cloudflare.config.ts`.
3. Sign in with `cf auth login`, create the D1 database with `cf d1 create --name daymark-alerts`, then apply `backend/migrations` using the returned database ID: `cf d1 migrations apply <DATABASE_ID> --dir migrations` (run from `backend/`).
4. Deploy with `npm run deploy` from `backend/`. This uploads the private key as a Worker secret; `backend/.dev.vars` is gitignored and must never be committed. For an existing Worker, you can replace the secret in **Workers & Pages → daymark-alerts → Settings → Variables and Secrets**.
5. Set the `daymark-alert-api` meta tag's `content` in `index.html` to the deployed Worker URL (for example, `https://daymark-alerts.<your-workers-subdomain>.workers.dev`), then publish the updated app to GitHub Pages.

The scheduled Worker checks once per minute. Push notifications use the Android system notification channel, not a native exact-alarm API. Tasks without alarms, group names, and completed task history are never sent to the Worker.

## Run and test locally

Open `index.html` for local task management and browser storage. Service-worker installation and push require HTTPS, so local file mode does not support alarms. Run the Worker API tests from `backend/` with `npm test`; run `npm run typecheck` to check its bindings and types.

## Project files

- `index.html` — app markup, styles, task management, and optional alarm setup
- `manifest.webmanifest` — install name, display mode, and icons
- `sw.js` — offline app-shell cache and push-notification handling
- `backend/` — Cloudflare Worker API, D1 migration, and tests
- `icons/` — Android and browser app icons
