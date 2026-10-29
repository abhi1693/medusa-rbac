import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20261029212120 extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `alter table if exists "rbac_role_assignment" drop constraint if exists "rbac_role_assignment_staff_id_role_id_unique";`
    )
    this.addSql(
      `alter table if exists "rbac_staff_access" drop constraint if exists "rbac_staff_access_user_id_unique";`
    )
    this.addSql(
      `alter table if exists "rbac_invitation_role" drop constraint if exists "rbac_invitation_role_invitation_id_role_id_unique";`
    )
    this.addSql(
      `alter table if exists "rbac_invitation_access" drop constraint if exists "rbac_invitation_access_invite_id_unique";`
    )
    this.addSql(
      `alter table if exists "rbac_access_role" drop constraint if exists "rbac_access_role_key_unique";`
    )
    this.addSql(
      `create table if not exists "rbac_access_audit" ("id" text not null, "actor_id" text not null, "action" text not null, "target_id" text not null, "detail" jsonb not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "rbac_access_audit_pkey" primary key ("id"));`
    )
    this.addSql(
      `CREATE INDEX IF NOT EXISTS "IDX_rbac_access_audit_deleted_at" ON "rbac_access_audit" ("deleted_at") WHERE deleted_at IS NULL;`
    )

    this.addSql(
      `create table if not exists "rbac_access_role" ("id" text not null, "key" text not null, "name" text not null, "permissions" jsonb not null, "rules" jsonb not null default '[]', "is_superuser" boolean not null default false, "version" integer not null default 1, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "rbac_access_role_pkey" primary key ("id"));`
    )
    this.addSql(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_rbac_access_role_key_unique" ON "rbac_access_role" ("key") WHERE deleted_at IS NULL;`
    )
    this.addSql(
      `CREATE INDEX IF NOT EXISTS "IDX_rbac_access_role_deleted_at" ON "rbac_access_role" ("deleted_at") WHERE deleted_at IS NULL;`
    )

    this.addSql(
      `create table if not exists "rbac_invitation_access" ("id" text not null, "invite_id" text not null, "email" text not null, "actor_id" text not null, "user_id" text null, "status" text check ("status" in ('pending', 'accepted', 'cancelled')) not null default 'pending', "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "rbac_invitation_access_pkey" primary key ("id"));`
    )
    this.addSql(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_rbac_invitation_access_invite_id_unique" ON "rbac_invitation_access" ("invite_id") WHERE deleted_at IS NULL;`
    )
    this.addSql(
      `CREATE INDEX IF NOT EXISTS "IDX_rbac_invitation_access_deleted_at" ON "rbac_invitation_access" ("deleted_at") WHERE deleted_at IS NULL;`
    )

    this.addSql(
      `create table if not exists "rbac_invitation_role" ("id" text not null, "invitation_id" text not null, "role_id" text not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "rbac_invitation_role_pkey" primary key ("id"));`
    )
    this.addSql(
      `CREATE INDEX IF NOT EXISTS "IDX_rbac_invitation_role_invitation_id" ON "rbac_invitation_role" ("invitation_id") WHERE deleted_at IS NULL;`
    )
    this.addSql(
      `CREATE INDEX IF NOT EXISTS "IDX_rbac_invitation_role_role_id" ON "rbac_invitation_role" ("role_id") WHERE deleted_at IS NULL;`
    )
    this.addSql(
      `CREATE INDEX IF NOT EXISTS "IDX_rbac_invitation_role_deleted_at" ON "rbac_invitation_role" ("deleted_at") WHERE deleted_at IS NULL;`
    )
    this.addSql(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_rbac_invitation_role_invitation_id_role_id_unique" ON "rbac_invitation_role" ("invitation_id", "role_id") WHERE deleted_at IS NULL;`
    )

    this.addSql(
      `create table if not exists "rbac_staff_access" ("id" text not null, "user_id" text not null, "active" boolean not null default true, "version" integer not null default 1, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "rbac_staff_access_pkey" primary key ("id"));`
    )
    this.addSql(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_rbac_staff_access_user_id_unique" ON "rbac_staff_access" ("user_id") WHERE deleted_at IS NULL;`
    )
    this.addSql(
      `CREATE INDEX IF NOT EXISTS "IDX_rbac_staff_access_deleted_at" ON "rbac_staff_access" ("deleted_at") WHERE deleted_at IS NULL;`
    )

    this.addSql(
      `create table if not exists "rbac_role_assignment" ("id" text not null, "staff_id" text not null, "role_id" text not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "rbac_role_assignment_pkey" primary key ("id"));`
    )
    this.addSql(
      `CREATE INDEX IF NOT EXISTS "IDX_rbac_role_assignment_staff_id" ON "rbac_role_assignment" ("staff_id") WHERE deleted_at IS NULL;`
    )
    this.addSql(
      `CREATE INDEX IF NOT EXISTS "IDX_rbac_role_assignment_role_id" ON "rbac_role_assignment" ("role_id") WHERE deleted_at IS NULL;`
    )
    this.addSql(
      `CREATE INDEX IF NOT EXISTS "IDX_rbac_role_assignment_deleted_at" ON "rbac_role_assignment" ("deleted_at") WHERE deleted_at IS NULL;`
    )
    this.addSql(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_rbac_role_assignment_staff_id_role_id_unique" ON "rbac_role_assignment" ("staff_id", "role_id") WHERE deleted_at IS NULL;`
    )

    this.addSql(
      `alter table if exists "rbac_invitation_role" add constraint "rbac_invitation_role_invitation_id_foreign" foreign key ("invitation_id") references "rbac_invitation_access" ("id") on update cascade;`
    )
    this.addSql(
      `alter table if exists "rbac_invitation_role" add constraint "rbac_invitation_role_role_id_foreign" foreign key ("role_id") references "rbac_access_role" ("id") on update cascade;`
    )

    this.addSql(
      `alter table if exists "rbac_role_assignment" add constraint "rbac_role_assignment_staff_id_foreign" foreign key ("staff_id") references "rbac_staff_access" ("id") on update cascade;`
    )
    this.addSql(
      `alter table if exists "rbac_role_assignment" add constraint "rbac_role_assignment_role_id_foreign" foreign key ("role_id") references "rbac_access_role" ("id") on update cascade;`
    )
  }

  override async down(): Promise<void> {
    this.addSql(
      `alter table if exists "rbac_invitation_role" drop constraint if exists "rbac_invitation_role_role_id_foreign";`
    )

    this.addSql(
      `alter table if exists "rbac_role_assignment" drop constraint if exists "rbac_role_assignment_role_id_foreign";`
    )

    this.addSql(
      `alter table if exists "rbac_invitation_role" drop constraint if exists "rbac_invitation_role_invitation_id_foreign";`
    )

    this.addSql(
      `alter table if exists "rbac_role_assignment" drop constraint if exists "rbac_role_assignment_staff_id_foreign";`
    )

    this.addSql(`drop table if exists "rbac_access_audit" cascade;`)

    this.addSql(`drop table if exists "rbac_access_role" cascade;`)

    this.addSql(`drop table if exists "rbac_invitation_access" cascade;`)

    this.addSql(`drop table if exists "rbac_invitation_role" cascade;`)

    this.addSql(`drop table if exists "rbac_staff_access" cascade;`)

    this.addSql(`drop table if exists "rbac_role_assignment" cascade;`)
  }
}
