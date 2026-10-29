import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20261029175933 extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `alter table if exists "rbac_invitation_role" drop constraint if exists "rbac_invitation_role_invitation_id_role_id_unique";`
    )
    this.addSql(
      `alter table if exists "rbac_invitation_access" drop constraint if exists "rbac_invitation_access_invite_id_unique";`
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
      `alter table if exists "rbac_invitation_role" add constraint "rbac_invitation_role_invitation_id_foreign" foreign key ("invitation_id") references "rbac_invitation_access" ("id") on update cascade;`
    )
    this.addSql(
      `alter table if exists "rbac_invitation_role" add constraint "rbac_invitation_role_role_id_foreign" foreign key ("role_id") references "rbac_access_role" ("id") on update cascade;`
    )
  }

  override async down(): Promise<void> {
    this.addSql(
      `alter table if exists "rbac_invitation_role" drop constraint if exists "rbac_invitation_role_invitation_id_foreign";`
    )

    this.addSql(`drop table if exists "rbac_invitation_access" cascade;`)

    this.addSql(`drop table if exists "rbac_invitation_role" cascade;`)
  }
}
