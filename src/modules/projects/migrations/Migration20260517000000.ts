import { Migration } from '@mikro-orm/migrations'

export class Migration20260517000000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      create table "projects" (
        "id" uuid not null default gen_random_uuid(),
        "organization_id" uuid not null,
        "tenant_id" uuid not null,
        "title" text not null,
        "description" text null,
        "status" text not null default 'active',
        "deal_id" uuid null,
        "owner_user_id" uuid null,
        "started_at" timestamptz null,
        "expected_close_at" timestamptz null,
        "completed_at" timestamptz null,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "deleted_at" timestamptz null,
        constraint "projects_pkey" primary key ("id")
      );
    `)
    this.addSql(`create index "projects_scope_idx" on "projects" ("tenant_id", "organization_id") where "deleted_at" is null;`)
    this.addSql(`create index "projects_status_idx" on "projects" ("tenant_id", "organization_id", "status") where "deleted_at" is null;`)
    this.addSql(`create index "projects_deal_idx" on "projects" ("deal_id") where "deleted_at" is null;`)
    this.addSql(`create unique index "projects_deal_unique" on "projects" ("tenant_id", "deal_id") where "deal_id" is not null and "deleted_at" is null;`)

    this.addSql(`
      create table "project_tasks" (
        "id" uuid not null default gen_random_uuid(),
        "project_id" uuid not null,
        "organization_id" uuid not null,
        "tenant_id" uuid not null,
        "title" text not null,
        "description" text null,
        "status" text not null default 'backlog',
        "assignee_user_id" uuid null,
        "position" integer not null default 0,
        "due_at" timestamptz null,
        "completed_at" timestamptz null,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "deleted_at" timestamptz null,
        constraint "project_tasks_pkey" primary key ("id"),
        constraint "project_tasks_project_fk" foreign key ("project_id") references "projects" ("id") on delete cascade
      );
    `)
    this.addSql(`create index "project_tasks_board_idx" on "project_tasks" ("project_id", "status", "position") where "deleted_at" is null;`)
    this.addSql(`create index "project_tasks_scope_idx" on "project_tasks" ("tenant_id", "organization_id") where "deleted_at" is null;`)
    this.addSql(`create index "project_tasks_assignee_idx" on "project_tasks" ("assignee_user_id") where "deleted_at" is null;`)
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "project_tasks" cascade;`)
    this.addSql(`drop table if exists "projects" cascade;`)
  }
}
