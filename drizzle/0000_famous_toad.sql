CREATE TABLE `calendars` (
	`id` text PRIMARY KEY NOT NULL,
	`events` text NOT NULL,
	`checked_at` text NOT NULL,
	`attempted_at` text NOT NULL,
	`error` text
);
--> statement-breakpoint
CREATE TABLE `deliveries` (
	`id` text PRIMARY KEY NOT NULL,
	`device` text NOT NULL,
	`event_date` text NOT NULL,
	`revision` text NOT NULL,
	`state` text NOT NULL,
	`updated_at` text NOT NULL,
	`attempts` integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_deliveries_device_date` ON `deliveries` (`device`,`event_date`);--> statement-breakpoint
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
--> statement-breakpoint
CREATE INDEX `idx_devices_session_hour` ON `devices` (`session`,`hour`);--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`last_started` text,
	`last_success` text,
	`error` text,
	`lease_until` text
);
