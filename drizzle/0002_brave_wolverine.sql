CREATE TABLE `studio_engine_checks` (
	`owner_id` text NOT NULL,
	`engine_base_url` text NOT NULL,
	`credential_fingerprint` text NOT NULL,
	`after_job_rowid` integer DEFAULT 0 NOT NULL,
	`checked_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `engine_checks_owner_engine_credential` ON `studio_engine_checks` (`owner_id`,`engine_base_url`,`credential_fingerprint`);--> statement-breakpoint
ALTER TABLE `studio_assets` ADD `parent_asset_id` text REFERENCES studio_assets(id);--> statement-breakpoint
ALTER TABLE `studio_assets` ADD `version_root_id` text REFERENCES studio_assets(id);--> statement-breakpoint
ALTER TABLE `studio_jobs` ADD `credential_fingerprint` text;