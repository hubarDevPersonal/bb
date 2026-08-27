CREATE TABLE `thread_retention_schedules` (
	`thread_id` text PRIMARY KEY NOT NULL,
	`host_id` text,
	`archived_at` integer,
	`resource_cleanup_due_at` integer,
	`conversation_delete_due_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "thread_retention_resource_host_check" CHECK("thread_retention_schedules"."resource_cleanup_due_at" IS NULL OR "thread_retention_schedules"."host_id" IS NOT NULL),
	CONSTRAINT "thread_retention_deadline_check" CHECK("thread_retention_schedules"."resource_cleanup_due_at" IS NOT NULL OR "thread_retention_schedules"."conversation_delete_due_at" IS NOT NULL)
);
--> statement-breakpoint
CREATE INDEX `thread_retention_resource_due_idx` ON `thread_retention_schedules` (`resource_cleanup_due_at`);--> statement-breakpoint
CREATE INDEX `thread_retention_conversation_due_idx` ON `thread_retention_schedules` (`conversation_delete_due_at`);