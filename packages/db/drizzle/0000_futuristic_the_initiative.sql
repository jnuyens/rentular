CREATE TABLE `bank_accounts` (
	`id` varchar(36) NOT NULL,
	`owner_id` varchar(255) NOT NULL,
	`label` varchar(255) NOT NULL,
	`iban` varchar(34) NOT NULL,
	`bic` varchar(11),
	`holder_name` varchar(255) NOT NULL,
	`bank_name` varchar(255),
	`is_default` boolean NOT NULL DEFAULT false,
	`is_archived` boolean NOT NULL DEFAULT false,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `bank_accounts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `communications` (
	`id` varchar(36) NOT NULL,
	`owner_id` varchar(255) NOT NULL,
	`lease_id` varchar(36),
	`channel` enum('email','sms','letter') NOT NULL,
	`type` enum('payment_reminder_friendly','payment_reminder_formal','payment_reminder_final','indexation_notification','landlord_report','custom','welcome','lease_renewal','lease_termination','other') NOT NULL,
	`recipient_name` varchar(255) NOT NULL,
	`recipient_email` varchar(255),
	`recipient_phone` varchar(50),
	`subject` varchar(500),
	`body` text NOT NULL,
	`status` enum('queued','sent','delivered','failed','bounced') NOT NULL DEFAULT 'queued',
	`external_id` varchar(255),
	`error_message` text,
	`metadata` json,
	`queued_at` timestamp NOT NULL DEFAULT (now()),
	`sent_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `communications_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `costs` (
	`id` varchar(36) NOT NULL,
	`owner_id` varchar(255) NOT NULL,
	`property_id` varchar(36),
	`lease_id` varchar(36),
	`category` enum('maintenance','repair','insurance','tax','management_fee','utility','legal','renovation','other') NOT NULL,
	`description` varchar(500) NOT NULL,
	`amount` decimal(10,2) NOT NULL,
	`date` date NOT NULL,
	`recharged_to_tenant` boolean NOT NULL DEFAULT false,
	`reference` varchar(255),
	`notes` text,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `costs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `rent_deductions` (
	`id` varchar(36) NOT NULL,
	`lease_id` varchar(36) NOT NULL,
	`type` enum('temporary','permanent') NOT NULL,
	`amount` decimal(10,2) NOT NULL,
	`start_date` date NOT NULL,
	`end_date` date,
	`reason` varchar(500) NOT NULL,
	`notes` text,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `rent_deductions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `rent_free_periods` (
	`id` varchar(36) NOT NULL,
	`lease_id` varchar(36) NOT NULL,
	`start_date` date NOT NULL,
	`end_date` date NOT NULL,
	`reason` varchar(500) NOT NULL,
	`waive_charges` boolean NOT NULL DEFAULT false,
	`notes` text,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `rent_free_periods_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `accounts` (
	`user_id` varchar(255) NOT NULL,
	`type` varchar(255) NOT NULL,
	`provider` varchar(255) NOT NULL,
	`provider_account_id` varchar(255) NOT NULL,
	`refresh_token` text,
	`access_token` text,
	`expires_at` int,
	`token_type` varchar(255),
	`scope` varchar(255),
	`id_token` text,
	`session_state` varchar(255),
	CONSTRAINT `accounts_provider_provider_account_id_pk` PRIMARY KEY(`provider`,`provider_account_id`)
);
--> statement-breakpoint
CREATE TABLE `password_reset_tokens` (
	`id` varchar(36) NOT NULL,
	`user_id` varchar(255) NOT NULL,
	`token` varchar(255) NOT NULL,
	`expires` timestamp NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `password_reset_tokens_id` PRIMARY KEY(`id`),
	CONSTRAINT `password_reset_tokens_token_unique` UNIQUE(`token`)
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`session_token` varchar(255) NOT NULL,
	`user_id` varchar(255) NOT NULL,
	`expires` timestamp NOT NULL,
	CONSTRAINT `sessions_session_token` PRIMARY KEY(`session_token`)
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` varchar(255) NOT NULL,
	`name` varchar(255),
	`email` varchar(255) NOT NULL,
	`email_verified` timestamp,
	`image` text,
	`password_hash` varchar(255),
	`locale` varchar(5) DEFAULT 'en',
	`onboarding_step` int DEFAULT 1,
	`onboarding_complete` boolean DEFAULT false,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `users_id` PRIMARY KEY(`id`),
	CONSTRAINT `users_email_unique` UNIQUE(`email`)
);
--> statement-breakpoint
CREATE TABLE `verification_tokens` (
	`identifier` varchar(255) NOT NULL,
	`token` varchar(255) NOT NULL,
	`expires` timestamp NOT NULL,
	CONSTRAINT `verification_tokens_identifier_token_pk` PRIMARY KEY(`identifier`,`token`)
);
--> statement-breakpoint
CREATE TABLE `properties` (
	`id` varchar(36) NOT NULL,
	`owner_id` varchar(255) NOT NULL,
	`name` varchar(255) NOT NULL,
	`type` enum('apartment','house','studio','commercial','garage','other') NOT NULL,
	`street` varchar(255) NOT NULL,
	`street_number` varchar(20) NOT NULL,
	`box` varchar(20),
	`postal_code` varchar(10) NOT NULL,
	`city` varchar(255) NOT NULL,
	`country` varchar(2) NOT NULL DEFAULT 'BE',
	`cadastral_reference` varchar(100),
	`epc_score` varchar(10),
	`epc_label` varchar(5),
	`epc_certificate_number` varchar(100),
	`epc_expiry_date` varchar(10),
	`notes` text,
	`metadata` json,
	`is_archived` boolean NOT NULL DEFAULT false,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `properties_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `tenants` (
	`id` varchar(36) NOT NULL,
	`owner_id` varchar(255) NOT NULL,
	`first_name` varchar(255) NOT NULL,
	`last_name` varchar(255) NOT NULL,
	`email` varchar(255),
	`phone` varchar(50),
	`language` enum('nl','fr','de','en') NOT NULL DEFAULT 'nl',
	`national_register` varchar(20),
	`iban` varchar(34),
	`gocardless_customer_id` varchar(255),
	`gocardless_mandate_id` varchar(255),
	`notes` text,
	`is_archived` boolean NOT NULL DEFAULT false,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `tenants_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `lease_tenants` (
	`lease_id` varchar(36) NOT NULL,
	`tenant_id` varchar(36) NOT NULL,
	`is_primary` boolean NOT NULL DEFAULT false
);
--> statement-breakpoint
CREATE TABLE `leases` (
	`id` varchar(36) NOT NULL,
	`owner_id` varchar(255) NOT NULL,
	`property_id` varchar(36) NOT NULL,
	`type` enum('residential_short','residential_long','residential_lifetime','student','commercial') NOT NULL,
	`region` enum('flanders','wallonia','brussels') NOT NULL,
	`status` enum('draft','active','terminated','expired') NOT NULL DEFAULT 'draft',
	`signing_date` date NOT NULL,
	`start_date` date NOT NULL,
	`end_date` date,
	`monthly_rent` decimal(10,2) NOT NULL,
	`monthly_charges` decimal(10,2) NOT NULL DEFAULT '0.00',
	`charges_type` enum('fixed','provision') NOT NULL DEFAULT 'fixed',
	`deposit` decimal(10,2) DEFAULT '0.00',
	`deposit_account` varchar(34),
	`payment_day` int NOT NULL DEFAULT 1,
	`payment_method` enum('gocardless','bank_transfer','manual') NOT NULL DEFAULT 'bank_transfer',
	`structured_communication` varchar(20),
	`bank_account_id` varchar(36),
	`gocardless_mandate_id` varchar(255),
	`indexation_enabled` boolean NOT NULL DEFAULT true,
	`indexation_base_month` varchar(7),
	`indexation_base_index` decimal(8,2),
	`current_monthly_rent` decimal(10,2),
	`last_indexation_date` date,
	`late_payment_fee_enabled` boolean NOT NULL DEFAULT false,
	`late_payment_fee_amount` decimal(10,2) DEFAULT '15.00',
	`late_payment_fee_enforcement` enum('soft','strict') NOT NULL DEFAULT 'soft',
	`notes` text,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `leases_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `payment_follow_up_settings` (
	`id` varchar(36) NOT NULL,
	`owner_id` varchar(255) NOT NULL,
	`enabled` boolean NOT NULL DEFAULT true,
	`friendly_reminder_days` int NOT NULL DEFAULT 0,
	`formal_reminder_days` int NOT NULL DEFAULT 3,
	`final_reminder_days` int NOT NULL DEFAULT 6,
	`interest_enabled` boolean NOT NULL DEFAULT false,
	`annual_interest_rate` decimal(5,2) DEFAULT '3.75',
	`sms_enabled` boolean NOT NULL DEFAULT false,
	`sms_friendly_message` text,
	`sms_formal_message` text,
	`sms_final_message` text,
	`friendly_subject` varchar(500) DEFAULT 'Friendly reminder: rent payment due',
	`friendly_body` text,
	`formal_subject` varchar(500) DEFAULT 'Payment overdue - action required',
	`formal_body` text,
	`final_subject` varchar(500) DEFAULT 'Final notice: overdue rent payment',
	`final_body` text,
	`landlord_report_enabled` boolean NOT NULL DEFAULT true,
	`landlord_report_days` varchar(50) DEFAULT '3,7,15,28',
	`landlord_report_skip_if_all_paid` boolean NOT NULL DEFAULT false,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `payment_follow_up_settings_id` PRIMARY KEY(`id`),
	CONSTRAINT `payment_follow_up_settings_owner_id_unique` UNIQUE(`owner_id`)
);
--> statement-breakpoint
CREATE TABLE `payment_reminders` (
	`id` varchar(36) NOT NULL,
	`payment_id` varchar(36) NOT NULL,
	`type` enum('friendly','formal','final') NOT NULL,
	`channel` enum('email','sms','letter') NOT NULL,
	`sent_at` timestamp NOT NULL DEFAULT (now()),
	`notes` text,
	CONSTRAINT `payment_reminders_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `payments` (
	`id` varchar(36) NOT NULL,
	`lease_id` varchar(36) NOT NULL,
	`status` enum('pending','processing','paid','failed','cancelled','refunded') NOT NULL DEFAULT 'pending',
	`amount` decimal(10,2) NOT NULL,
	`due_date` date NOT NULL,
	`paid_date` date,
	`method` enum('gocardless','bank_transfer','cash','other') NOT NULL,
	`structured_communication` varchar(20),
	`gocardless_payment_id` varchar(255),
	`rent_amount` decimal(10,2),
	`charges_amount` decimal(10,2),
	`late_payment_fee` decimal(10,2) DEFAULT '0.00',
	`interest_charged` decimal(10,2) DEFAULT '0.00',
	`fee_waived_at` date,
	`is_ignored` boolean NOT NULL DEFAULT false,
	`ignore_reason` text,
	`notes` text,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `payments_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `health_index_values` (
	`id` varchar(36) NOT NULL,
	`year` varchar(4) NOT NULL,
	`month` varchar(2) NOT NULL,
	`value` decimal(8,2) NOT NULL,
	`source` varchar(50) NOT NULL DEFAULT 'statbel',
	`fetched_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `health_index_values_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `indexation_records` (
	`id` varchar(36) NOT NULL,
	`lease_id` varchar(36) NOT NULL,
	`effective_date` date NOT NULL,
	`previous_rent` decimal(10,2) NOT NULL,
	`new_rent` decimal(10,2) NOT NULL,
	`base_index` decimal(8,2) NOT NULL,
	`current_index` decimal(8,2) NOT NULL,
	`status` enum('calculated','notified','applied','disputed') NOT NULL DEFAULT 'calculated',
	`notification_sent_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `indexation_records_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `property_managers` (
	`id` varchar(36) NOT NULL,
	`property_id` varchar(36) NOT NULL,
	`user_id` varchar(255) NOT NULL,
	`role` enum('owner','co_owner','manager','accountant','viewer') NOT NULL,
	`invited_by` varchar(255),
	`invited_at` timestamp NOT NULL DEFAULT (now()),
	`accepted_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `property_managers_id` PRIMARY KEY(`id`),
	CONSTRAINT `unique_user_property` UNIQUE(`property_id`,`user_id`)
);
--> statement-breakpoint
ALTER TABLE `bank_accounts` ADD CONSTRAINT `bank_accounts_owner_id_users_id_fk` FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `communications` ADD CONSTRAINT `communications_owner_id_users_id_fk` FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `communications` ADD CONSTRAINT `communications_lease_id_leases_id_fk` FOREIGN KEY (`lease_id`) REFERENCES `leases`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `costs` ADD CONSTRAINT `costs_owner_id_users_id_fk` FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `costs` ADD CONSTRAINT `costs_property_id_properties_id_fk` FOREIGN KEY (`property_id`) REFERENCES `properties`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `costs` ADD CONSTRAINT `costs_lease_id_leases_id_fk` FOREIGN KEY (`lease_id`) REFERENCES `leases`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `rent_deductions` ADD CONSTRAINT `rent_deductions_lease_id_leases_id_fk` FOREIGN KEY (`lease_id`) REFERENCES `leases`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `rent_free_periods` ADD CONSTRAINT `rent_free_periods_lease_id_leases_id_fk` FOREIGN KEY (`lease_id`) REFERENCES `leases`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `accounts` ADD CONSTRAINT `accounts_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `password_reset_tokens` ADD CONSTRAINT `password_reset_tokens_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `sessions` ADD CONSTRAINT `sessions_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `properties` ADD CONSTRAINT `properties_owner_id_users_id_fk` FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `tenants` ADD CONSTRAINT `tenants_owner_id_users_id_fk` FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `lease_tenants` ADD CONSTRAINT `lease_tenants_lease_id_leases_id_fk` FOREIGN KEY (`lease_id`) REFERENCES `leases`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `leases` ADD CONSTRAINT `leases_owner_id_users_id_fk` FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `leases` ADD CONSTRAINT `leases_property_id_properties_id_fk` FOREIGN KEY (`property_id`) REFERENCES `properties`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `leases` ADD CONSTRAINT `leases_bank_account_id_bank_accounts_id_fk` FOREIGN KEY (`bank_account_id`) REFERENCES `bank_accounts`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `payment_follow_up_settings` ADD CONSTRAINT `payment_follow_up_settings_owner_id_users_id_fk` FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `payment_reminders` ADD CONSTRAINT `payment_reminders_payment_id_payments_id_fk` FOREIGN KEY (`payment_id`) REFERENCES `payments`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `payments` ADD CONSTRAINT `payments_lease_id_leases_id_fk` FOREIGN KEY (`lease_id`) REFERENCES `leases`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `indexation_records` ADD CONSTRAINT `indexation_records_lease_id_leases_id_fk` FOREIGN KEY (`lease_id`) REFERENCES `leases`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `property_managers` ADD CONSTRAINT `property_managers_property_id_properties_id_fk` FOREIGN KEY (`property_id`) REFERENCES `properties`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `property_managers` ADD CONSTRAINT `property_managers_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `property_managers` ADD CONSTRAINT `property_managers_invited_by_users_id_fk` FOREIGN KEY (`invited_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;