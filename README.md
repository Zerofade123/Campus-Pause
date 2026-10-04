# Campus Pause · BMCC

Live BMCC calendar web app with D1-backed device registrations and Web Push delivery. Hosted through Sites; no personal names, emails, or student accounts required.

## Running behavior

- Five source calendars: Fall 2026 regular, first seven-week, second eight-week, Winter 2027 and Spring 2027 regular.
- `/api/calendar` refreshes the selected official calendar on demand, with a one-hour shared cache. Failed/ambiguous fetches preserve the last verified snapshot and expose a stale warning. Cold failures show unavailable, never “campus open.”
- Device push registration, opaque device management token, session/time preferences, server-originated test notifications, unsubscribe and expired registration cleanup.
- All source data rendered as text/escaped HTML. Source URLs and push-provider hosts are allowlisted. Mutations require same-origin JSON requests; device management requires a per-device bearer token.
- Tests are limited to one per minute per device. Scheduled deliveries use unique database reservations and provider tags. A crash with an uncertain send stays reserved rather than risking repeated alerts; this is at-most-once behavior for uncertain attempts, not guaranteed delivery.
- The anonymous daily-visitors table counts distinct browser storage IDs per UTC day, with no name or email. It is an estimate of browsers, not unique students or Home Screen installations. Records are deleted after 45 days during the hourly job. Query `SELECT day, COUNT(*) FROM daily_visitors GROUP BY day ORDER BY day DESC` through owner-only database access; device registrations are a separate count.

## Pending activation

### Cloudflare app migration

The `campus-pause` Worker must deploy from the repository root with `npm run build` and `npx wrangler deploy`. Root `wrangler.jsonc` points to the bundled API Worker and binds the owner's `campus-pause-prod` D1 database as `DB`. The old root deployment contained only static assets, so `/api/config` and `/api/calendar` returned 404. The separate `cloudflare-scheduler/` directory is the temporary Cron bridge to the currently live Sites app, not the web app.

For a **new empty** Cloudflare D1 database, run `cloudflare-bootstrap.sql` once in the D1 SQL Console before testing the Cloudflare app. It is the four existing Drizzle migrations combined in order and validated against SQLite. Do not run it against the existing Sites database or rerun it after tables exist. The Cloudflare D1 database is separate from the Sites database; this schema setup does not migrate registrations or visitor counts. Do not point students or the custom domain at the Cloudflare Worker until `/api/config` and `/api/calendar?session=regular` both return 200 and a phone is registered and tested on the new origin.

The Cloudflare Worker starts with `SCHEDULER_ENABLED=false` and no Cron Triggers. Its app origin points to the temporary `workers.dev` URL. Configure a matching VAPID public/private key pair and subject as Worker runtime values before offering push registration. The new origin needs its own device subscriptions; students who registered on the Sites origin must enable notifications again on the new origin. Never put a private key or job token in GitHub. Once the Cloudflare app, D1, and push are verified, schedule its built-in `scheduled()` handler and retire the separate bridge Worker before enabling automatic reminders, so there is only one scheduler.

`SCHEDULER_ENABLED=false` until a real scheduler is installed and verified. The current Sites connector cannot attach Cron Triggers. Do not represent device registration as active automatic reminders before that gate is satisfied.

The prepared Cloudflare Cron Worker is in `cloudflare-scheduler/`. Create a Worker in the owner's Cloudflare account with that code and `wrangler.jsonc`, set its `CAMPUS_PAUSE_ORIGIN` to this Site's HTTPS origin and `CAMPUS_PAUSE_JOB_TOKEN` to a secret matching the Site's `JOB_TOKEN`, then deploy. Never put the token in source, chat, or browser code. Cron runs `/api/jobs/tests` every minute and `/api/jobs/tick` hourly, following bounded batches. Check Cloudflare run logs and the Site's `jobs` heartbeat. The older Oracle runner remains available as a fallback for the hourly job, but cannot run the closed-app test without a separate minute job.

After the minute job has a recent successful heartbeat, a registered phone can schedule a three-minute test, close the app, and reopen afterward to see whether the service worker confirmed display. A provider acceptance alone is insufficient to confirm a banner was seen. The real device test must still be performed by the owner.

After verifying unattended scheduler execution, set the hosted `SCHEDULER_ENABLED` to `true` and redeploy. The job chooses 18:00, 19:00, or 20:00 using `America/New_York`, including DST. It sends tomorrow’s exceptions and corrections to previously announced events for today/tomorrow. It skips stale or failed calendar sources. The UI only reports active when the scheduler heartbeat is recent.

This version is not ready to promise production delivery until a real iPhone/Android registration and server test, unattended hourly invocation, and overnight/correction scenarios are verified. Device OS policies can delay notifications. No paid plan has been configured by this source.

## Development

`npm install`; `npm run db:generate` for new schema changes; `npm run build`; `npm test` (Node 24 includes the SQLite test adapter). Generated migrations are packaged under `dist/.openai/drizzle`. Existing migrations must not be rewritten after application.

Source assets are in `public/`; server modules in `server/`. Build embeds public assets into a portable Cloudflare Worker. D1 access is isolated in `server/storage.js`; moving the entire service to Oracle requires replacing this storage adapter and adding an HTTP server wrapper. Oracle can instead run only the scheduler now, leaving the app/data here.

Secrets: `VAPID_PRIVATE_KEY`, `JOB_TOKEN`. Public configuration: `VAPID_PUBLIC_KEY`, `VAPID_SUBJECT`, `SCHEDULER_ENABLED`, `APP_ORIGIN`. Set `APP_ORIGIN` to the chosen custom-domain HTTPS origin after DNS activation. Maintain VAPID keys across releases and migrations so existing device registrations remain valid.

Custom domain setup and additional colleges are not enabled.
