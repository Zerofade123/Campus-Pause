CREATE TABLE `daily_visitors` (
	`day` text NOT NULL,
	`visitor_hash` text NOT NULL,
	`first_seen` text NOT NULL,
	PRIMARY KEY(`day`, `visitor_hash`)
);
--> statement-breakpoint
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
--> statement-breakpoint
CREATE INDEX `idx_scheduled_tests_due` ON `scheduled_tests` (`due_at`);