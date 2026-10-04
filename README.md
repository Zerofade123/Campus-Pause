# Campus Pause · BMCC

Live BMCC calendar web app with D1-backed device registrations and Web Push delivery. The original version runs on Sites; Cloudflare migration is in progress. No personal names, emails, or student accounts required.

## Running behavior

- Five source calendars: Fall 2026 regular, first seven-week, second eight-week, Winter 2027 and Spring 2027 regular.
- `/api/calendar` refreshes the selected official calendar on demand, with a one-hour shared cache. Failed/ambiguous fetches preserve the last verified snapshot and expose a stale warning. Cold failures show unavailable, never “campus open.”
- Device push registration, opaque device management token, session/time preferences, server-originated test notifications, unsubscribe and expired registration cleanup.
- All source data rendered as text/escaped HTML. Source URLs and push-provider hosts are allowlisted. Mutations require same-origin JSON requests; device management requires a per-device bearer token.
- Tests are limited to one per minute per device. Scheduled deliveries use unique database reservations and provider tags. A crash with an uncertain send stays reserved rather than risking repeated alerts; this is at-most-once behavior for uncertain attempts, not guaranteed delivery.
- The anonymous daily-visitors table counts distinct browser storage IDs per UTC day, with no name or email. It is an estimate of browsers, not unique students or Home Screen installations. Records are deleted after 45 days during the hourly job. Query `SELECT day, COUNT(*) FROM daily_visitors GROUP BY day ORDER BY day DESC` through owner-only database access; device registrations are a separate count.

## Cloudflare activation

### Cloudflare app migration

The `campus-pause` Worker deploys from the repository root with `npm run build` and `npx wrangler deploy`. Root `wrangler.jsonc` points to the bundled API Worker and binds the owner's `campus-pause-prod` D1 database as `DB`. Calendar API and all five sessions have been verified on Cloudflare. The separate `cloudflare-scheduler/` Worker is retired: its Cron list is empty. The accidentally created Pages project is not part of this app.

For a **new empty** Cloudflare D1 database, run `cloudflare-bootstrap.sql` once in the D1 SQL Console before testing the Cloudflare app. It is the four existing Drizzle migrations combined in order and validated against SQLite. Do not run it against the existing Sites database or rerun it after tables exist. The Cloudflare D1 database is separate from the Sites database; this schema setup does not migrate registrations or visitor counts. Do not point students or the custom domain at the Cloudflare Worker until `/api/config` and `/api/calendar?session=regular` both return 200 and a phone is registered and tested on the new origin.

The Cloudflare Worker has `SCHEDULER_ENABLED=true` after owner verification on October 4, 2026, and has two Cron Triggers in the root `wrangler.jsonc`: every minute for queued closed-app tests and hourly for calendar refresh plus due reminders. Its app origin points to the temporary `workers.dev` URL. Configure a matching VAPID public/private key pair and subject as Worker runtime values before offering push registration. Set `VAPID_PUBLIC_KEY` as a plaintext runtime variable, `VAPID_PRIVATE_KEY` as a runtime **Secret**, and `VAPID_SUBJECT` as `mailto:` followed by a monitored address. Generate the pair locally in a trusted environment; never put its private half, a job token, or the pair's output in GitHub or a shared chat. Changes in the dashboard require Deploy. The owner confirmed that the immediate server test and scheduled closed-app test both arrived on their iPhone on October 4, 2026. The live configuration check also verified the VAPID pair and contact format, and hourly and minute job heartbeats were observed. The new origin needs its own device subscriptions; students who registered on Sites must enable notifications again on the new origin.

Do not represent device registration as active automatic reminders before the Cloudflare Cron heartbeat and closed-app push test are verified. The original Sites deployment has no Cron Triggers.

The main Worker calls its own scheduled handler, so it needs no `JOB_TOKEN`, `CAMPUS_PAUSE_ORIGIN`, or second Worker. The optional authenticated HTTP jobs remain in source for a possible future external runner; do not expose a token unless that runner is needed. Check its Cron Events and the `jobs` heartbeat in D1. The older Oracle runner remains a fallback for the hourly job, but cannot run the closed-app test without a separate minute job.

After the minute job has a recent successful heartbeat, a registered phone can schedule a three-minute test, close the app, and reopen afterward to see whether the service worker confirmed display. A provider acceptance alone is insufficient to confirm a banner was seen. The real device test must still be performed by the owner.

After verifying unattended scheduler execution, change the root `wrangler.jsonc` value of `SCHEDULER_ENABLED` to `true` and deploy through the GitHub-connected build. The job chooses 18:00, 19:00, or 20:00 using `America/New_York`, including DST. It sends tomorrow’s exceptions and corrections to previously announced events for today/tomorrow. It skips stale or failed calendar sources. The UI only reports active when the scheduler heartbeat is recent.

The owner has verified real iPhone delivery, including a scheduled notification while the app was closed. Automatic evening reminders are enabled. Android delivery and the first live academic-calendar reminder still need real-device observation; correction and deduplication behavior are covered by automated tests. Device OS policies can delay notifications. No paid plan has been configured by this source.

## Development

`npm install`; `npm run db:generate` for new schema changes; `npm run build`; `npm test` (Node 24 includes the SQLite test adapter). Generated migrations are packaged under `dist/.openai/drizzle`. Existing migrations must not be rewritten after application.

Source assets are in `public/`; server modules in `server/`. Build embeds public assets into a portable Cloudflare Worker. D1 access is isolated in `server/storage.js`; moving the entire service to Oracle requires replacing this storage adapter and adding an HTTP server wrapper. Oracle can instead run only the scheduler now, leaving the app/data here.

Secrets: `VAPID_PRIVATE_KEY`, `JOB_TOKEN`. Public configuration: `VAPID_PUBLIC_KEY`, `VAPID_SUBJECT`, `SCHEDULER_ENABLED`, `APP_ORIGIN`. Set `APP_ORIGIN` to the chosen custom-domain HTTPS origin after DNS activation. Maintain VAPID keys across releases and migrations so existing device registrations remain valid.

Custom domain setup and additional colleges are not enabled.
