CREATE TABLE `notes` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`markdown` text NOT NULL,
	`cover` text,
	`cover_position` real DEFAULT 0.5 NOT NULL,
	`cover_credit` text,
	`cover_credit_url` text,
	`icon` text,
	`style` text,
	`links` text,
	`files` text DEFAULT '[]' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
