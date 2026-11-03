CREATE TABLE `studio_credentials` (
	`user_id` text PRIMARY KEY NOT NULL,
	`ciphertext` text NOT NULL,
	`iv` text NOT NULL,
	`updated_at` text NOT NULL
);
