import {
  createAccessConfig,
  evaluatePermission,
} from "../../src/lib/access/config"
import { validatePermissions } from "../../src/lib/access/permissions"
import { it, expect, vi } from "vitest"
import { Modules } from "@medusajs/framework/utils"
import { enforceAdminAccess } from "../../src/api/middlewares/enforce-admin-access"
import { ACCESS_CONTROL } from "../../src/modules/access-control"
import { PERMISSION_IDS } from "../../src/lib/access/permissions"
import * as me from "../../src/api/admin/access/me/route"
import * as roles from "../../src/api/admin/access/roles/route"
import * as role from "../../src/api/admin/access/roles/[id]/route"
import * as staff from "../../src/api/admin/access/staff/route"
import * as person from "../../src/api/admin/access/staff/[id]/route"
import * as audit from "../../src/api/admin/access/audit/route"
import * as permissions from "../../src/api/admin/access/permissions/route"
import middlewares from "../../src/api/middlewares"

import { createPrincipal } from "../fixtures/access"
const principal = createPrincipal({ actor_id: "u" })
function harness(path = "/admin/products", method = "GET", body: unknown = {}) {
  const access = {
    configuration: createAccessConfig(),
    policyFor: createAccessConfig().policyFor,
    permissionContext: async () => ({}),
    allows: evaluatePermission,
    permissionDefinitions: () => createAccessConfig().permissions,
    validatePermissions,
    principal: vi.fn().mockResolvedValue(principal),
    listAccessRoles: vi.fn().mockResolvedValue([]),
    snapshot: vi.fn().mockResolvedValue({ roles: [], staff: [] }),
    mutate: vi.fn().mockResolvedValue({ result: {} }),
    auditPage: vi.fn().mockResolvedValue({ events: [] }),
  }
  const users = {
    retrieveUser: vi.fn().mockResolvedValue({ id: "u" }),
    listAndCountUsers: vi.fn(),
    listUsers: vi.fn().mockResolvedValue([]),
  }
  const req: any = {
    originalUrl: path,
    method,
    body,
    query: {},
    params: { id: "target" },
    auth_context: { actor_type: "user", actor_id: "u" },
    scope: {
      resolve: (key: string) => (key === ACCESS_CONTROL ? access : users),
    },
  }
  const res: any = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    redirect: vi.fn().mockReturnThis(),
    setHeader: vi.fn(),
  }
  const next = vi.fn()
  return {
    access,
    users,
    req,
    res,
    next,
    run: () => enforceAdminAccess(req, res, next),
  }
}
it("wires the native middleware and validation chain", () =>
  expect(middlewares).toBeDefined())
