CREATE TABLE `studio_assets` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`project_id` text,
	`job_id` text,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`mime_type` text NOT NULL,
	`size` integer NOT NULL,
	`r2_key` text NOT NULL,
	`width` integer,
	`height` integer,
	`duration` integer,
	`starred` integer DEFAULT false NOT NULL,
	`source` text NOT NULL,
	`source_output_id` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `studio_projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`job_id`) REFERENCES `studio_jobs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `assets_owner_created` ON `studio_assets` (`owner_id`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `assets_output_once` ON `studio_assets` (`owner_id`,`job_id`,`source_output_id`);--> statement-breakpoint
CREATE TABLE `studio_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`project_id` text,
	`recipe_id` text NOT NULL,
	`status` text NOT NULL,
	`prompt` text NOT NULL,
	`parameters_json` text NOT NULL,
	`client_request_id` text NOT NULL,
	`engine_job_id` text,
	`engine_mode` text NOT NULL,
	`engine_base_url` text NOT NULL,
	`progress` integer,
	`stage` text,
	`output_asset_ids_json` text DEFAULT '[]' NOT NULL,
	`error_json` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`completed_at` text,
	FOREIGN KEY (`project_id`) REFERENCES `studio_projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `jobs_owner_created` ON `studio_jobs` (`owner_id`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `jobs_owner_request` ON `studio_jobs` (`owner_id`,`client_request_id`);--> statement-breakpoint
CREATE TABLE `studio_projects` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`name` text NOT NULL,
	`document_json` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `projects_owner_updated` ON `studio_projects` (`owner_id`,`updated_at`);