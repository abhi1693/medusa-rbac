import assert from "node:assert/strict"
import type {
  ExecArgs,
  IUserModuleService,
  ICustomerModuleService,
} from "@medusajs/framework/types"
import { Modules, ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { ACCESS_CONTROL } from "../../src/modules/access-control"
import type AccessControlService from "../../src/modules/access-control/service"
import { createAccessConfig } from "../../src/lib/access/config"
import type { RoleDefinition } from "../../src/lib/access/roles"
import { createAccessInviteWorkflow } from "@abhi1693/medusa-rbac/workflows"

export default async function verifyActors({ container }: ExecArgs) {
  const database = new URL(process.env.DATABASE_URL || "")
  assert.equal(process.env.NODE_ENV, "test")
  assert.equal(process.env.RBAC_MODULE_TEST, "1")
  assert.match(database.pathname, /^\/rbac_plugin_[a-f0-9]{16}_test$/)
  const users = container.resolve<IUserModuleService>(Modules.USER)
  const customers = container.resolve<ICustomerModuleService>(Modules.CUSTOMER)
  const access = container.resolve<AccessControlService>(ACCESS_CONTROL)
  const db = container.resolve(ContainerRegistrationKeys.PG_CONNECTION)
  const definition = {
    key: "catalog-reader",
    name: "Configured catalog reader",
    permissions: ["products.view"],
    rules: [
      {
        permission: "store.documents.read",
        effect: "allow" as const,
        conditions: { actor_type: "customer" },
      },
    ],
  }
  const configure = (roles: RoleDefinition[]) =>
    Object.assign(access, {
      accessConfig_: createAccessConfig({
        permissions: [
          ["store.documents.read", "Read account documents", "Storefront"],
        ],
        roles,
      }),
    })
  configure([definition])
  const user = await users.createUsers({ email: "rbac-superuser@example.test" })
  await access.bootstrap(user.id)
  const { roles } = await access.snapshot()
  assert.equal(roles.length, 2)
  assert.equal(roles[0].name, "Superuser")
  const configuredRole = roles.find((role) => role.source === "configuration")!
  assert.ok(configuredRole)
  assert.deepEqual((await access.principal(user.id)).role_ids, [roles[0].id])
  const customer = await customers.createCustomers({
    email: "rbac-customer@example.test",
  })
  const { result } = await access.mutate(user.id, {
    kind: "create_role",
    name: "Account documents",
    permissions: [],
    rules: [
      {
        permission: "store.documents.read",
        effect: "allow",
        conditions: { actor_type: "customer" },
      },
    ],
  })
  const role = result as { id: string }
  await access.mutate(user.id, {
    kind: "set_actor",
    actor: { type: "customer", id: customer.id },
    role_ids: [role.id],
    active: true,
    version: 0,
  })
  const request = {
    auth_context: { actor_type: "customer", actor_id: customer.id },
    scope: container,
    originalUrl: "/store/documents",
    method: "GET",
  } as any
  const principal = (await access.principalForRequest(request))!
  assert.equal(principal.actor_type, "customer")
  assert.equal(
    access.allows(
      principal,
      "store.documents.read",
      await access.permissionContext(request)
    ),
    true
  )
  assert.equal(
    (await access.actorPrincipal({ type: "user", id: customer.id })).active,
    false
  )
  const saved = await access.actorAccess({ type: "customer", id: customer.id })
  await assert.rejects(
    access.mutate(user.id, {
      kind: "set_actor",
      actor: { type: "customer", id: customer.id },
      role_ids: [role.id],
      active: true,
      version: 0,
    }),
    /reload/
  )
  await assert.rejects(
    db("rbac_actor_access").insert({
      id: "duplicate",
      actor_type: "customer",
      actor_id: customer.id,
      active: true,
      version: 1,
    }),
    /duplicate key/
  )
  await assert.rejects(
    access.mutate(user.id, {
      kind: "set_actor",
      actor: { type: "customer", id: customer.id },
      role_ids: [roles[0].id],
      active: true,
      version: saved.version,
    }),
    /only be assigned to admin/
  )
  await db("rbac_role_assignment").insert({
    id: "corrupt-system-grant",
    access_id: (saved as { id: string }).id,
    role_id: roles[0].id,
  })
  assert.equal(
    (await access.actorPrincipal({ type: "customer", id: customer.id }))
      .is_superuser,
    false
  )
  await assert.rejects(
    access.mutate(user.id, {
      kind: "set_staff",
      user_id: user.id,
      role_ids: [],
      active: false,
      version: 1,
    }),
    /At least one/
  )
  assert.equal((await access.principal(user.id)).is_superuser, true)
  await customers.deleteCustomers([customer.id])
  await assert.rejects(access.principalForRequest(request))
  assert.deepEqual(await access.syncConfiguredRoles(), {
    created: 0,
    updated: 0,
    revoked: 0,
  })
  assert.equal((await access.roleDetail(configuredRole.id)).role.version, 1)

  const additional = {
    key: "orders-reader",
    name: "Configured orders reader",
    permissions: ["orders.view"],
  }
  configure([definition, additional])
  const concurrent = await Promise.all([
    access.syncConfiguredRoles(),
    access.syncConfiguredRoles(),
  ])
  assert.equal(
    concurrent.reduce((sum, value) => sum + value.created, 0),
    1
  )

  const changed = { ...definition, permissions: ["orders.view"] }
  configure([changed, additional])
  await db.raw(
    "create function reject_configured_role_audit() returns trigger language plpgsql as $$ begin if NEW.action = 'sync_configured_role' then raise exception 'Synthetic configured role audit failure'; end if; return NEW; end $$"
  )
  await db.raw(
    "create trigger reject_configured_role_audit before insert on rbac_access_audit for each row execute function reject_configured_role_audit()"
  )
  try {
    await assert.rejects(
      access.syncConfiguredRoles(),
      /Synthetic configured role audit failure/
    )
    const persisted = await db("rbac_access_role")
      .where({ id: configuredRole.id })
      .first()
    assert.equal(persisted.version, 1)
    assert.deepEqual(persisted.permissions, ["products.view"])
  } finally {
    await db.raw(
      "drop trigger reject_configured_role_audit on rbac_access_audit"
    )
    await db.raw("drop function reject_configured_role_audit()")
  }
  assert.deepEqual(await access.syncConfiguredRoles(), {
    created: 0,
    updated: 1,
    revoked: 0,
  })
  const member = await users.createUsers({
    email: "rbac-configured-member@example.test",
  })
  const account = await customers.createCustomers({
    email: "rbac-configured-customer@example.test",
  })
  assert.equal(
    (await access.actorAccess({ type: "customer", id: account.id })).active,
    false
  )
  await access.mutate(user.id, {
    kind: "set_staff",
    user_id: member.id,
    role_ids: [configuredRole.id],
    active: true,
    version: 0,
  })
  await access.mutate(user.id, {
    kind: "set_actor",
    actor: { type: "customer", id: account.id },
    role_ids: [configuredRole.id],
    active: true,
    version: 0,
  })
  const memberPrincipal = await access.principal(member.id)
  const accountPrincipal = await access.actorPrincipal({
    type: "customer",
    id: account.id,
  })
  assert.equal(access.allows(memberPrincipal, "orders.view"), true)
  assert.equal(
    access.allows(accountPrincipal, "store.documents.read", {
      actor_type: "customer",
    }),
    true
  )
  assert.equal(
    access.allows(memberPrincipal, "store.documents.read", {
      actor_type: "user",
    }),
    false
  )
  assert.equal(
    (await access.actorPrincipal({ type: "user", id: account.id })).active,
    false
  )
  const { result: configuredInvite } = await createAccessInviteWorkflow(
    container
  ).run({
    input: {
      actor_id: user.id,
      email: "rbac-configured-pending@example.test",
      role_ids: [configuredRole.id],
    },
  })
  assert.ok(configuredInvite.id)
  const detail = await access.roleDetail(configuredRole.id, {
    offset: 0,
    limit: 1,
  })
  assert.equal(detail.role.id, configuredRole.id)
  assert.equal(detail.role.version, 2)
  assert.equal(detail.actor_count, 2)
  assert.equal(detail.actors.length, 1)
  assert.equal(detail.pending_invitation_count, 1)
  const ordersRole = (await access.snapshot()).roles.find(
    (role) => role.key === "configured_orders-reader"
  )!
  assert.ok(ordersRole)
  const assignmentsBeforeRename = await db("rbac_role_assignment")
    .select("access_id", "role_id")
    .whereIn("role_id", [configuredRole.id, ordersRole.id])
    .orderBy("access_id")
    .orderBy("role_id")
  configure([
    { ...changed, name: additional.name },
    { ...additional, name: changed.name },
  ])
  assert.deepEqual(await access.syncConfiguredRoles(), {
    created: 0,
    updated: 2,
    revoked: 0,
  })
  const renamed = await access.roleDetail(configuredRole.id)
  const renamedOrders = await access.roleDetail(ordersRole.id)
  assert.equal(renamed.role.key, configuredRole.key)
  assert.equal(renamed.role.name, additional.name)
  assert.equal(renamed.role.version, 3)
  assert.equal(renamedOrders.role.key, ordersRole.key)
  assert.equal(renamedOrders.role.name, changed.name)
  assert.equal(renamed.actor_count, 2)
  assert.equal(renamed.pending_invitation_count, 1)
  assert.deepEqual(
    await db("rbac_role_assignment")
      .select("access_id", "role_id")
      .whereIn("role_id", [configuredRole.id, ordersRole.id])
      .orderBy("access_id")
      .orderBy("role_id"),
    assignmentsBeforeRename
  )
  assert.deepEqual((await access.principal(member.id)).role_ids, [
    configuredRole.id,
  ])
  assert.equal(
    access.allows(await access.principal(member.id), "orders.view"),
    true
  )
  for (const kind of ["update_role", "delete_role"] as const)
    await assert.rejects(
      access.mutate(user.id, {
        kind,
        id: configuredRole.id,
        version: 2,
        name: "Changed in Admin",
        permissions: [],
      }),
      /managed in application configuration/
    )

  const ordinary = (await access.snapshot()).roles.find(
    (role) => role.id === (result as { id: string }).id
  )!
  configure([
    { key: "collision", name: ordinary.name.toUpperCase(), permissions: [] },
  ])
  await assert.rejects(access.syncConfiguredRoles(), /conflicts/)
  assert.deepEqual(
    (await access.snapshot()).roles.find((role) => role.id === ordinary.id)
      ?.permissions,
    ordinary.permissions
  )
  configure([])
  const beforeSync = await access.principal(member.id)
  assert.deepEqual(beforeSync.permissions, [])
  assert.deepEqual(beforeSync.role_ids, [configuredRole.id])
  assert.equal(
    access.allows(
      await access.actorPrincipal({ type: "customer", id: account.id }),
      "store.documents.read",
      { actor_type: "customer" }
    ),
    false
  )
  assert.deepEqual(await access.syncConfiguredRoles(), {
    created: 0,
    updated: 0,
    revoked: 2,
  })
  const removed = await access.roleDetail(configuredRole.id)
  assert.equal(removed.role.id, configuredRole.id)
  assert.equal(removed.role.configuration_status, "removed")
  assert.equal(removed.role.version, 4)
  assert.deepEqual(removed.role.permissions, [])
  assert.equal(removed.actor_count, 2)
  assert.equal(removed.pending_invitation_count, 1)
  assert.deepEqual(await access.syncConfiguredRoles(), {
    created: 0,
    updated: 0,
    revoked: 0,
  })
  configure([
    {
      key: "optional-rule-fields",
      name: "Optional rule fields",
      rules: [
        {
          permission: "orders.view",
          effect: "allow",
          priority: undefined,
          conditions: undefined,
        },
      ],
    },
  ])
  assert.deepEqual(await access.syncConfiguredRoles(), {
    created: 1,
    updated: 0,
    revoked: 0,
  })
  const optionalFieldsRole = (await access.snapshot()).roles.find(
    (role) => role.key === "configured_optional-rule-fields"
  )!
  assert.ok(optionalFieldsRole)
  assert.deepEqual(optionalFieldsRole.rules, [
    { permission: "orders.view", effect: "allow" },
  ])
  assert.deepEqual(await access.syncConfiguredRoles(), {
    created: 0,
    updated: 0,
    revoked: 0,
  })
  assert.equal((await access.roleDetail(optionalFieldsRole.id)).role.version, 1)
  console.info(
    "PASS: native identities and actor isolation; code-role bootstrap, concurrent synchronization, audit rollback/retry, explicit grants, metadata, protected edits and live configuration removal"
  )
}
