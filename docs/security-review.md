# Campus Pause review — 2026-10-15

## Shipped changes

- Added an optional iPhone setup walkthrough beside setup, in installation help, and in the footer. The video is loaded on demand, has native controls and written steps, and pauses when dismissed. Removed the recording's trailing black screen; the original upload is unchanged.
- Served the MP4 as a separate static asset, with byte-range responses for playback and seeking. It is not embedded in the Worker JavaScript bundle.
- Removed the old public VAPID setup utility from the published asset list. It never exposed existing saved secrets.
- Added Content Security Policy, frame protection, MIME sniffing protection and restrictive camera/microphone/location permissions.
- Bounded JSON bodies to 8 KB, including chunked bodies, and rejected malformed device credentials early.
- Added Cloudflare write limits: 120 requests per minute per network, and 600 total per minute per Cloudflare location. Network keys are hashed with the UTC date and are not stored in D1. These are approximate, location-local counters, not a global quota. Shared campus networks may share the first limit.
- Kept the database-backed five-minute test cooldown and five attempts per 24 hours per device.

## Public and private access

Calendar dates, source links, scheduler readiness, and the VAPID public key are intentionally public. A public key is not a secret. Device credentials protect registration settings, deletion and test state. Background job HTTP endpoints require a job token. D1 rows, push subscription secrets, VAPID private keys and visitor counts are not exposed through a public reporting endpoint.

Tests cover unauthorized requests, cross-device access, cross-origin writes, oversized bodies, rate-limit rejection, security headers and video byte ranges, in addition to existing notification and calendar tests. This is a focused code review, not a comprehensive penetration test.

## Owner usage counts

Run `docs/usage-counts.sql` in Cloudflare D1's console for `campus-pause-prod`. The queries are read-only. Do not publish database credentials, full subscription records or device tokens.

Saved registrations count browser installations that enabled reminders. They are not exact unique students, current online users, or confirmed active installations. Expired endpoints are removed when delivery identifies them. Daily visitor counts deduplicate a browser identifier within a UTC day; storage resets and different browsers count separately. Do not sum daily counts and call that unique users. Daily visit records are retained for 45 days.

A delivery marked `sent` means the push provider accepted it, not that the student saw it. The current app does not collect names or emails and has no owner dashboard.

## Remaining maintenance and abuse risks

- Refresh the configured academic sessions before each new semester. Calendar changes and parsing failures need owner monitoring.
- Fresh registrations can evade a per-device test quota. The new edge limits reduce this risk but do not stop distributed abuse, bots inflating visitor counts, or all denial-of-service attacks.
- Free hosting has request, database and compute limits. No payment plan was enabled by this code change; unlimited capacity or uptime is not guaranteed. Video range requests pass through the Worker and count as requests.
- Keep Cloudflare and GitHub access restricted, protect accounts with MFA, and maintain database recovery procedures. These account settings were not audited here.
- Physical iPhone playback and a final notification test remain valuable after deployment. The owner should verify the full setup flow on the actual device.
