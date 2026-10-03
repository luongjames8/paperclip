ALTER TABLE "routines" ADD COLUMN IF NOT EXISTS "approval_kind" text;
--> statement-breakpoint
ALTER TABLE "issues" ADD COLUMN IF NOT EXISTS "approval_kind" text;
--> statement-breakpoint
ALTER TABLE "approvals" ADD COLUMN IF NOT EXISTS "approval_kind" text;
