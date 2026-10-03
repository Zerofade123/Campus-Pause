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