it("exposes configured actor types alongside the registered permission catalog", async () => {
  const h = harness()
  h.access.configuration = createAccessConfig({
    actors: [{ type: "vendor", validate: async () => {} }],
  })
  await permissions.GET(h.req, h.res)
  expect(h.res.json).toHaveBeenCalledWith(
    expect.objectContaining({ actor_types: ["user", "customer", "vendor"] })
  )
})
it("rejects ambiguous paths before any native service call", async () => {
  const h = harness("/admin//products")
  await h.run()
  expect(h.res.status).toHaveBeenCalledWith(403)
  expect(h.users.retrieveUser).not.toHaveBeenCalled()
})
it.each([
  ["/admin/invites/accept", "POST"],
  ["/admin/feature-flags", "GET"],
  ["/admin/feature-flags", "HEAD"],
])("preserves native public contract %s %s", async (path, method) => {
  const h = harness(path, method)
  delete h.req.auth_context
  await h.run()
  expect(h.next).toHaveBeenCalledWith()
  expect(h.users.retrieveUser).not.toHaveBeenCalled()
})
it.each([
  undefined,
  { actor_type: "customer", actor_id: "u" },
  { actor_type: "api-key", actor_id: "u" },
  { actor_type: "user" },
])("refuses non-staff principals", async (auth) => {
  const h = harness()
  h.req.auth_context = auth
  await h.run()
  expect(h.res.status).toHaveBeenCalledWith(401)
})
it("passes native user errors to Medusa and refuses deleted identities", async () => {
  const h = harness()
  const error = new Error("User not found")
  h.users.retrieveUser.mockRejectedValue(error)
  await h.run()
  expect(h.next).toHaveBeenCalledWith(error)
  expect(h.access.principal).not.toHaveBeenCalled()
})
it("allows only own safe profile fields without role assignments", async () => {
  const h = harness("/admin/users/u", "POST", { first_name: "Name" })
  await h.run()
  expect(h.next).toHaveBeenCalledWith()
  expect(h.req.query.fields).toBe("id,email,first_name,last_name,avatar_url")
  expect(h.access.principal).not.toHaveBeenCalled()
})
it.each([
  ["/admin/users/User_Target", "User_Target"],
  ["/ADMIN/USERS/User_Target/?fields=id", "User_Target"],
  ["/admin/users/User%5FTarget", "User_Target"],
  ["/admin/users/user%3Ftarget", "user%3Ftarget"],
])("delegates authorized native deletion safely: %s", async (path, target) => {
  const h = harness(path, "DELETE")
  await h.run()
  expect(h.res.redirect).toHaveBeenCalledWith(
    307,
    `/admin/access/staff/${target}`
  )
  expect(h.res.setHeader).toHaveBeenCalledWith("Cache-Control", "no-store")
  expect(h.next).not.toHaveBeenCalled()
  expect(h.access.mutate).not.toHaveBeenCalled()
})
it.each([
  "/admin/users/target/roles/role",
  "/admin/users/target/reset-password",
  "/admin/users/%2ftarget",
  "/admin/users/%252ftarget",
  "/admin/users//target",
])("never delegates unreviewed or ambiguous deletion: %s", async (path) => {
  const h = harness(path, "DELETE")
  await h.run()
  expect(h.res.status).toHaveBeenCalledWith(403)
  expect(h.res.redirect).not.toHaveBeenCalled()
  expect(h.next).not.toHaveBeenCalled()
})
it("denies native management before delegation for ordinary staff", async () => {
  for (const [method, path] of [
    ["DELETE", "/admin/users/target"],
    ["POST", "/admin/users/target"],
    ["POST", "/admin/users/target/reset-password"],
  ]) {
    const h = harness(path, method)
    h.access.principal.mockResolvedValue({ ...principal, is_superuser: false })
    await h.run()
    expect(h.res.status).toHaveBeenCalledWith(403)
    expect(h.res.redirect).not.toHaveBeenCalled()
    expect(h.next).not.toHaveBeenCalled()
  }
})
it.each(["GET", "HEAD"])(
  "bounds self context even for inactive staff (%s)",
  async (method) => {
    const h = harness("/admin/users/me", method)
    h.access.principal.mockResolvedValue({
      ...principal,
      active: false,
      permissions: [],
    })
    h.req.query.fields = "*"
    await h.run()
    expect(h.next).toHaveBeenCalledWith()
    expect(h.req.query.fields).toBe("id,email,first_name,last_name,avatar_url")
    expect(h.res.setHeader).toHaveBeenCalledWith("Cache-Control", "no-store")
  }
)
it("denies inactive business access and unknown operations", async () => {
  const h = harness()
  h.access.principal.mockResolvedValue({ ...principal, active: false })
  await h.run()
  expect(h.res.status).toHaveBeenCalledWith(403)
  const unknown = harness("/admin/unknown")
  await unknown.run()
  expect(unknown.res.status).toHaveBeenCalledWith(403)
  const denied = harness()
  denied.access.principal.mockResolvedValue({
    ...principal,
    is_superuser: false,
    permissions: [],
  })
  await denied.run()
  expect(denied.res.status).toHaveBeenCalledWith(403)
})
it("allows active staff personal layouts and gates shared saves with contextual settings access", async () => {
  const ordinary = { ...principal, is_superuser: false, permissions: [] }
  for (const [method, path, body] of [
    ["GET", "/admin/layouts/configurations", {}],
    ["HEAD", "/admin/layouts/product.details/configuration", {}],
    ["GET", "/admin/layouts/product.details/configuration", {}],
    ["DELETE", "/admin/layouts/product.details/configuration", {}],
    ["POST", "/admin/layouts/product.details/configuration", {}],
    [
      "POST",
      "/admin/layouts/product.details/configuration",
      { is_default: false },
    ],
  ] as const) {
    const h = harness(path, method, body)
    h.access.principal.mockResolvedValue(ordinary)
    await h.run()
    expect(h.next, `${method} ${path}`).toHaveBeenCalledWith()
  }
  const denied = harness(
    "/admin/layouts/product.details/configuration",
    "POST",
    {
      is_default: true,
    }
  )
  denied.access.principal.mockResolvedValue(ordinary)
  await denied.run()
  expect(denied.res.status).toHaveBeenCalledWith(403)
  expect(denied.next).not.toHaveBeenCalled()
  const allowed = harness(
    "/admin/layouts/product.details/configuration",
    "POST",
    {
      is_default: true,
    }
  )
  allowed.access.principal.mockResolvedValue({
    ...ordinary,
    permissions: ["settings.manage"],
  })
  await allowed.run()
  expect(allowed.next).toHaveBeenCalledWith()
  const contextDenied = harness(
    "/admin/layouts/product.details/configuration",
    "POST",
    {
      is_default: true,
    }
  )
  contextDenied.access.principal.mockResolvedValue({
    ...ordinary,
    permissions: ["settings.manage"],
    rules: [{ permission: "settings.manage", effect: "deny", conditions: {} }],
  })
  await contextDenied.run()
  expect(contextDenied.res.status).toHaveBeenCalledWith(403)
})
it("keeps layout scope validation, inactive users, unknown routes and field expansion fail closed", async () => {
  for (const body of [
    null,
    [],
    "body",
    1,
    ...["false", "true", 0, 1, null, [], {}].map((is_default) => ({
      is_default,
    })),
  ]) {
    const h = harness(
      "/admin/layouts/product.details/configuration",
      "POST",
      body
    )
    await h.run()
    expect(h.res.status, JSON.stringify(body)).toHaveBeenCalledWith(403)
    expect(h.next).not.toHaveBeenCalled()
  }
  for (const [path, method] of [
    ["/admin/layouts/product.details/configuration", "GET"],
    ["/admin/layouts/product.details/configuration", "POST"],
    ["/admin/layouts/product.details/configuration", "DELETE"],
  ]) {
    const h = harness(path, method)
    h.access.principal.mockResolvedValue({ ...principal, active: false })
    await h.run()
    expect(h.res.status).toHaveBeenCalledWith(403)
  }
  for (const [path, method] of [
    ["/admin/layouts", "GET"],
    ["/admin/layouts/configurations", "POST"],
    ["/admin/layouts/product.details/configuration", "PUT"],
    ["/admin/layouts/product.details/configuration/shared", "POST"],
  ]) {
    const h = harness(path, method)
    await h.run()
    expect(h.res.status).toHaveBeenCalledWith(403)
  }
  const selected = harness("/admin/layouts/configurations")
  selected.req.query.fields = "id,configuration,user_id"
  await selected.run()
  expect(selected.next).toHaveBeenCalledWith()
  const expanded = harness("/admin/layouts/configurations")
  expanded.req.query.fields = "*user.auth_identity"
  await expanded.run()
  expect(expanded.res.status).toHaveBeenCalledWith(403)
})
it.each(["GET", "HEAD"])("bounds read field selection (%s)", async (method) => {
  const h = harness("/admin/products", method)
  h.req.query.fields = "*"
  await h.run()
  expect(h.res.status).toHaveBeenCalledWith(403)
})
it.each(["GET", "HEAD"])(
  "allows the native Superuser product detail selection (%s)",
  async (method) => {
    const h = harness("/admin/products/prod_native", method)
    h.req.query.fields = "*categories,*shipping_profile,-variants"
    await h.run()
    expect(h.next).toHaveBeenCalledWith()
    expect(h.res.status).not.toHaveBeenCalled()
  }
)
it("retains product permissions and bounded relations for native product detail reads", async () => {
  const authorized = harness("/admin/products/prod_native")
  authorized.req.query.fields = "*categories,*shipping_profile,-variants"
  authorized.access.principal.mockResolvedValue(
    createPrincipal({
      is_superuser: false,
      permissions: ["products.view", "prices.view"],
    })
  )
  await authorized.run()
  expect(authorized.next).toHaveBeenCalledWith()
  const denied = harness("/admin/products/prod_native")
  denied.req.query.fields = "*categories,*shipping_profile,-variants"
  denied.access.principal.mockResolvedValue(
    createPrincipal({ is_superuser: false, permissions: ["products.view"] })
  )
  await denied.run()
  expect(denied.res.status).toHaveBeenCalledWith(403)
  for (const fields of [
    "*shipping_profile.shipping_options",
    "*unreviewed_relation",
    "*",
  ]) {
    const superuser = harness("/admin/products/prod_native")
    superuser.req.query.fields = fields
    await superuser.run()
    expect(superuser.res.status).toHaveBeenCalledWith(403)
    expect(superuser.res.json).toHaveBeenCalledWith({
      message: "This field selection is not allowed",
    })
    expect(superuser.next).not.toHaveBeenCalled()
  }
})
it("requires inventory permission for reviewed inventory expansions", async () => {
  const h = harness()
  h.req.query.fields = "variants.inventory_quantity"
  h.access.principal.mockResolvedValue({
    ...principal,
    is_superuser: false,
    permissions: ["products.view", "prices.view"],
  })
  await h.run()
  expect(h.res.status).toHaveBeenCalledWith(403)
  const ok = harness()
  ok.req.query.fields = "variants.inventory_quantity"
  await ok.run()
  expect(ok.next).toHaveBeenCalledWith()
})
it.each([
  [
    "GET",
    "/admin/products/prod_native/variants",
    "title,sku,thumbnail,*options,created_at,*inventory_items.inventory.location_levels,inventory_quantity,manage_inventory",
  ],
  [
    "HEAD",
    "/admin/products/prod_native/variants/variant_native",
    "*inventory_items,*inventory_items.inventory,*inventory_items.inventory.location_levels,*options,*options.option,*prices,*prices.price_rules,+images.id,+images.url,+images.variants.id",
  ],
])(
  "allows the reviewed native Variant read with inventory grants (%s %s)",
  async (method, path, fields) => {
    const superuser = harness(path, method)
    superuser.req.query.fields = fields
    await superuser.run()
    expect(superuser.next).toHaveBeenCalledWith()
    const authorized = harness(path, method)
    authorized.req.query.fields = fields
    authorized.access.principal.mockResolvedValue(
      createPrincipal({
        is_superuser: false,
        permissions: ["products.view", "prices.view", "inventory.view"],
      })
    )
    await authorized.run()
    expect(authorized.next).toHaveBeenCalledWith()
    const denied = harness(path, method)
    denied.req.query.fields = fields
    denied.access.principal.mockResolvedValue(
      createPrincipal({
        is_superuser: false,
        permissions: ["products.view", "prices.view"],
      })
    )
    await denied.run()
    expect(denied.res.status).toHaveBeenCalledWith(403)
    expect(denied.res.json).toHaveBeenCalledWith({
      message: "Inventory access is required for these fields",
    })
  }
)
it("rejects unreviewed Variant subrelations and does not grant Variant-only fields on Products", async () => {
  for (const [path, fields] of [
    [
      "/admin/products/prod_native/variants",
      "*inventory_items.inventory.secret",
    ],
    [
      "/admin/products/prod_native/variants/variant_native",
      "*inventory_items.*",
    ],
    [
      "/admin/products/prod_native/variants/variant_native",
      "*prices.price_rules.price_set",
    ],
    ["/admin/products/prod_native/variants/variant_native", "*"],
    ["/admin/products/prod_native", "*inventory_items"],
  ]) {
    const h = harness(path)
    h.req.query.fields = fields
    await h.run()
    expect(h.res.status).toHaveBeenCalledWith(403)
    expect(h.res.json).toHaveBeenCalledWith({
      message: "This field selection is not allowed",
    })
    expect(h.next).not.toHaveBeenCalled()
  }
})
it.each([
  ["POST", "/admin/products", { status: "published" }],
  ["POST", "/admin/products/p/variants", { prices: [] }],
  ["POST", "/admin/products/p", { status: "draft" }],
  ["POST", "/admin/product-variants/v", { allow_backorder: true }],
])("checks sensitive product writes %s %s", async (method, path, body) => {
  const h = harness(path, method, body)
  h.access.principal.mockResolvedValue({
    ...principal,
    is_superuser: false,
    permissions: ["products.create", "products.edit"],
  })
  await h.run()
  expect(h.res.status).toHaveBeenCalledWith(403)
})
it.each([
  ["POST", "/admin/products", { status: "draft" }],
  ["POST", "/admin/products/p/variants", { manage_inventory: true }],
  ["POST", "/admin/products/p", { title: "New" }],
  ["DELETE", "/admin/products/p", {}],
  ["POST", "/admin/collections", {}],
])("allows authorized writes %s %s", async (method, path, body) => {
  const h = harness(path, method, body)
  await h.run()
  expect(h.next).toHaveBeenCalledWith()
})
it("thin handlers use the access module and native users with validated inputs", async () => {
  const h = harness()
  await me.GET(h.req, h.res)
  expect(h.res.json).toHaveBeenLastCalledWith({
    access: principal,
    roles: [],
    permission_catalog: expect.any(Array),
  })
  await permissions.GET(h.req, h.res)
  expect(h.res.json.mock.calls.at(-1)[0].permissions).toHaveLength(
    PERMISSION_IDS.length
  )
  await roles.GET(h.req, h.res)
  expect(h.res.json).toHaveBeenLastCalledWith({ roles: [] })
  h.req.body = {
    name: " Reader ",
    permissions: ["products.view", "products.view"],
  }
  await roles.POST(h.req, h.res)
  expect(h.res.status).toHaveBeenCalledWith(201)
  expect(h.access.mutate).toHaveBeenLastCalledWith("u", {
    kind: "create_role",
    name: "Reader",
    permissions: ["products.view"],
    rules: undefined,
  })
  h.req.body.version = 1
  await role.POST(h.req, h.res)
  expect(h.access.mutate).toHaveBeenLastCalledWith("u", {
    kind: "update_role",
    id: "target",
    name: "Reader",
    permissions: ["products.view"],
    rules: undefined,
    version: 1,
  })
  h.req.body = { version: 1 }
  await role.DELETE(h.req, h.res)
  expect(h.access.mutate).toHaveBeenLastCalledWith("u", {
    kind: "delete_role",
    id: "target",
    version: 1,
  })
  h.req.body = { role_ids: ["reader"], active: true, version: 0 }
  await person.POST(h.req, h.res)
  expect(h.users.retrieveUser).toHaveBeenCalledWith("target")
  expect(h.access.mutate).toHaveBeenLastCalledWith("u", {
    kind: "set_staff",
    user_id: "target",
    ...h.req.body,
  })
  h.req.validatedQuery = { offset: 25, limit: 10 }
  await audit.GET(h.req, h.res)
  expect(h.access.auditPage).toHaveBeenCalledWith(25, 10)
})
it("staff pagination merges assigned users and treats new users as inactive", async () => {
  const h = harness()
  h.users.listAndCountUsers.mockResolvedValue([
    [{ id: "one" }, { id: "two" }],
    28,
  ])
  const assigned = {
    actor_id: "one",
    actor_type: "user",
    role_ids: ["r"],
    active: true,
    version: 1,
  }
  h.access.snapshot.mockResolvedValue({ roles: [], staff: [assigned] } as any)
  h.req.validatedQuery = { offset: 25, limit: 25 }
  await staff.GET(h.req, h.res)
  expect(h.users.listAndCountUsers).toHaveBeenCalledWith(
    {},
    { skip: 25, take: 25, select: ["id", "email", "first_name", "last_name"] }
  )
  expect(h.access.snapshot).toHaveBeenCalledWith(["one", "two"])
  expect(h.res.json).toHaveBeenCalledWith({
    staff: [
      { id: "one", roles: [], access: assigned },
      {
        id: "two",
        roles: [],
        access: { active: false, role_ids: [], version: 0 },
      },
    ],
    count: 28,
    offset: 25,
    limit: 25,
  })
})
it("validates payloads and native target existence before mutating", async () => {
  const h = harness()
  h.req.body = { name: "X", permissions: ["*"] }
  await expect(roles.POST(h.req, h.res)).rejects.toThrow()
  expect(h.access.mutate).not.toHaveBeenCalled()
  h.req.body = { role_ids: [], active: true, version: 0 }
  h.users.retrieveUser.mockRejectedValue(new Error("missing"))
  await expect(person.POST(h.req, h.res)).rejects.toThrow("missing")
  expect(h.access.mutate).not.toHaveBeenCalled()
})

