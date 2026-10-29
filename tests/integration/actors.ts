import assert from "node:assert/strict"
import type {
  ExecArgs,
  IUserModuleService,
  ICustomerModuleService,
} from "@medusajs/framework/types"
import { Modules, ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { ACCESS_CONTROL } from "../../src/modules/access-control"
import type AccessControlService from "../../src/modules/access-control/service"

export default async function verifyActors({ container }: ExecArgs) {
  const database = new URL(process.env.DATABASE_URL || "")
  assert.equal(process.env.NODE_ENV, "test")
  assert.equal(process.env.RBAC_MODULE_TEST, "1")
  assert.match(database.pathname, /^\/rbac_plugin_[a-f0-9]{16}_test$/)
  const users = container.resolve<IUserModuleService>(Modules.USER)
  const customers = container.resolve<ICustomerModuleService>(Modules.CUSTOMER)
  const access = container.resolve<AccessControlService>(ACCESS_CONTROL)
  const db = container.resolve(ContainerRegistrationKeys.PG_CONNECTION)
  const user = await users.createUsers({ email: "rbac-superuser@example.test" })
  await access.bootstrap(user.id)
  const { roles } = await access.snapshot()
  assert.equal(roles.length, 1)
  assert.equal(roles[0].name, "Superuser")
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
  console.info(
    "PASS: native User/Customer identity validation, scoped actor grants, storefront rules, uniqueness, stale writes and Superuser isolation"
  )
}
