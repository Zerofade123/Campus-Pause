-- Run privately in Cloudflare D1 > campus-pause-prod > Console.
-- Counts only; no endpoints, authentication tokens, or personal identities.
-- Registered devices are saved subscriptions, not verified people or online users.
SELECT COUNT(*) AS saved_notification_registrations FROM devices;

-- Visitor dates currently use UTC. A browser is deduplicated within each day.
-- Reinstalls/storage clearing/different browsers can count separately; bots can inflate totals.
SELECT day AS day_utc, COUNT(*) AS daily_browser_visitors
FROM daily_visitors GROUP BY day ORDER BY day DESC LIMIT 14;

SELECT session, COUNT(*) AS saved_registrations FROM devices GROUP BY session;

-- 'sent' means accepted by the push service, not a confirmed banner or read.
SELECT event_date, state, COUNT(*) AS reminder_attempts
FROM deliveries GROUP BY event_date,state ORDER BY event_date DESC LIMIT 20;

SELECT id,last_success,error FROM jobs
WHERE id IN ('tick','test-dispatch') OR id LIKE 'calendar:%';
