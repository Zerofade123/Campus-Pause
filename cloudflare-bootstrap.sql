-- Run once on the new empty campus-pause-prod D1 database.
-- Source: drizzle/0000 through 0003, in order.

CREATE TABLE `calendars` (
	`id` text PRIMARY KEY NOT NULL,
	`events` text NOT NULL,
	`checked_at` text NOT NULL,
	`attempted_at` text NOT NULL,
	`error` text
);

CREATE TABLE `deliveries` (
	`id` text PRIMARY KEY NOT NULL,
	`device` text NOT NULL,
	`event_date` text NOT NULL,
	`revision` text NOT NULL,
	`state` text NOT NULL,
	`updated_at` text NOT NULL,
	`attempts` integer DEFAULT 1 NOT NULL
);

CREATE INDEX `idx_deliveries_device_date` ON `deliveries` (`device`,`event_date`);
CREATE TABLE `devices` (
	`id` text PRIMARY KEY NOT NULL,
	`token_hash` text NOT NULL,
	`subscription` text NOT NULL,
	`session` text NOT NULL,
	`hour` integer NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`last_test` text
);

CREATE INDEX `idx_devices_session_hour` ON `devices` (`session`,`hour`);
CREATE TABLE `jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`last_started` text,
	`last_success` text,
	`error` text,
	`lease_until` text
);

CREATE TABLE `push_tests` (
	`device` text PRIMARY KEY NOT NULL,
	`id` text NOT NULL,
	`receipt_hash` text NOT NULL,
	`created_at` text NOT NULL,
	`provider_status` integer,
	`received_at` text,
	`display_state` text,
	`worker_version` text
);

ALTER TABLE `devices` ADD `test_window_start` text;
ALTER TABLE `devices` ADD `test_count` integer DEFAULT 0 NOT NULL;
CREATE TABLE `daily_visitors` (
	`day` text NOT NULL,
	`visitor_hash` text NOT NULL,
	`first_seen` text NOT NULL,
	PRIMARY KEY(`day`, `visitor_hash`)
);

CREATE TABLE `scheduled_tests` (
	`device` text PRIMARY KEY NOT NULL,
	`id` text NOT NULL,
	`receipt_token` text NOT NULL,
	`receipt_hash` text NOT NULL,
	`due_at` text NOT NULL,
	`dispatched_at` text,
	`provider_status` integer,
	`received_at` text,
	`display_state` text,
	`worker_version` text
);

CREATE INDEX `idx_scheduled_tests_due` ON `scheduled_tests` (`due_at`);