it.each(["GET", "HEAD"])(
  "provides minimum store context to the native header (%s)",
  async (method) => {
    const h = harness("/admin/stores", method)
    h.req.query.fields = "*"
    h.access.principal.mockResolvedValue({
      ...principal,
      is_superuser: false,
      permissions: ["orders.view"],
    })
    await h.run()
    expect(h.req.query.fields).toBe("id,name")
    expect(h.next).toHaveBeenCalledWith()
  }
)
it("bounds inactive store context and retains authorized full settings reads", async () => {
  const inactive = harness("/admin/stores")
  inactive.access.principal.mockResolvedValue({ ...principal, active: false })
  await inactive.run()
  expect(inactive.req.query.fields).toBe("id,name")
  const owner = harness("/admin/stores")
  owner.req.query.fields = "id,name,metadata"
  await owner.run()
  expect(owner.req.query.fields).toBe("id,name,metadata")
  expect(owner.next).toHaveBeenCalledWith()
})

it.each([true, false])(
  "returns a single staff user's current assignments: %s",
  async (assigned) => {
    const h = harness()
    const access = {
      policyFor: createAccessConfig().policyFor,
      permissionContext: async () => ({}),
      allows: evaluatePermission,
      permissionDefinitions: () => createAccessConfig().permissions,
      validatePermissions,
      role_ids: ["reader"],
      active: true,
      version: 1,
    }
    h.access.snapshot.mockResolvedValue({
      roles: [],
      staff: assigned ? [access] : [],
    } as any)
    await person.GET(h.req, h.res)
    expect(h.access.snapshot).toHaveBeenCalledWith(["u"])
    expect(h.res.json).toHaveBeenCalledWith({
      staff: {
        id: "u",
        access: assigned ? access : { active: false, role_ids: [], version: 0 },
      },
    })
  }
)
it.each([
  ["/admin/access/invites", "POST"],
  ["/admin/access/invites/inv_test", "DELETE"],
  ["/admin/access/staff/target", "GET"],
  ["/admin/access/staff/target", "DELETE"],
])("checks authorization for user management %s %s", async (path, method) => {
  const h = harness(path, method)
  await h.run()
  expect(h.next).toHaveBeenCalledWith()
  const denied = harness(path, method)
  denied.access.principal.mockResolvedValue({
    ...principal,
    is_superuser: false,
    permissions: [],
  })
  await denied.run()
  expect(denied.res.status).toHaveBeenCalledWith(403)
})

