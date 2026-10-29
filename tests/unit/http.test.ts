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
it.each(["GET", "HEAD"])("bounds read field selection (%s)", async (method) => {
  const h = harness("/admin/products", method)
  h.req.query.fields = "*"
  await h.run()
  expect(h.res.status).toHaveBeenCalledWith(403)
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
