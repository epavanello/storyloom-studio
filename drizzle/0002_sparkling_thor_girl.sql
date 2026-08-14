CREATE TABLE `playback_progress` (
	`user_id` text NOT NULL,
	`book_id` text NOT NULL,
	`chapter_id` text NOT NULL,
	`schema_version` integer DEFAULT 1 NOT NULL,
	`utterance_id` text NOT NULL,
	`position_ms` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `book_id`, `chapter_id`),
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`book_id`) REFERENCES `books`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `playback_progress_book_idx` ON `playback_progress` (`book_id`);--> statement-breakpoint
ALTER TABLE `jobs` ADD `checkpoint` text;