it("returns only the signed-in user's role names and avoids unbounded empty-ID queries", async () => {
  const h = harness()
  h.access.listAccessRoles.mockResolvedValue([
    { id: "admin", name: "Superuser" },
  ] as any)
  await me.GET(h.req, h.res)
  expect(h.access.listAccessRoles).toHaveBeenCalledWith(
    { id: principal.role_ids },
    { select: ["id", "name"], take: principal.role_ids.length }
  )
  expect(h.res.json).toHaveBeenLastCalledWith({
    access: principal,
    roles: [{ id: "admin", name: "Superuser" }],
    permission_catalog: expect.any(Array),
  })
  h.access.principal.mockResolvedValue({ ...principal, role_ids: [] })
  h.access.listAccessRoles.mockClear()
  await me.GET(h.req, h.res)
  expect(h.access.listAccessRoles).not.toHaveBeenCalled()
})
it("searches native users and includes names of only their assigned roles", async () => {
  const h = harness()
  h.req.validatedQuery = { offset: 0, limit: 25, q: "test" }
  h.users.listAndCountUsers.mockResolvedValue([
    [{ id: "one" }, { id: "two" }],
    2,
  ])
  h.access.snapshot.mockResolvedValue({
    roles: [
      { id: "reader", name: "Reader" },
      { id: "other", name: "Other" },
    ],
    staff: [{ actor_id: "one", active: true, role_ids: ["reader"] }],
  } as any)
  await staff.GET(h.req, h.res)
  expect(h.users.listAndCountUsers.mock.calls[0][0]).toEqual({ q: "test" })
  const rows = h.res.json.mock.calls[0][0].staff
  expect(rows[0].roles).toEqual([{ id: "reader", name: "Reader" }])
  expect(rows[1].roles).toEqual([])
})
it("resolves audit participants including deleted users and historical role/invitation names", async () => {
  const h = harness()
  h.req.validatedQuery = { offset: 0, limit: 25 }
  const cases = [
    { target_id: "user", detail: null, expected: "deleted@example.test" },
    {
      target_id: "after",
      detail: { after: { name: "New name" } },
      expected: "New name",
    },
    {
      target_id: "before",
      detail: { before: { name: "Old name" } },
      expected: "Old name",
    },
    { target_id: "role", detail: {}, expected: "Role name" },
    {
      target_id: "invite-after",
      detail: { after: { email: "after@example.test" } },
      expected: "after@example.test",
    },
    {
      target_id: "invite-before",
      detail: { before: { email: "before@example.test" } },
      expected: "before@example.test",
    },
    { target_id: "gone", detail: null, expected: "Removed item" },
    { target_id: "undefined", detail: undefined, expected: "Removed item" },
  ]
  const events = cases.map((entry, i) => ({
    id: String(i),
    actor_id: i ? "missing" : "actor",
    target_id: entry.target_id,
    detail: entry.detail,
  }))
  h.access.auditPage.mockResolvedValue({ events } as any)
  h.users.listUsers.mockResolvedValue([
    { id: "actor", email: "actor@example.test" },
    { id: "user", email: "deleted@example.test" },
  ])
  h.access.listAccessRoles.mockResolvedValue([
    { id: "role", name: "Role name" },
  ] as any)
  await audit.GET(h.req, h.res)
  expect(h.users.listUsers.mock.calls[0][1]).toEqual({
    select: ["id", "email"],
    withDeleted: true,
    take: new Set(events.flatMap((event) => [event.actor_id, event.target_id]))
      .size,
  })
  expect(h.access.listAccessRoles.mock.calls[0][1]).toEqual({
    select: ["id", "name"],
    withDeleted: true,
    take: new Set(events.flatMap((event) => [event.actor_id, event.target_id]))
      .size,
  })
  const rows = h.res.json.mock.calls[0][0].events
  expect(rows.map((row: any) => row.target_label)).toEqual(
    cases.map((entry) => entry.expected)
  )
  expect(rows[0].actor_label).toBe("actor@example.test")
  expect(rows[1].actor_label).toBe("Unknown user")
})
