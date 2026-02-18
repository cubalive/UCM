CREATE TYPE "public"."assigned_by" AS ENUM('system', 'dispatch');--> statement-breakpoint
CREATE TYPE "public"."assignment_batch_status" AS ENUM('proposed', 'applied', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."assignment_status" AS ENUM('active', 'reassigned', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."billing_cycle_type" AS ENUM('weekly', 'biweekly', 'monthly');--> statement-breakpoint
CREATE TYPE "public"."biweekly_mode_type" AS ENUM('1_15', 'anchor_14');--> statement-breakpoint
CREATE TYPE "public"."cert_level" AS ENUM('PLATINUM', 'GOLD', 'SILVER', 'AT_RISK');--> statement-breakpoint
CREATE TYPE "public"."cost_leak_alert_severity" AS ENUM('YELLOW', 'RED');--> statement-breakpoint
CREATE TYPE "public"."cost_leak_alert_status" AS ENUM('OPEN', 'ACKNOWLEDGED', 'RESOLVED');--> statement-breakpoint
CREATE TYPE "public"."cycle_invoice_status" AS ENUM('draft', 'finalized', 'void');--> statement-breakpoint
CREATE TYPE "public"."dispatch_status" AS ENUM('available', 'enroute', 'off', 'hold');--> statement-breakpoint
CREATE TYPE "public"."driver_status" AS ENUM('ACTIVE', 'INACTIVE', 'ON_LEAVE');--> statement-breakpoint
CREATE TYPE "public"."driver_stripe_account_status" AS ENUM('PENDING', 'RESTRICTED', 'ACTIVE');--> statement-breakpoint
CREATE TYPE "public"."driver_trip_alert_kind" AS ENUM('go_time');--> statement-breakpoint
CREATE TYPE "public"."earning_status" AS ENUM('EARNED', 'ELIGIBLE', 'IN_PAYRUN', 'PAID', 'VOID');--> statement-breakpoint
CREATE TYPE "public"."earning_type" AS ENUM('TRIP', 'HOURLY', 'ADJUSTMENT');--> statement-breakpoint
CREATE TYPE "public"."facility_type" AS ENUM('clinic', 'hospital', 'mental', 'private');--> statement-breakpoint
CREATE TYPE "public"."invoice_payment_status" AS ENUM('unpaid', 'partial', 'paid', 'overdue');--> statement-breakpoint
CREATE TYPE "public"."invoice_status" AS ENUM('pending', 'approved', 'paid');--> statement-breakpoint
CREATE TYPE "public"."job_status" AS ENUM('queued', 'working', 'succeeded', 'failed');--> statement-breakpoint
CREATE TYPE "public"."offer_status" AS ENUM('pending', 'accepted', 'expired', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."payment_method" AS ENUM('stripe', 'ach', 'manual');--> statement-breakpoint
CREATE TYPE "public"."payroll_cadence" AS ENUM('WEEKLY', 'BIWEEKLY', 'MONTHLY');--> statement-breakpoint
CREATE TYPE "public"."payroll_pay_mode" AS ENUM('PER_TRIP', 'HOURLY');--> statement-breakpoint
CREATE TYPE "public"."payrun_status" AS ENUM('DRAFT', 'APPROVED', 'PROCESSING', 'PAID', 'FAILED', 'VOID');--> statement-breakpoint
CREATE TYPE "public"."platform_fee_type" AS ENUM('PERCENT', 'FIXED');--> statement-breakpoint
CREATE TYPE "public"."push_platform" AS ENUM('ios', 'android', 'web');--> statement-breakpoint
CREATE TYPE "public"."schedule_change_request_status" AS ENUM('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."schedule_change_request_type" AS ENUM('DAY_CHANGE', 'TIME_CHANGE', 'UNAVAILABLE', 'SWAP_REQUEST');--> statement-breakpoint
CREATE TYPE "public"."series_pattern" AS ENUM('mwf', 'tths', 'daily', 'custom');--> statement-breakpoint
CREATE TYPE "public"."shift_swap_status" AS ENUM('PENDING_TARGET', 'DECLINED_TARGET', 'ACCEPTED_TARGET', 'PENDING_DISPATCH', 'APPROVED_DISPATCH', 'REJECTED_DISPATCH', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."time_entry_source" AS ENUM('MANUAL', 'CSV');--> statement-breakpoint
CREATE TYPE "public"."time_entry_status" AS ENUM('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'PAID');--> statement-breakpoint
CREATE TYPE "public"."time_import_status" AS ENUM('DRAFT', 'PROCESSED', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."tp_payroll_item_status" AS ENUM('DRAFT', 'PAID');--> statement-breakpoint
CREATE TYPE "public"."tp_payroll_run_status" AS ENUM('DRAFT', 'FINALIZED', 'PAID');--> statement-breakpoint
CREATE TYPE "public"."trip_approval_status" AS ENUM('pending', 'approved', 'cancel_requested', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."trip_cancel_type" AS ENUM('soft', 'hard');--> statement-breakpoint
CREATE TYPE "public"."trip_event_type" AS ENUM('late_driver', 'late_patient', 'no_show_driver', 'no_show_patient', 'complaint', 'incident');--> statement-breakpoint
CREATE TYPE "public"."trip_status" AS ENUM('SCHEDULED', 'ASSIGNED', 'EN_ROUTE_TO_PICKUP', 'ARRIVED_PICKUP', 'PICKED_UP', 'EN_ROUTE_TO_DROPOFF', 'ARRIVED_DROPOFF', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'NO_SHOW');--> statement-breakpoint
CREATE TYPE "public"."trip_type" AS ENUM('one_time', 'recurring', 'dialysis');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('SUPER_ADMIN', 'ADMIN', 'DISPATCH', 'DRIVER', 'VIEWER', 'COMPANY_ADMIN', 'CLINIC_USER');--> statement-breakpoint
CREATE TYPE "public"."vehicle_status" AS ENUM('ACTIVE', 'MAINTENANCE', 'OUT_OF_SERVICE');--> statement-breakpoint
CREATE TABLE "account_deletion_requests" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "account_deletion_requests_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"user_id" integer NOT NULL,
	"role" text NOT NULL,
	"reason" text,
	"status" text DEFAULT 'requested' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"reviewed_by" integer,
	"reviewed_at" timestamp,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "ai_engine_snapshots" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "ai_engine_snapshots_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"computed_at" timestamp DEFAULT now() NOT NULL,
	"runtime_ms" integer NOT NULL,
	"engine_status" text DEFAULT 'OK' NOT NULL,
	"trips_analyzed" integer DEFAULT 0 NOT NULL,
	"drivers_analyzed" integer DEFAULT 0 NOT NULL,
	"metrics" jsonb NOT NULL,
	"top_risks" jsonb NOT NULL,
	"forecast" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assignment_batches" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "assignment_batches_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"city_id" integer NOT NULL,
	"run_at" timestamp DEFAULT now() NOT NULL,
	"date" text NOT NULL,
	"status" text DEFAULT 'proposed' NOT NULL,
	"created_by" integer,
	"notes" text,
	"trip_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "audit_log_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"user_id" integer,
	"action" text NOT NULL,
	"entity" text NOT NULL,
	"entity_id" integer,
	"details" text,
	"city_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_readiness_snapshots" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "audit_readiness_snapshots_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"clinic_id" integer NOT NULL,
	"snapshot_date" text NOT NULL,
	"score" numeric NOT NULL,
	"missing_breakdown_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"total_trips" integer DEFAULT 0 NOT NULL,
	"complete_trips" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "billing_audit_log" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "billing_audit_log_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"trip_id" integer NOT NULL,
	"old_outcome" text,
	"new_outcome" text,
	"old_reason" text,
	"new_reason" text,
	"changed_by" integer,
	"changed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "billing_cycle_invoice_items" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "billing_cycle_invoice_items_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"invoice_id" integer NOT NULL,
	"trip_id" integer,
	"patient_id" integer,
	"description" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "billing_cycle_invoices" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "billing_cycle_invoices_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"company_id" integer,
	"clinic_id" integer NOT NULL,
	"period_start" text NOT NULL,
	"period_end" text NOT NULL,
	"status" "cycle_invoice_status" DEFAULT 'draft' NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"subtotal_cents" integer DEFAULT 0 NOT NULL,
	"tax_cents" integer DEFAULT 0 NOT NULL,
	"fees_cents" integer DEFAULT 0 NOT NULL,
	"total_cents" integer DEFAULT 0 NOT NULL,
	"notes" text,
	"created_by" integer,
	"finalized_at" timestamp,
	"invoice_number" text,
	"payment_status" "invoice_payment_status" DEFAULT 'unpaid' NOT NULL,
	"amount_paid_cents" integer DEFAULT 0 NOT NULL,
	"balance_due_cents" integer DEFAULT 0 NOT NULL,
	"due_date" timestamp,
	"stripe_checkout_session_id" text,
	"stripe_payment_intent_id" text,
	"stripe_checkout_url" text,
	"last_payment_at" timestamp,
	"locked" boolean DEFAULT false NOT NULL,
	"receipt_url" text,
	"platform_fee_cents" integer DEFAULT 0 NOT NULL,
	"platform_fee_type" text,
	"platform_fee_rate" numeric,
	"net_to_company_cents" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "billing_cycle_invoices_invoice_number_unique" UNIQUE("invoice_number")
);
--> statement-breakpoint
CREATE TABLE "cities" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "cities_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"name" text NOT NULL,
	"state" text NOT NULL,
	"timezone" text DEFAULT 'America/New_York' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "city_settings" (
	"city_id" integer PRIMARY KEY NOT NULL,
	"shift_start_time" text DEFAULT '06:00' NOT NULL,
	"auto_assign_enabled" boolean DEFAULT true NOT NULL,
	"auto_assign_days" text[] DEFAULT ARRAY['Mon','Tue','Wed','Thu','Fri','Sat'] NOT NULL,
	"auto_assign_minutes_before" integer DEFAULT 60 NOT NULL,
	"driver_go_time_minutes" integer DEFAULT 20 NOT NULL,
	"driver_go_time_repeat_minutes" integer DEFAULT 5 NOT NULL,
	"offer_ttl_seconds" integer DEFAULT 90 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "clinic_alert_log" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "clinic_alert_log_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"clinic_id" integer NOT NULL,
	"alert_fingerprint" text NOT NULL,
	"alert_type" text NOT NULL,
	"overall" text NOT NULL,
	"critical_codes" text[],
	"sent_at" timestamp DEFAULT now() NOT NULL,
	"sent_to" text,
	"provider_sid" text,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "clinic_billing_invoice_lines" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "clinic_billing_invoice_lines_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"invoice_id" integer NOT NULL,
	"trip_id" integer NOT NULL,
	"patient_id" integer NOT NULL,
	"service_date" text NOT NULL,
	"leg_type" text NOT NULL,
	"outcome" text NOT NULL,
	"cancel_window" text,
	"passenger_count" integer DEFAULT 1 NOT NULL,
	"unit_rate_snapshot" numeric(10, 2) NOT NULL,
	"line_total" numeric(10, 2) NOT NULL,
	"pickup_address" text,
	"dropoff_address" text,
	"distance_miles" numeric,
	"trip_public_id" text,
	"pickup_time" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "clinic_billing_invoices" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "clinic_billing_invoices_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"clinic_id" integer NOT NULL,
	"city_id" integer NOT NULL,
	"week_start" text NOT NULL,
	"week_end" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"total_amount" numeric(12, 2) DEFAULT '0.00' NOT NULL,
	"completed_total" numeric(12, 2) DEFAULT '0.00' NOT NULL,
	"no_show_total" numeric(12, 2) DEFAULT '0.00' NOT NULL,
	"cancelled_total" numeric(12, 2) DEFAULT '0.00' NOT NULL,
	"company_error_total" numeric(12, 2) DEFAULT '0.00' NOT NULL,
	"outbound_total" numeric(12, 2) DEFAULT '0.00' NOT NULL,
	"return_total" numeric(12, 2) DEFAULT '0.00' NOT NULL,
	"notes" text,
	"finalized_at" timestamp,
	"finalized_by" integer,
	"created_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "clinic_billing_profiles" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "clinic_billing_profiles_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"clinic_id" integer NOT NULL,
	"city_id" integer NOT NULL,
	"name" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"cancel_advance_hours" integer DEFAULT 24 NOT NULL,
	"cancel_late_minutes" integer DEFAULT 0 NOT NULL,
	"created_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_by" integer,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "clinic_billing_rules" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "clinic_billing_rules_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"profile_id" integer NOT NULL,
	"outcome" text NOT NULL,
	"passenger_count" integer NOT NULL,
	"leg_type" text NOT NULL,
	"cancel_window" text,
	"unit_rate" numeric(10, 2) DEFAULT '0.00' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"updated_by" integer,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "clinic_billing_settings" (
	"clinic_id" integer PRIMARY KEY NOT NULL,
	"billing_cycle" "billing_cycle_type" DEFAULT 'weekly' NOT NULL,
	"anchor_dow" integer,
	"anchor_dom" integer,
	"biweekly_mode" "biweekly_mode_type" DEFAULT '1_15' NOT NULL,
	"anchor_date" text,
	"timezone" text DEFAULT 'America/Los_Angeles' NOT NULL,
	"auto_generate" boolean DEFAULT false NOT NULL,
	"grace_days" integer DEFAULT 0 NOT NULL,
	"late_fee_pct" numeric(5, 2) DEFAULT '0' NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "clinic_certifications" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "clinic_certifications_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"clinic_id" integer NOT NULL,
	"quarter_key" text NOT NULL,
	"period_start" text NOT NULL,
	"period_end" text NOT NULL,
	"cert_level" text NOT NULL,
	"score" numeric NOT NULL,
	"breakdown_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"computed_at" timestamp DEFAULT now() NOT NULL,
	"computed_by" integer,
	"pdf_url" text
);
--> statement-breakpoint
CREATE TABLE "clinic_help_requests" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "clinic_help_requests_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"clinic_id" integer NOT NULL,
	"message" text NOT NULL,
	"resolved" boolean DEFAULT false NOT NULL,
	"resolved_by" integer,
	"resolved_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "clinic_invoice_items" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "clinic_invoice_items_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"invoice_id" integer NOT NULL,
	"trip_id" integer NOT NULL,
	"amount_cents" integer DEFAULT 0 NOT NULL,
	"line_json" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "clinic_invoices_monthly" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "clinic_invoices_monthly_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"clinic_id" integer NOT NULL,
	"city_id" integer,
	"period_month" text NOT NULL,
	"subtotal_cents" integer DEFAULT 0 NOT NULL,
	"adjustments_cents" integer DEFAULT 0 NOT NULL,
	"total_cents" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"generated_at" timestamp DEFAULT now() NOT NULL,
	"sent_at" timestamp,
	"paid_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "clinic_quarterly_report_metrics" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "clinic_quarterly_report_metrics_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"report_id" integer NOT NULL,
	"metric_key" text NOT NULL,
	"metric_value" numeric,
	"payload_json" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "clinic_quarterly_reports" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "clinic_quarterly_reports_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"clinic_id" integer NOT NULL,
	"quarter_key" text NOT NULL,
	"period_start" text NOT NULL,
	"period_end" text NOT NULL,
	"computed_at" timestamp DEFAULT now() NOT NULL,
	"pdf_url" text
);
--> statement-breakpoint
CREATE TABLE "clinic_tariffs" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "clinic_tariffs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"company_id" integer,
	"clinic_id" integer,
	"city_id" integer,
	"name" text DEFAULT 'Default' NOT NULL,
	"pricing_model" text DEFAULT 'MILES_TIME' NOT NULL,
	"base_fee_cents" integer DEFAULT 0 NOT NULL,
	"per_mile_cents" integer DEFAULT 0 NOT NULL,
	"per_minute_cents" integer DEFAULT 0 NOT NULL,
	"wait_minute_cents" integer DEFAULT 0 NOT NULL,
	"wheelchair_extra_cents" integer DEFAULT 0 NOT NULL,
	"shared_trip_mode" text DEFAULT 'PER_PATIENT' NOT NULL,
	"shared_trip_discount_pct" numeric(5, 2) DEFAULT '0' NOT NULL,
	"no_show_fee_cents" integer DEFAULT 0 NOT NULL,
	"cancel_fee_cents" integer DEFAULT 0 NOT NULL,
	"minimum_fare_cents" integer DEFAULT 0 NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"effective_from" timestamp DEFAULT now() NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "clinics" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "clinics_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"public_id" varchar(20) NOT NULL,
	"city_id" integer NOT NULL,
	"name" text NOT NULL,
	"address" text NOT NULL,
	"address_street" text,
	"address_city" text,
	"address_state" text,
	"address_zip" text,
	"address_place_id" text,
	"email" text,
	"auth_user_id" text,
	"lat" double precision,
	"lng" double precision,
	"phone" text,
	"contact_name" text,
	"facility_type" "facility_type" DEFAULT 'clinic' NOT NULL,
	"company_id" integer,
	"active" boolean DEFAULT true NOT NULL,
	"deleted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "clinics_public_id_unique" UNIQUE("public_id"),
	CONSTRAINT "clinics_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "companies" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "companies_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"name" text NOT NULL,
	"dispatch_phone" text,
	"dispatch_chat_enabled" boolean DEFAULT true NOT NULL,
	"dispatch_call_enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "company_payroll_settings" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "company_payroll_settings_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"company_id" integer NOT NULL,
	"cadence" "payroll_cadence" NOT NULL,
	"payday_weekday" integer,
	"payday_day_of_month" integer,
	"timezone" text DEFAULT 'America/Los_Angeles' NOT NULL,
	"pay_mode" "payroll_pay_mode" NOT NULL,
	"hourly_rate_cents" integer,
	"per_trip_flat_cents" integer,
	"per_trip_percent_bps" integer,
	"require_trip_finalized" boolean DEFAULT true NOT NULL,
	"require_clinic_paid" boolean DEFAULT false NOT NULL,
	"minimum_payout_cents" integer DEFAULT 0 NOT NULL,
	"holdback_days" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "company_payroll_settings_company_id_unique" UNIQUE("company_id")
);
--> statement-breakpoint
CREATE TABLE "company_platform_fees" (
	"company_id" integer PRIMARY KEY NOT NULL,
	"enabled" boolean,
	"fee_type" "platform_fee_type",
	"fee_percent" numeric,
	"fee_cents" integer,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "company_settings" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "company_settings_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"company_id" integer NOT NULL,
	"max_drivers" integer DEFAULT 100 NOT NULL,
	"max_active_trips" integer DEFAULT 500 NOT NULL,
	"rpm_limit" integer DEFAULT 300 NOT NULL,
	"pdf_rpm_limit" integer DEFAULT 30 NOT NULL,
	"maps_rpm_limit" integer DEFAULT 60 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "company_settings_company_id_unique" UNIQUE("company_id")
);
--> statement-breakpoint
CREATE TABLE "company_stripe_accounts" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "company_stripe_accounts_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"company_id" integer NOT NULL,
	"stripe_account_id" text NOT NULL,
	"charges_enabled" boolean DEFAULT false NOT NULL,
	"payouts_enabled" boolean DEFAULT false NOT NULL,
	"details_submitted" boolean DEFAULT false NOT NULL,
	"onboarding_status" text DEFAULT 'PENDING' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "company_stripe_accounts_company_id_unique" UNIQUE("company_id")
);
--> statement-breakpoint
CREATE TABLE "cost_leak_alerts" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "cost_leak_alerts_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"city_id" integer NOT NULL,
	"clinic_id" integer,
	"driver_id" integer,
	"alert_type" text NOT NULL,
	"severity" "cost_leak_alert_severity" NOT NULL,
	"status" "cost_leak_alert_status" DEFAULT 'OPEN' NOT NULL,
	"metric_date" text NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"acknowledged_by" integer,
	"acknowledged_at" timestamp,
	"resolved_by" integer,
	"resolved_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "daily_metrics_rollup" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "daily_metrics_rollup_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"metric_date" text NOT NULL,
	"city_id" integer NOT NULL,
	"clinic_id" integer,
	"driver_id" integer,
	"trips_total" integer DEFAULT 0 NOT NULL,
	"trips_completed" integer DEFAULT 0 NOT NULL,
	"trips_cancelled" integer DEFAULT 0 NOT NULL,
	"trips_no_show" integer DEFAULT 0 NOT NULL,
	"on_time_pickup_count" integer DEFAULT 0 NOT NULL,
	"late_pickup_count" integer DEFAULT 0 NOT NULL,
	"avg_pickup_delay_minutes" numeric,
	"gps_verified_count" integer DEFAULT 0 NOT NULL,
	"pricing_missing_count" integer DEFAULT 0 NOT NULL,
	"invoices_missing_count" integer DEFAULT 0 NOT NULL,
	"revenue_cents" integer DEFAULT 0 NOT NULL,
	"est_cost_cents" integer DEFAULT 0 NOT NULL,
	"margin_cents" integer DEFAULT 0 NOT NULL,
	"empty_miles" numeric DEFAULT '0' NOT NULL,
	"idle_minutes" numeric DEFAULT '0' NOT NULL,
	"paid_miles" numeric DEFAULT '0' NOT NULL,
	"active_minutes" numeric DEFAULT '0' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "driver_bonus_rules" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "driver_bonus_rules_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"city_id" integer NOT NULL,
	"is_enabled" boolean DEFAULT false NOT NULL,
	"weekly_amount_cents" integer DEFAULT 0 NOT NULL,
	"criteria_json" jsonb,
	"updated_at" timestamp DEFAULT now(),
	"updated_by" integer,
	CONSTRAINT "driver_bonus_rules_city_id_unique" UNIQUE("city_id")
);
--> statement-breakpoint
CREATE TABLE "driver_devices" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "driver_devices_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"driver_id" integer NOT NULL,
	"company_id" integer,
	"device_fingerprint_hash" text NOT NULL,
	"device_label" text,
	"last_seen_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "driver_earnings_ledger" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "driver_earnings_ledger_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"company_id" integer NOT NULL,
	"driver_id" integer NOT NULL,
	"trip_id" integer,
	"earning_type" "earning_type" NOT NULL,
	"units" numeric,
	"amount_cents" integer NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"earned_at" timestamp NOT NULL,
	"eligible_at" timestamp NOT NULL,
	"status" "earning_status" DEFAULT 'EARNED' NOT NULL,
	"payrun_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "driver_emergency_events" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "driver_emergency_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"driver_id" integer NOT NULL,
	"company_id" integer,
	"lat" text,
	"lng" text,
	"note" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "driver_offers" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "driver_offers_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"trip_id" integer NOT NULL,
	"driver_id" integer NOT NULL,
	"offered_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp NOT NULL,
	"status" "offer_status" DEFAULT 'pending' NOT NULL,
	"accepted_at" timestamp,
	"created_by" integer
);
--> statement-breakpoint
CREATE TABLE "driver_perf_scores" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "driver_perf_scores_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"company_id" integer NOT NULL,
	"driver_id" integer NOT NULL,
	"window" text NOT NULL,
	"score" integer DEFAULT 0 NOT NULL,
	"components" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"computed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "driver_push_tokens" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "driver_push_tokens_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"driver_id" integer NOT NULL,
	"company_id" integer,
	"platform" "push_platform" NOT NULL,
	"token" text NOT NULL,
	"last_seen_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "driver_replacements" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "driver_replacements_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"replacement_date" text NOT NULL,
	"city_id" integer NOT NULL,
	"out_driver_id" integer NOT NULL,
	"substitute_driver_id" integer NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_by" integer,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "driver_scores" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "driver_scores_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"driver_id" integer NOT NULL,
	"city_id" integer NOT NULL,
	"week_start" text NOT NULL,
	"week_end" text NOT NULL,
	"on_time_rate" double precision DEFAULT 0 NOT NULL,
	"completed_trips" integer DEFAULT 0 NOT NULL,
	"total_trips" integer DEFAULT 0 NOT NULL,
	"no_show_avoided" integer DEFAULT 0 NOT NULL,
	"cancellations" integer DEFAULT 0 NOT NULL,
	"late_count" integer DEFAULT 0 NOT NULL,
	"score" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "driver_shift_swap_requests" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "driver_shift_swap_requests_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"company_id" integer,
	"city_id" integer,
	"requester_driver_id" integer NOT NULL,
	"target_driver_id" integer NOT NULL,
	"shift_date" text NOT NULL,
	"shift_start" text,
	"shift_end" text,
	"reason" text NOT NULL,
	"status" "shift_swap_status" DEFAULT 'PENDING_TARGET' NOT NULL,
	"target_decision_note" text,
	"dispatch_user_id" integer,
	"dispatch_decision_note" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"target_decided_at" timestamp,
	"dispatch_decided_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "driver_stripe_accounts" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "driver_stripe_accounts_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"company_id" integer NOT NULL,
	"driver_id" integer NOT NULL,
	"stripe_account_id" text NOT NULL,
	"status" "driver_stripe_account_status" DEFAULT 'PENDING' NOT NULL,
	"payouts_enabled" boolean DEFAULT false NOT NULL,
	"details_submitted" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "driver_support_events" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "driver_support_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"driver_id" integer NOT NULL,
	"trip_id" integer,
	"event_type" text NOT NULL,
	"notes" text,
	"resolved" boolean DEFAULT false NOT NULL,
	"resolved_by" integer,
	"resolved_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "driver_trip_alerts" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "driver_trip_alerts_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"trip_id" integer NOT NULL,
	"driver_id" integer NOT NULL,
	"kind" "driver_trip_alert_kind" NOT NULL,
	"first_shown_at" timestamp DEFAULT now() NOT NULL,
	"last_shown_at" timestamp DEFAULT now() NOT NULL,
	"acknowledged_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "driver_vehicle_assignments" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "driver_vehicle_assignments_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"date" text NOT NULL,
	"city_id" integer NOT NULL,
	"shift_start_time" text NOT NULL,
	"driver_id" integer NOT NULL,
	"vehicle_id" integer NOT NULL,
	"assigned_by" "assigned_by" DEFAULT 'system' NOT NULL,
	"status" "assignment_status" DEFAULT 'active' NOT NULL,
	"notes" text,
	"updated_by" integer,
	"updated_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "driver_weekly_schedules" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "driver_weekly_schedules_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"driver_id" integer NOT NULL,
	"city_id" integer NOT NULL,
	"mon_enabled" boolean DEFAULT false NOT NULL,
	"mon_start" text DEFAULT '06:00',
	"mon_end" text DEFAULT '18:00',
	"tue_enabled" boolean DEFAULT false NOT NULL,
	"tue_start" text DEFAULT '06:00',
	"tue_end" text DEFAULT '18:00',
	"wed_enabled" boolean DEFAULT false NOT NULL,
	"wed_start" text DEFAULT '06:00',
	"wed_end" text DEFAULT '18:00',
	"thu_enabled" boolean DEFAULT false NOT NULL,
	"thu_start" text DEFAULT '06:00',
	"thu_end" text DEFAULT '18:00',
	"fri_enabled" boolean DEFAULT false NOT NULL,
	"fri_start" text DEFAULT '06:00',
	"fri_end" text DEFAULT '18:00',
	"sat_enabled" boolean DEFAULT false NOT NULL,
	"sat_start" text DEFAULT '06:00',
	"sat_end" text DEFAULT '18:00',
	"updated_by" integer,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "drivers" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "drivers_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"public_id" varchar(20) NOT NULL,
	"city_id" integer NOT NULL,
	"user_id" integer,
	"vehicle_id" integer,
	"auth_user_id" text,
	"email" text,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"phone" text NOT NULL,
	"license_number" text,
	"last_lat" double precision,
	"last_lng" double precision,
	"last_seen_at" timestamp,
	"status" "driver_status" DEFAULT 'ACTIVE' NOT NULL,
	"dispatch_status" "dispatch_status" DEFAULT 'off' NOT NULL,
	"last_active_at" timestamp,
	"connected" boolean DEFAULT false NOT NULL,
	"connected_at" timestamp,
	"company_id" integer,
	"active" boolean DEFAULT true NOT NULL,
	"deleted_at" timestamp,
	"deleted_by" integer,
	"delete_reason" text,
	"updated_at" timestamp DEFAULT now(),
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "drivers_public_id_unique" UNIQUE("public_id"),
	CONSTRAINT "drivers_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "external_id_map" (
	"id" varchar(36) PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" integer NOT NULL,
	"entity" text NOT NULL,
	"source_system" text NOT NULL,
	"external_id" text NOT NULL,
	"ucm_id" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "import_job_events" (
	"id" varchar(36) PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"import_job_id" varchar(36) NOT NULL,
	"level" text NOT NULL,
	"message" text NOT NULL,
	"payload" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "import_job_files" (
	"id" varchar(36) PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"import_job_id" varchar(36) NOT NULL,
	"entity" text NOT NULL,
	"filename" text NOT NULL,
	"mime_type" text NOT NULL,
	"storage_json" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "import_jobs" (
	"id" varchar(36) PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" integer NOT NULL,
	"city_id" integer,
	"source_system" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_by" integer NOT NULL,
	"consent_confirmed" boolean DEFAULT true NOT NULL,
	"summary_json" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "intelligence_publication_targets" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "intelligence_publication_targets_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"publication_id" integer NOT NULL,
	"target_type" text NOT NULL,
	"clinic_id" integer,
	"enabled" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "intelligence_publications" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "intelligence_publications_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"module" text NOT NULL,
	"quarter_key" text,
	"scope" text,
	"state" text,
	"city" text,
	"metric_key" text,
	"config_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"published" boolean DEFAULT false NOT NULL,
	"published_at" timestamp,
	"published_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoice_payments" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "invoice_payments_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"invoice_id" integer NOT NULL,
	"amount_cents" integer NOT NULL,
	"method" "payment_method" NOT NULL,
	"reference" text,
	"stripe_payment_intent_id" text,
	"stripe_charge_id" text,
	"paid_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoice_sequences" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"last_number" integer DEFAULT 0 NOT NULL,
	"prefix" text DEFAULT 'INV' NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "invoices_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"clinic_id" integer NOT NULL,
	"trip_id" integer,
	"patient_name" text NOT NULL,
	"service_date" text NOT NULL,
	"amount" numeric(10, 2) NOT NULL,
	"status" "invoice_status" DEFAULT 'pending' NOT NULL,
	"notes" text,
	"pdf_url" text,
	"reason" text,
	"fault_party" text,
	"related_trip_id" integer,
	"email_to" text,
	"email_status" text DEFAULT 'not_sent' NOT NULL,
	"email_sent_at" timestamp,
	"email_error" text,
	"stripe_payment_link" text,
	"stripe_checkout_session_id" text,
	"stripe_payment_intent_id" text,
	"stripe_charge_id" text,
	"receipt_url" text,
	"paid_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" integer,
	"type" text NOT NULL,
	"status" "job_status" DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"result" jsonb,
	"last_error" text,
	"locked_until" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "login_tokens" (
	"id" text PRIMARY KEY NOT NULL,
	"token_hash" text NOT NULL,
	"user_id" integer,
	"clinic_id" integer,
	"driver_id" integer,
	"role" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"used_at" timestamp,
	"created_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "login_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "ops_alert_log" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "ops_alert_log_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"city_id" integer NOT NULL,
	"date" text NOT NULL,
	"alert_fingerprint" text NOT NULL,
	"overall" text NOT NULL,
	"critical_codes" text[],
	"sent_at" timestamp DEFAULT now() NOT NULL,
	"sent_to" text,
	"provider_sid" text,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "ops_anomalies" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "ops_anomalies_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"company_id" integer NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" integer,
	"severity" text DEFAULT 'info' NOT NULL,
	"code" text NOT NULL,
	"title" text NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"first_seen_at" timestamp DEFAULT now() NOT NULL,
	"last_seen_at" timestamp DEFAULT now() NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "patients" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "patients_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"public_id" varchar(20) NOT NULL,
	"city_id" integer NOT NULL,
	"clinic_id" integer,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"phone" text,
	"address" text,
	"address_street" text,
	"address_city" text,
	"address_state" text,
	"address_zip" text,
	"address_place_id" text,
	"lat" double precision,
	"lng" double precision,
	"date_of_birth" text,
	"insurance_id" text,
	"email" text,
	"notes" text,
	"wheelchair_required" boolean DEFAULT false NOT NULL,
	"source" text DEFAULT 'internal' NOT NULL,
	"company_id" integer,
	"active" boolean DEFAULT true NOT NULL,
	"deleted_at" timestamp,
	"deleted_by" integer,
	"delete_reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "patients_public_id_unique" UNIQUE("public_id")
);
--> statement-breakpoint
CREATE TABLE "payroll_payrun_items" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "payroll_payrun_items_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"payrun_id" integer NOT NULL,
	"driver_id" integer NOT NULL,
	"amount_cents" integer NOT NULL,
	"stripe_transfer_id" text,
	"paid_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "payroll_payruns" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "payroll_payruns_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"company_id" integer NOT NULL,
	"period_start" text NOT NULL,
	"period_end" text NOT NULL,
	"pay_mode" "payroll_pay_mode" NOT NULL,
	"cadence" "payroll_cadence" NOT NULL,
	"scheduled_payday" text NOT NULL,
	"status" "payrun_status" DEFAULT 'DRAFT' NOT NULL,
	"created_by" integer NOT NULL,
	"approved_by" integer,
	"approved_at" timestamp,
	"processed_at" timestamp,
	"idempotency_key" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "payroll_payruns_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "platform_billing_settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"default_fee_type" "platform_fee_type" DEFAULT 'PERCENT' NOT NULL,
	"default_fee_percent" numeric DEFAULT '0' NOT NULL,
	"default_fee_cents" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pricing_audit_log" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "pricing_audit_log_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"profile_id" integer NOT NULL,
	"key" text NOT NULL,
	"old_value" text,
	"new_value" text,
	"changed_by" integer,
	"changed_at" timestamp DEFAULT now() NOT NULL,
	"note" text
);
--> statement-breakpoint
CREATE TABLE "pricing_profiles" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "pricing_profiles_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"name" text NOT NULL,
	"city" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"applies_to" text DEFAULT 'private' NOT NULL,
	"created_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_by" integer,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "pricing_rules" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "pricing_rules_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"profile_id" integer NOT NULL,
	"key" text NOT NULL,
	"value_numeric" numeric(12, 4),
	"value_text" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"updated_by" integer,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "quarterly_ranking_entries" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "quarterly_ranking_entries_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"ranking_id" integer NOT NULL,
	"clinic_id" integer NOT NULL,
	"rank" integer NOT NULL,
	"score" numeric NOT NULL,
	"percentile" numeric NOT NULL,
	"payload_json" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quarterly_rankings" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "quarterly_rankings_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"quarter_key" text NOT NULL,
	"scope" text NOT NULL,
	"state" text,
	"city" text,
	"metric_key" text DEFAULT 'tri' NOT NULL,
	"computed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recurring_pricing_overrides" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "recurring_pricing_overrides_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"company_id" integer NOT NULL,
	"clinic_id" integer NOT NULL,
	"patient_id" integer NOT NULL,
	"schedule_id" integer,
	"effective_from" text NOT NULL,
	"effective_to" text,
	"price_cents" integer NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recurring_schedules" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "recurring_schedules_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"patient_id" integer NOT NULL,
	"city_id" integer NOT NULL,
	"days" text[] NOT NULL,
	"pickup_time" text NOT NULL,
	"start_date" text NOT NULL,
	"end_date" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "route_batches" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "route_batches_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"city_id" integer NOT NULL,
	"date" text NOT NULL,
	"batch_label" text,
	"trip_ids" integer[] NOT NULL,
	"driver_assigned" integer,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "route_cache" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "route_cache_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"key_hash" text NOT NULL,
	"origin" text NOT NULL,
	"destination" text NOT NULL,
	"mode" text DEFAULT 'driving' NOT NULL,
	"distance_miles" double precision,
	"duration_minutes" double precision,
	"response_json" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "schedule_change_requests" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "schedule_change_requests_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"company_id" integer,
	"driver_id" integer NOT NULL,
	"city_id" integer,
	"request_type" "schedule_change_request_type" NOT NULL,
	"current_schedule_date" text,
	"requested_date" text,
	"current_shift_start" text,
	"current_shift_end" text,
	"requested_shift_start" text,
	"requested_shift_end" text,
	"reason" text NOT NULL,
	"status" "schedule_change_request_status" DEFAULT 'PENDING' NOT NULL,
	"dispatcher_user_id" integer,
	"decision_note" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"decided_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "session_revocations" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "session_revocations_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"user_id" integer NOT NULL,
	"company_id" integer,
	"revoked_after" timestamp NOT NULL,
	"reason" text,
	"created_by_user_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sms_opt_out" (
	"phone" text PRIMARY KEY NOT NULL,
	"opted_out" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stripe_webhook_events" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "stripe_webhook_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"stripe_event_id" text NOT NULL,
	"type" text NOT NULL,
	"status" text DEFAULT 'RECEIVED' NOT NULL,
	"error" text,
	"processed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "stripe_webhook_events_stripe_event_id_unique" UNIQUE("stripe_event_id")
);
--> statement-breakpoint
CREATE TABLE "substitute_pool" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "substitute_pool_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"pool_date" text NOT NULL,
	"city_id" integer NOT NULL,
	"driver_id" integer NOT NULL,
	"added_by" integer,
	"added_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "sunday_roster_drivers" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "sunday_roster_drivers_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"roster_id" integer NOT NULL,
	"driver_id" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sunday_rosters" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "sunday_rosters_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"roster_date" text NOT NULL,
	"city_id" integer NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"updated_by" integer,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "support_messages" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "support_messages_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"thread_id" integer NOT NULL,
	"company_id" integer NOT NULL,
	"clinic_id" integer NOT NULL,
	"sender_role" text NOT NULL,
	"sender_user_id" integer NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "support_threads" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "support_threads_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"company_id" integer NOT NULL,
	"clinic_id" integer NOT NULL,
	"subject" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'OPEN' NOT NULL,
	"last_message_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "system_events" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "system_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"company_id" integer,
	"actor_user_id" integer,
	"event_type" text NOT NULL,
	"entity_type" text,
	"entity_id" text,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "time_entries" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "time_entries_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"company_id" integer NOT NULL,
	"driver_id" integer NOT NULL,
	"work_date" text NOT NULL,
	"start_time" text,
	"end_time" text,
	"break_minutes" integer DEFAULT 0 NOT NULL,
	"hours_numeric" numeric DEFAULT '0' NOT NULL,
	"pay_type" text DEFAULT 'HOURLY' NOT NULL,
	"hourly_rate_cents" integer,
	"notes" text DEFAULT '' NOT NULL,
	"source_type" time_entry_source NOT NULL,
	"source_ref" text DEFAULT '' NOT NULL,
	"status" time_entry_status DEFAULT 'DRAFT' NOT NULL,
	"created_by" integer NOT NULL,
	"approved_by" integer,
	"approved_at" timestamp,
	"paid_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "time_import_batches" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "time_import_batches_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"company_id" integer NOT NULL,
	"uploaded_by" integer NOT NULL,
	"filename" text NOT NULL,
	"row_count" integer DEFAULT 0 NOT NULL,
	"created_count" integer DEFAULT 0 NOT NULL,
	"skipped_count" integer DEFAULT 0 NOT NULL,
	"status" time_import_status DEFAULT 'DRAFT' NOT NULL,
	"error_summary" text DEFAULT '' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tp_payroll_items" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "tp_payroll_items_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"run_id" integer NOT NULL,
	"company_id" integer NOT NULL,
	"driver_id" integer NOT NULL,
	"total_hours" numeric DEFAULT '0' NOT NULL,
	"total_cents" integer DEFAULT 0 NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"status" "tp_payroll_item_status" DEFAULT 'DRAFT' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tp_payroll_runs" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "tp_payroll_runs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"company_id" integer NOT NULL,
	"period_start" text NOT NULL,
	"period_end" text NOT NULL,
	"status" "tp_payroll_run_status" DEFAULT 'DRAFT' NOT NULL,
	"created_by" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tri_scores" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "tri_scores_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"period_start" text NOT NULL,
	"period_end" text NOT NULL,
	"city_id" integer NOT NULL,
	"clinic_id" integer,
	"tri_score" numeric NOT NULL,
	"components" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trip_billing" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "trip_billing_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"trip_id" integer NOT NULL,
	"company_id" integer,
	"clinic_id" integer,
	"patient_id" integer,
	"city_id" integer,
	"service_date" text,
	"status_at_bill" text DEFAULT 'COMPLETED' NOT NULL,
	"pricing_mode" text DEFAULT 'TARIFF' NOT NULL,
	"tariff_id" integer,
	"contract_price_cents" integer,
	"mobility_requirement" text DEFAULT 'STANDARD' NOT NULL,
	"distance_miles" numeric(10, 2),
	"wait_minutes" integer DEFAULT 0 NOT NULL,
	"base_fee_cents" integer DEFAULT 0 NOT NULL,
	"per_mile_cents" integer DEFAULT 0 NOT NULL,
	"mileage_cents" integer DEFAULT 0 NOT NULL,
	"per_minute_cents" integer DEFAULT 0 NOT NULL,
	"minutes_cents" integer DEFAULT 0 NOT NULL,
	"wait_cents" integer DEFAULT 0 NOT NULL,
	"wheelchair_cents" integer DEFAULT 0 NOT NULL,
	"shared_passengers" integer DEFAULT 1 NOT NULL,
	"shared_discount_cents" integer DEFAULT 0 NOT NULL,
	"no_show_fee_cents" integer DEFAULT 0 NOT NULL,
	"cancel_fee_cents" integer DEFAULT 0 NOT NULL,
	"adjustments_cents" integer DEFAULT 0 NOT NULL,
	"subtotal_cents" integer DEFAULT 0 NOT NULL,
	"total_cents" integer DEFAULT 0 NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"components" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "trip_events" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "trip_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"trip_id" integer NOT NULL,
	"event_type" "trip_event_type" NOT NULL,
	"minutes_late" integer,
	"notes" text,
	"created_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trip_messages" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "trip_messages_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"trip_id" integer NOT NULL,
	"sender_id" integer NOT NULL,
	"sender_role" text NOT NULL,
	"message" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trip_pdfs" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "trip_pdfs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"company_id" integer,
	"trip_id" integer NOT NULL,
	"job_id" text,
	"content_type" text DEFAULT 'application/pdf' NOT NULL,
	"bytes" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trip_series" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "trip_series_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"city_id" integer NOT NULL,
	"clinic_id" integer,
	"patient_id" integer NOT NULL,
	"pattern" "series_pattern" NOT NULL,
	"days_mask" text NOT NULL,
	"start_date" text NOT NULL,
	"end_date" text,
	"occurrences" integer,
	"pickup_time" text NOT NULL,
	"estimated_arrival_time" text NOT NULL,
	"pickup_address" text NOT NULL,
	"pickup_street" text,
	"pickup_city" text,
	"pickup_state" text,
	"pickup_zip" text,
	"pickup_place_id" text,
	"pickup_lat" double precision,
	"pickup_lng" double precision,
	"dropoff_address" text NOT NULL,
	"dropoff_street" text,
	"dropoff_city" text,
	"dropoff_state" text,
	"dropoff_zip" text,
	"dropoff_place_id" text,
	"dropoff_lat" double precision,
	"dropoff_lng" double precision,
	"active" boolean DEFAULT true NOT NULL,
	"created_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trip_share_tokens" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "trip_share_tokens_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"trip_id" integer NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp NOT NULL,
	"revoked" boolean DEFAULT false NOT NULL,
	CONSTRAINT "trip_share_tokens_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "trip_signatures" (
	"trip_id" integer PRIMARY KEY NOT NULL,
	"driver_sig_base64" text,
	"clinic_sig_base64" text,
	"driver_signed_at" timestamp,
	"clinic_signed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "trip_sms_log" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "trip_sms_log_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"trip_id" integer NOT NULL,
	"kind" text NOT NULL,
	"to_phone" text,
	"provider_sid" text,
	"error" text,
	"sent_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trips" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "trips_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"public_id" varchar(20) NOT NULL,
	"city_id" integer NOT NULL,
	"patient_id" integer NOT NULL,
	"driver_id" integer,
	"vehicle_id" integer,
	"clinic_id" integer,
	"pickup_address" text NOT NULL,
	"pickup_street" text,
	"pickup_city" text,
	"pickup_state" text,
	"pickup_zip" text,
	"pickup_place_id" text,
	"pickup_lat" double precision,
	"pickup_lng" double precision,
	"dropoff_address" text NOT NULL,
	"dropoff_street" text,
	"dropoff_city" text,
	"dropoff_state" text,
	"dropoff_zip" text,
	"dropoff_place_id" text,
	"dropoff_lat" double precision,
	"dropoff_lng" double precision,
	"scheduled_date" text NOT NULL,
	"scheduled_time" text,
	"pickup_time" text NOT NULL,
	"estimated_arrival_time" text NOT NULL,
	"trip_type" "trip_type" DEFAULT 'one_time' NOT NULL,
	"recurring_days" text[],
	"status" "trip_status" DEFAULT 'SCHEDULED' NOT NULL,
	"last_eta_minutes" integer,
	"distance_miles" numeric,
	"duration_minutes" integer,
	"route_polyline" text,
	"last_eta_updated_at" timestamp,
	"five_min_alert_sent" boolean DEFAULT false NOT NULL,
	"static_map_thumb_url" text,
	"static_map_full_url" text,
	"static_map_generated_at" timestamp,
	"updated_at" timestamp DEFAULT now(),
	"approval_status" "trip_approval_status" DEFAULT 'approved' NOT NULL,
	"approved_at" timestamp,
	"approved_by" integer,
	"cancelled_by" integer,
	"cancelled_reason" text,
	"cancel_type" "trip_cancel_type",
	"cancelled_at" timestamp,
	"trip_series_id" integer,
	"confirmation_status" text DEFAULT 'unconfirmed',
	"no_show_risk" boolean DEFAULT false NOT NULL,
	"confirmation_time" timestamp,
	"route_batch_id" integer,
	"route_order" integer,
	"assigned_at" timestamp,
	"assigned_by" integer,
	"assignment_batch_id" integer,
	"assignment_source" text,
	"assignment_reason" text,
	"started_at" timestamp,
	"arrived_pickup_at" timestamp,
	"picked_up_at" timestamp,
	"en_route_dropoff_at" timestamp,
	"arrived_dropoff_at" timestamp,
	"completed_at" timestamp,
	"company_id" integer,
	"invoice_id" integer,
	"deleted_at" timestamp,
	"request_source" text DEFAULT 'internal' NOT NULL,
	"notes" text,
	"billable" boolean DEFAULT true NOT NULL,
	"fault_party" text,
	"cancel_stage" text,
	"parent_trip_id" integer,
	"cancel_fee" numeric(10, 2),
	"cancel_fee_override" numeric(10, 2),
	"cancel_fee_override_note" text,
	"mobility_requirement" text DEFAULT 'STANDARD' NOT NULL,
	"passenger_count" integer DEFAULT 1 NOT NULL,
	"billing_outcome" text,
	"billing_reason" text,
	"billing_set_by" integer,
	"billing_set_at" timestamp,
	"billing_override" boolean DEFAULT false NOT NULL,
	"cancel_window" text,
	"price_total_cents" integer,
	"pricing_snapshot" jsonb,
	"verification_token" text,
	"pdf_hash" text,
	"shared_group_id" text,
	"shared_passenger_count" integer DEFAULT 1 NOT NULL,
	"shared_pricing_mode" text DEFAULT 'PER_PATIENT' NOT NULL,
	"primary_trip_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "trips_public_id_unique" UNIQUE("public_id")
);
--> statement-breakpoint
CREATE TABLE "ucm_certifications" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "ucm_certifications_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"city_id" integer NOT NULL,
	"clinic_id" integer NOT NULL,
	"certification_status" text NOT NULL,
	"tri_score" numeric,
	"gps_rate" numeric,
	"no_show_rate" numeric,
	"period_start" text NOT NULL,
	"period_end" text NOT NULL,
	"reason" text,
	"certified_by" integer,
	"certified_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_city_access" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "user_city_access_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"user_id" integer NOT NULL,
	"city_id" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "users_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"public_id" varchar(20) NOT NULL,
	"email" text NOT NULL,
	"password" text NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"role" "user_role" DEFAULT 'VIEWER' NOT NULL,
	"phone" text,
	"active" boolean DEFAULT true NOT NULL,
	"must_change_password" boolean DEFAULT false NOT NULL,
	"driver_id" integer,
	"clinic_id" integer,
	"patient_id" integer,
	"company_id" integer,
	"deleted_at" timestamp,
	"deleted_by" integer,
	"delete_reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_public_id_unique" UNIQUE("public_id"),
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "vehicle_assignment_history" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "vehicle_assignment_history_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"driver_id" integer NOT NULL,
	"vehicle_id" integer NOT NULL,
	"city_id" integer NOT NULL,
	"assigned_at" timestamp DEFAULT now() NOT NULL,
	"unassigned_at" timestamp,
	"assigned_by" text DEFAULT 'system' NOT NULL,
	"reason" text
);
--> statement-breakpoint
CREATE TABLE "vehicle_makes" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "vehicle_makes_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"name" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "vehicle_makes_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "vehicle_models" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "vehicle_models_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"make_id" integer NOT NULL,
	"name" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vehicles" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "vehicles_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"public_id" varchar(20) NOT NULL,
	"city_id" integer NOT NULL,
	"name" text NOT NULL,
	"license_plate" text NOT NULL,
	"color_hex" text DEFAULT '#6366F1' NOT NULL,
	"make" text,
	"model" text,
	"make_id" integer,
	"model_id" integer,
	"make_text" text,
	"model_text" text,
	"year" integer,
	"capacity" integer DEFAULT 4 NOT NULL,
	"wheelchair_accessible" boolean DEFAULT false NOT NULL,
	"capability" text DEFAULT 'SEDAN' NOT NULL,
	"status" "vehicle_status" DEFAULT 'ACTIVE' NOT NULL,
	"last_service_date" timestamp,
	"maintenance_notes" text,
	"company_id" integer,
	"active" boolean DEFAULT true NOT NULL,
	"deleted_at" timestamp,
	"deleted_by" integer,
	"delete_reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "vehicles_public_id_unique" UNIQUE("public_id")
);
--> statement-breakpoint
CREATE TABLE "weekly_score_snapshots" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "weekly_score_snapshots_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"week_start" text NOT NULL,
	"city_id" integer NOT NULL,
	"clinic_id" integer,
	"driver_id" integer,
	"dpi_score" numeric,
	"cri_score" numeric,
	"tri_score" numeric,
	"cost_bleed_score" numeric,
	"components" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account_deletion_requests" ADD CONSTRAINT "account_deletion_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_deletion_requests" ADD CONSTRAINT "account_deletion_requests_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment_batches" ADD CONSTRAINT "assignment_batches_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment_batches" ADD CONSTRAINT "assignment_batches_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_readiness_snapshots" ADD CONSTRAINT "audit_readiness_snapshots_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_audit_log" ADD CONSTRAINT "billing_audit_log_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_audit_log" ADD CONSTRAINT "billing_audit_log_changed_by_users_id_fk" FOREIGN KEY ("changed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_cycle_invoice_items" ADD CONSTRAINT "billing_cycle_invoice_items_invoice_id_billing_cycle_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."billing_cycle_invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_cycle_invoice_items" ADD CONSTRAINT "billing_cycle_invoice_items_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_cycle_invoice_items" ADD CONSTRAINT "billing_cycle_invoice_items_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_cycle_invoices" ADD CONSTRAINT "billing_cycle_invoices_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_cycle_invoices" ADD CONSTRAINT "billing_cycle_invoices_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_cycle_invoices" ADD CONSTRAINT "billing_cycle_invoices_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "city_settings" ADD CONSTRAINT "city_settings_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinic_alert_log" ADD CONSTRAINT "clinic_alert_log_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinic_billing_invoice_lines" ADD CONSTRAINT "clinic_billing_invoice_lines_invoice_id_clinic_billing_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."clinic_billing_invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinic_billing_invoice_lines" ADD CONSTRAINT "clinic_billing_invoice_lines_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinic_billing_invoice_lines" ADD CONSTRAINT "clinic_billing_invoice_lines_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinic_billing_invoices" ADD CONSTRAINT "clinic_billing_invoices_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinic_billing_invoices" ADD CONSTRAINT "clinic_billing_invoices_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinic_billing_invoices" ADD CONSTRAINT "clinic_billing_invoices_finalized_by_users_id_fk" FOREIGN KEY ("finalized_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinic_billing_invoices" ADD CONSTRAINT "clinic_billing_invoices_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinic_billing_profiles" ADD CONSTRAINT "clinic_billing_profiles_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinic_billing_profiles" ADD CONSTRAINT "clinic_billing_profiles_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinic_billing_profiles" ADD CONSTRAINT "clinic_billing_profiles_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinic_billing_profiles" ADD CONSTRAINT "clinic_billing_profiles_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinic_billing_rules" ADD CONSTRAINT "clinic_billing_rules_profile_id_clinic_billing_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."clinic_billing_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinic_billing_rules" ADD CONSTRAINT "clinic_billing_rules_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinic_billing_settings" ADD CONSTRAINT "clinic_billing_settings_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinic_certifications" ADD CONSTRAINT "clinic_certifications_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinic_certifications" ADD CONSTRAINT "clinic_certifications_computed_by_users_id_fk" FOREIGN KEY ("computed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinic_help_requests" ADD CONSTRAINT "clinic_help_requests_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinic_help_requests" ADD CONSTRAINT "clinic_help_requests_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinic_invoice_items" ADD CONSTRAINT "clinic_invoice_items_invoice_id_clinic_invoices_monthly_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."clinic_invoices_monthly"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinic_invoice_items" ADD CONSTRAINT "clinic_invoice_items_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinic_invoices_monthly" ADD CONSTRAINT "clinic_invoices_monthly_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinic_invoices_monthly" ADD CONSTRAINT "clinic_invoices_monthly_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinic_quarterly_report_metrics" ADD CONSTRAINT "clinic_quarterly_report_metrics_report_id_clinic_quarterly_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."clinic_quarterly_reports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinic_quarterly_reports" ADD CONSTRAINT "clinic_quarterly_reports_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinic_tariffs" ADD CONSTRAINT "clinic_tariffs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinic_tariffs" ADD CONSTRAINT "clinic_tariffs_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinic_tariffs" ADD CONSTRAINT "clinic_tariffs_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinics" ADD CONSTRAINT "clinics_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinics" ADD CONSTRAINT "clinics_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_payroll_settings" ADD CONSTRAINT "company_payroll_settings_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_platform_fees" ADD CONSTRAINT "company_platform_fees_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_settings" ADD CONSTRAINT "company_settings_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_stripe_accounts" ADD CONSTRAINT "company_stripe_accounts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_leak_alerts" ADD CONSTRAINT "cost_leak_alerts_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_leak_alerts" ADD CONSTRAINT "cost_leak_alerts_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_leak_alerts" ADD CONSTRAINT "cost_leak_alerts_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_leak_alerts" ADD CONSTRAINT "cost_leak_alerts_acknowledged_by_users_id_fk" FOREIGN KEY ("acknowledged_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_leak_alerts" ADD CONSTRAINT "cost_leak_alerts_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_metrics_rollup" ADD CONSTRAINT "daily_metrics_rollup_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_metrics_rollup" ADD CONSTRAINT "daily_metrics_rollup_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_metrics_rollup" ADD CONSTRAINT "daily_metrics_rollup_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_bonus_rules" ADD CONSTRAINT "driver_bonus_rules_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_bonus_rules" ADD CONSTRAINT "driver_bonus_rules_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_devices" ADD CONSTRAINT "driver_devices_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_devices" ADD CONSTRAINT "driver_devices_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_earnings_ledger" ADD CONSTRAINT "driver_earnings_ledger_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_earnings_ledger" ADD CONSTRAINT "driver_earnings_ledger_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_earnings_ledger" ADD CONSTRAINT "driver_earnings_ledger_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_emergency_events" ADD CONSTRAINT "driver_emergency_events_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_offers" ADD CONSTRAINT "driver_offers_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_offers" ADD CONSTRAINT "driver_offers_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_offers" ADD CONSTRAINT "driver_offers_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_perf_scores" ADD CONSTRAINT "driver_perf_scores_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_perf_scores" ADD CONSTRAINT "driver_perf_scores_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_push_tokens" ADD CONSTRAINT "driver_push_tokens_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_push_tokens" ADD CONSTRAINT "driver_push_tokens_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_replacements" ADD CONSTRAINT "driver_replacements_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_replacements" ADD CONSTRAINT "driver_replacements_out_driver_id_drivers_id_fk" FOREIGN KEY ("out_driver_id") REFERENCES "public"."drivers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_replacements" ADD CONSTRAINT "driver_replacements_substitute_driver_id_drivers_id_fk" FOREIGN KEY ("substitute_driver_id") REFERENCES "public"."drivers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_replacements" ADD CONSTRAINT "driver_replacements_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_scores" ADD CONSTRAINT "driver_scores_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_scores" ADD CONSTRAINT "driver_scores_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_shift_swap_requests" ADD CONSTRAINT "driver_shift_swap_requests_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_shift_swap_requests" ADD CONSTRAINT "driver_shift_swap_requests_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_shift_swap_requests" ADD CONSTRAINT "driver_shift_swap_requests_requester_driver_id_drivers_id_fk" FOREIGN KEY ("requester_driver_id") REFERENCES "public"."drivers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_shift_swap_requests" ADD CONSTRAINT "driver_shift_swap_requests_target_driver_id_drivers_id_fk" FOREIGN KEY ("target_driver_id") REFERENCES "public"."drivers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_shift_swap_requests" ADD CONSTRAINT "driver_shift_swap_requests_dispatch_user_id_users_id_fk" FOREIGN KEY ("dispatch_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_stripe_accounts" ADD CONSTRAINT "driver_stripe_accounts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_stripe_accounts" ADD CONSTRAINT "driver_stripe_accounts_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_support_events" ADD CONSTRAINT "driver_support_events_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_support_events" ADD CONSTRAINT "driver_support_events_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_support_events" ADD CONSTRAINT "driver_support_events_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_trip_alerts" ADD CONSTRAINT "driver_trip_alerts_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_trip_alerts" ADD CONSTRAINT "driver_trip_alerts_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_vehicle_assignments" ADD CONSTRAINT "driver_vehicle_assignments_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_vehicle_assignments" ADD CONSTRAINT "driver_vehicle_assignments_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_vehicle_assignments" ADD CONSTRAINT "driver_vehicle_assignments_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_weekly_schedules" ADD CONSTRAINT "driver_weekly_schedules_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_weekly_schedules" ADD CONSTRAINT "driver_weekly_schedules_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_weekly_schedules" ADD CONSTRAINT "driver_weekly_schedules_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drivers" ADD CONSTRAINT "drivers_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drivers" ADD CONSTRAINT "drivers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drivers" ADD CONSTRAINT "drivers_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drivers" ADD CONSTRAINT "drivers_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_job_events" ADD CONSTRAINT "import_job_events_import_job_id_import_jobs_id_fk" FOREIGN KEY ("import_job_id") REFERENCES "public"."import_jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_job_files" ADD CONSTRAINT "import_job_files_import_job_id_import_jobs_id_fk" FOREIGN KEY ("import_job_id") REFERENCES "public"."import_jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intelligence_publication_targets" ADD CONSTRAINT "intelligence_publication_targets_publication_id_intelligence_publications_id_fk" FOREIGN KEY ("publication_id") REFERENCES "public"."intelligence_publications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intelligence_publication_targets" ADD CONSTRAINT "intelligence_publication_targets_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intelligence_publications" ADD CONSTRAINT "intelligence_publications_published_by_users_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_payments" ADD CONSTRAINT "invoice_payments_invoice_id_billing_cycle_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."billing_cycle_invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops_alert_log" ADD CONSTRAINT "ops_alert_log_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops_anomalies" ADD CONSTRAINT "ops_anomalies_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patients" ADD CONSTRAINT "patients_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patients" ADD CONSTRAINT "patients_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patients" ADD CONSTRAINT "patients_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_payrun_items" ADD CONSTRAINT "payroll_payrun_items_payrun_id_payroll_payruns_id_fk" FOREIGN KEY ("payrun_id") REFERENCES "public"."payroll_payruns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_payrun_items" ADD CONSTRAINT "payroll_payrun_items_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_payruns" ADD CONSTRAINT "payroll_payruns_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_payruns" ADD CONSTRAINT "payroll_payruns_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_payruns" ADD CONSTRAINT "payroll_payruns_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pricing_audit_log" ADD CONSTRAINT "pricing_audit_log_profile_id_pricing_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."pricing_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pricing_audit_log" ADD CONSTRAINT "pricing_audit_log_changed_by_users_id_fk" FOREIGN KEY ("changed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pricing_profiles" ADD CONSTRAINT "pricing_profiles_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pricing_profiles" ADD CONSTRAINT "pricing_profiles_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pricing_rules" ADD CONSTRAINT "pricing_rules_profile_id_pricing_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."pricing_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pricing_rules" ADD CONSTRAINT "pricing_rules_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quarterly_ranking_entries" ADD CONSTRAINT "quarterly_ranking_entries_ranking_id_quarterly_rankings_id_fk" FOREIGN KEY ("ranking_id") REFERENCES "public"."quarterly_rankings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quarterly_ranking_entries" ADD CONSTRAINT "quarterly_ranking_entries_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_pricing_overrides" ADD CONSTRAINT "recurring_pricing_overrides_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_pricing_overrides" ADD CONSTRAINT "recurring_pricing_overrides_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_pricing_overrides" ADD CONSTRAINT "recurring_pricing_overrides_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_pricing_overrides" ADD CONSTRAINT "recurring_pricing_overrides_schedule_id_recurring_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."recurring_schedules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_schedules" ADD CONSTRAINT "recurring_schedules_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_schedules" ADD CONSTRAINT "recurring_schedules_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "route_batches" ADD CONSTRAINT "route_batches_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "route_batches" ADD CONSTRAINT "route_batches_driver_assigned_drivers_id_fk" FOREIGN KEY ("driver_assigned") REFERENCES "public"."drivers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_change_requests" ADD CONSTRAINT "schedule_change_requests_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_change_requests" ADD CONSTRAINT "schedule_change_requests_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_change_requests" ADD CONSTRAINT "schedule_change_requests_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_change_requests" ADD CONSTRAINT "schedule_change_requests_dispatcher_user_id_users_id_fk" FOREIGN KEY ("dispatcher_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_revocations" ADD CONSTRAINT "session_revocations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_revocations" ADD CONSTRAINT "session_revocations_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_revocations" ADD CONSTRAINT "session_revocations_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "substitute_pool" ADD CONSTRAINT "substitute_pool_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "substitute_pool" ADD CONSTRAINT "substitute_pool_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "substitute_pool" ADD CONSTRAINT "substitute_pool_added_by_users_id_fk" FOREIGN KEY ("added_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sunday_roster_drivers" ADD CONSTRAINT "sunday_roster_drivers_roster_id_sunday_rosters_id_fk" FOREIGN KEY ("roster_id") REFERENCES "public"."sunday_rosters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sunday_roster_drivers" ADD CONSTRAINT "sunday_roster_drivers_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sunday_rosters" ADD CONSTRAINT "sunday_rosters_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sunday_rosters" ADD CONSTRAINT "sunday_rosters_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_messages" ADD CONSTRAINT "support_messages_thread_id_support_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."support_threads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_messages" ADD CONSTRAINT "support_messages_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_messages" ADD CONSTRAINT "support_messages_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_messages" ADD CONSTRAINT "support_messages_sender_user_id_users_id_fk" FOREIGN KEY ("sender_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_threads" ADD CONSTRAINT "support_threads_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_threads" ADD CONSTRAINT "support_threads_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "system_events" ADD CONSTRAINT "system_events_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "system_events" ADD CONSTRAINT "system_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_import_batches" ADD CONSTRAINT "time_import_batches_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_import_batches" ADD CONSTRAINT "time_import_batches_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tp_payroll_items" ADD CONSTRAINT "tp_payroll_items_run_id_tp_payroll_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."tp_payroll_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tp_payroll_items" ADD CONSTRAINT "tp_payroll_items_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tp_payroll_items" ADD CONSTRAINT "tp_payroll_items_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tp_payroll_runs" ADD CONSTRAINT "tp_payroll_runs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tp_payroll_runs" ADD CONSTRAINT "tp_payroll_runs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tri_scores" ADD CONSTRAINT "tri_scores_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tri_scores" ADD CONSTRAINT "tri_scores_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_billing" ADD CONSTRAINT "trip_billing_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_billing" ADD CONSTRAINT "trip_billing_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_billing" ADD CONSTRAINT "trip_billing_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_billing" ADD CONSTRAINT "trip_billing_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_billing" ADD CONSTRAINT "trip_billing_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_billing" ADD CONSTRAINT "trip_billing_tariff_id_clinic_tariffs_id_fk" FOREIGN KEY ("tariff_id") REFERENCES "public"."clinic_tariffs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_events" ADD CONSTRAINT "trip_events_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_events" ADD CONSTRAINT "trip_events_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_messages" ADD CONSTRAINT "trip_messages_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_messages" ADD CONSTRAINT "trip_messages_sender_id_users_id_fk" FOREIGN KEY ("sender_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_pdfs" ADD CONSTRAINT "trip_pdfs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_pdfs" ADD CONSTRAINT "trip_pdfs_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_pdfs" ADD CONSTRAINT "trip_pdfs_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_series" ADD CONSTRAINT "trip_series_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_series" ADD CONSTRAINT "trip_series_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_series" ADD CONSTRAINT "trip_series_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_series" ADD CONSTRAINT "trip_series_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_share_tokens" ADD CONSTRAINT "trip_share_tokens_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_signatures" ADD CONSTRAINT "trip_signatures_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_sms_log" ADD CONSTRAINT "trip_sms_log_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ucm_certifications" ADD CONSTRAINT "ucm_certifications_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ucm_certifications" ADD CONSTRAINT "ucm_certifications_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ucm_certifications" ADD CONSTRAINT "ucm_certifications_certified_by_users_id_fk" FOREIGN KEY ("certified_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_city_access" ADD CONSTRAINT "user_city_access_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_city_access" ADD CONSTRAINT "user_city_access_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_assignment_history" ADD CONSTRAINT "vehicle_assignment_history_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_assignment_history" ADD CONSTRAINT "vehicle_assignment_history_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_assignment_history" ADD CONSTRAINT "vehicle_assignment_history_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_models" ADD CONSTRAINT "vehicle_models_make_id_vehicle_makes_id_fk" FOREIGN KEY ("make_id") REFERENCES "public"."vehicle_makes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_make_id_vehicle_makes_id_fk" FOREIGN KEY ("make_id") REFERENCES "public"."vehicle_makes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_model_id_vehicle_models_id_fk" FOREIGN KEY ("model_id") REFERENCES "public"."vehicle_models"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weekly_score_snapshots" ADD CONSTRAINT "weekly_score_snapshots_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weekly_score_snapshots" ADD CONSTRAINT "weekly_score_snapshots_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weekly_score_snapshots" ADD CONSTRAINT "weekly_score_snapshots_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_engine_snapshots_computed_idx" ON "ai_engine_snapshots" USING btree ("computed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "audit_snap_idx" ON "audit_readiness_snapshots" USING btree ("clinic_id","snapshot_date");--> statement-breakpoint
CREATE UNIQUE INDEX "bcii_invoice_trip_idx" ON "billing_cycle_invoice_items" USING btree ("invoice_id","trip_id");--> statement-breakpoint
CREATE INDEX "bcii_trip_idx" ON "billing_cycle_invoice_items" USING btree ("trip_id");--> statement-breakpoint
CREATE INDEX "bci_clinic_period_idx" ON "billing_cycle_invoices" USING btree ("clinic_id","period_start","period_end","status");--> statement-breakpoint
CREATE INDEX "bci_payment_status_idx" ON "billing_cycle_invoices" USING btree ("payment_status","due_date");--> statement-breakpoint
CREATE INDEX "bci_company_idx" ON "billing_cycle_invoices" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX "cbi_clinic_week_idx" ON "clinic_billing_invoices" USING btree ("clinic_id","city_id","week_start");--> statement-breakpoint
CREATE UNIQUE INDEX "cbp_clinic_city_idx" ON "clinic_billing_profiles" USING btree ("clinic_id","city_id");--> statement-breakpoint
CREATE UNIQUE INDEX "cbr_profile_rule_idx" ON "clinic_billing_rules" USING btree ("profile_id","outcome","passenger_count","leg_type","cancel_window");--> statement-breakpoint
CREATE UNIQUE INDEX "clinic_cert_quarter_idx" ON "clinic_certifications" USING btree ("clinic_id","quarter_key");--> statement-breakpoint
CREATE UNIQUE INDEX "cqrm_unique_idx" ON "clinic_quarterly_report_metrics" USING btree ("report_id","metric_key");--> statement-breakpoint
CREATE UNIQUE INDEX "cqr_unique_idx" ON "clinic_quarterly_reports" USING btree ("clinic_id","quarter_key");--> statement-breakpoint
CREATE INDEX "ct_company_clinic_active_idx" ON "clinic_tariffs" USING btree ("company_id","clinic_id","active");--> statement-breakpoint
CREATE INDEX "cla_status_sev_idx" ON "cost_leak_alerts" USING btree ("status","severity","created_at");--> statement-breakpoint
CREATE INDEX "cla_city_date_idx" ON "cost_leak_alerts" USING btree ("city_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "dmr_unique_idx" ON "daily_metrics_rollup" USING btree ("metric_date","city_id","clinic_id","driver_id");--> statement-breakpoint
CREATE INDEX "dmr_city_date_idx" ON "daily_metrics_rollup" USING btree ("city_id","metric_date");--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_trip_driver_type_idx" ON "driver_earnings_ledger" USING btree ("company_id","driver_id","trip_id","earning_type");--> statement-breakpoint
CREATE INDEX "ledger_company_driver_status_idx" ON "driver_earnings_ledger" USING btree ("company_id","driver_id","status");--> statement-breakpoint
CREATE INDEX "ledger_eligible_at_idx" ON "driver_earnings_ledger" USING btree ("eligible_at");--> statement-breakpoint
CREATE INDEX "dps_company_idx" ON "driver_perf_scores" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "dps_driver_idx" ON "driver_perf_scores" USING btree ("driver_id");--> statement-breakpoint
CREATE UNIQUE INDEX "dps_company_driver_window_uniq" ON "driver_perf_scores" USING btree ("company_id","driver_id","window");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_push_tokens_unique" ON "driver_push_tokens" USING btree ("driver_id","token");--> statement-breakpoint
CREATE INDEX "idx_swap_target_status" ON "driver_shift_swap_requests" USING btree ("target_driver_id","status");--> statement-breakpoint
CREATE INDEX "idx_swap_requester_created" ON "driver_shift_swap_requests" USING btree ("requester_driver_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_swap_company_status" ON "driver_shift_swap_requests" USING btree ("company_id","status");--> statement-breakpoint
CREATE INDEX "idx_swap_shift_date" ON "driver_shift_swap_requests" USING btree ("shift_date");--> statement-breakpoint
CREATE UNIQUE INDEX "driver_stripe_company_driver_idx" ON "driver_stripe_accounts" USING btree ("company_id","driver_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ext_id_map_unique_idx" ON "external_id_map" USING btree ("company_id","entity","source_system","external_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pub_target_unique_idx" ON "intelligence_publication_targets" USING btree ("publication_id","target_type","clinic_id");--> statement-breakpoint
CREATE INDEX "ip_invoice_paid_idx" ON "invoice_payments" USING btree ("invoice_id","paid_at");--> statement-breakpoint
CREATE INDEX "jobs_status_priority_idx" ON "jobs" USING btree ("status","priority","created_at");--> statement-breakpoint
CREATE INDEX "jobs_company_type_idx" ON "jobs" USING btree ("company_id","type");--> statement-breakpoint
CREATE INDEX "jobs_type_status_idx" ON "jobs" USING btree ("type","status");--> statement-breakpoint
CREATE INDEX "opsanom_company_idx" ON "ops_anomalies" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "opsanom_active_idx" ON "ops_anomalies" USING btree ("company_id","is_active");--> statement-breakpoint
CREATE INDEX "opsanom_entity_idx" ON "ops_anomalies" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payrun_item_driver_idx" ON "payroll_payrun_items" USING btree ("payrun_id","driver_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pricing_rules_profile_key_idx" ON "pricing_rules" USING btree ("profile_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX "qre_unique_idx" ON "quarterly_ranking_entries" USING btree ("ranking_id","clinic_id");--> statement-breakpoint
CREATE UNIQUE INDEX "qr_scope_idx" ON "quarterly_rankings" USING btree ("quarter_key","scope","state","city","metric_key");--> statement-breakpoint
CREATE UNIQUE INDEX "rpo_unique_idx" ON "recurring_pricing_overrides" USING btree ("company_id","clinic_id","patient_id","schedule_id","effective_from");--> statement-breakpoint
CREATE UNIQUE INDEX "rc_key_hash_idx" ON "route_cache" USING btree ("key_hash");--> statement-breakpoint
CREATE INDEX "rc_expires_idx" ON "route_cache" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "idx_scr_status_created" ON "schedule_change_requests" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "idx_scr_driver_created" ON "schedule_change_requests" USING btree ("driver_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_scr_company_status" ON "schedule_change_requests" USING btree ("company_id","status");--> statement-breakpoint
CREATE INDEX "sm_thread_idx" ON "support_messages" USING btree ("thread_id");--> statement-breakpoint
CREATE INDEX "st_company_status_idx" ON "support_threads" USING btree ("company_id","status");--> statement-breakpoint
CREATE INDEX "st_clinic_idx" ON "support_threads" USING btree ("clinic_id");--> statement-breakpoint
CREATE INDEX "sysevt_company_type_idx" ON "system_events" USING btree ("company_id","event_type","created_at");--> statement-breakpoint
CREATE INDEX "sysevt_entity_idx" ON "system_events" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "te_company_driver_date_src_ref_idx" ON "time_entries" USING btree ("company_id","driver_id","work_date","source_type","source_ref");--> statement-breakpoint
CREATE INDEX "te_company_status_idx" ON "time_entries" USING btree ("company_id","status");--> statement-breakpoint
CREATE INDEX "te_driver_date_idx" ON "time_entries" USING btree ("driver_id","work_date");--> statement-breakpoint
CREATE INDEX "tib_company_idx" ON "time_import_batches" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tpi_run_driver_idx" ON "tp_payroll_items" USING btree ("run_id","driver_id");--> statement-breakpoint
CREATE INDEX "tpi_company_idx" ON "tp_payroll_items" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "tpr_company_status_idx" ON "tp_payroll_runs" USING btree ("company_id","status");--> statement-breakpoint
CREATE INDEX "tri_period_city_idx" ON "tri_scores" USING btree ("period_start","city_id","clinic_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tb_trip_patient_idx" ON "trip_billing" USING btree ("trip_id","patient_id");--> statement-breakpoint
CREATE INDEX "tb_company_clinic_idx" ON "trip_billing" USING btree ("company_id","clinic_id");--> statement-breakpoint
CREATE INDEX "tb_service_date_idx" ON "trip_billing" USING btree ("service_date");--> statement-breakpoint
CREATE INDEX "trip_pdfs_trip_idx" ON "trip_pdfs" USING btree ("trip_id");--> statement-breakpoint
CREATE INDEX "trip_pdfs_company_idx" ON "trip_pdfs" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "trip_pdfs_created_idx" ON "trip_pdfs" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "trip_sms_log_trip_kind_unique" ON "trip_sms_log" USING btree ("trip_id","kind");--> statement-breakpoint
CREATE UNIQUE INDEX "ucm_cert_unique_idx" ON "ucm_certifications" USING btree ("city_id","clinic_id");--> statement-breakpoint
CREATE UNIQUE INDEX "wss_unique_idx" ON "weekly_score_snapshots" USING btree ("week_start","city_id","clinic_id","driver_id");--> statement-breakpoint
CREATE INDEX "wss_city_week_idx" ON "weekly_score_snapshots" USING btree ("city_id","week_start");