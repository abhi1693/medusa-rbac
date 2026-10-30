import { it, expect, vi } from "vitest"
import { Modules } from "@medusajs/framework/utils"
import { explainPermission } from "../../src/lib/access/explain"
import { definePermission } from "../../src/lib/access/define-permission"
import { isPermissionContext } from "../../src/lib/access/permission-context"
import { evaluateInput } from "../../src/lib/access/validators"
import { requireAnyPermission } from "../../src/lib/access/middleware"
import {
  createAccessConfig,
  evaluatePermission,
} from "../../src/lib/access/config"
import { createPrincipal, createRole } from "../fixtures/access"
import { GET as roleDetail } from "../../src/api/admin/access/roles/[id]/route"
import { POST as evaluate } from "../../src/api/admin/access/evaluate/route"
import { GET as audit } from "../../src/api/admin/access/audit/route"

it("explains the actual winning deny without mutating the actor's rules", () => {
  const principal = createPrincipal({
    is_superuser: false,
    permissions: ["orders.view"],
    rules: [
      { permission: "orders.*", effect: "allow", priority: 5 },
      {
        permission: "orders.view",
        effect: "deny",
        priority: 5,
        conditions: { region_id: "north" },
      },
    ],
  })
  const original = structuredClone(principal)
  const decision = explainPermission(principal, "orders.view", {
    region_id: "north",
  })
  expect(decision).toMatchObject({
    allowed: false,
    reason: "deny",
    matches: [
      { effect: "deny", source: "rule" },
      { effect: "allow" },
      { source: "permission" },
    ],
  })
  expect(decision.allowed).toBe(
    evaluatePermission(principal, "orders.view", { region_id: "north" })
  )
  expect(principal).toEqual(original)
  expect(
    explainPermission(createPrincipal({ active: false }), "orders.view").reason
  ).toBe("inactive")
  expect(explainPermission(createPrincipal(), "orders.view").reason).toBe(
    "superuser"
  )
  expect(
    explainPermission(
      createPrincipal({ is_superuser: false, permissions: [] }),
      "orders.view"
    ).reason
  ).toBe("no_match")
})

it("defines literal permission identifiers with named fields", () => {
  const permission = definePermission({
    id: "documents.read",
    label: "Read documents",
    group: "Documents",
  })
  expect(createAccessConfig({ permissions: [permission] }).ids).toContain(
    "documents.read"
  )
})

it.each([
  null,
  false,
  "text",
  [],
  { nested: {} },
  { array: [] },
  { "Invalid-Key": "x" },
  { key: "x".repeat(1001) },
  { value: Infinity },
  { value: undefined },
  Object.fromEntries(Array.from({ length: 31 }, (_, i) => [`key${i}`, i])),
])(
  "rejects diagnostic contexts that cannot be safely evaluated: %j",
  (context) => {
    expect(isPermissionContext(context)).toBe(false)
    expect(() =>
      evaluateInput.parse({
        actor_type: "user",
        actor_id: "user_1",
        permission: "orders.view",
        context,
      })
    ).toThrow()
  }
)
it("accepts only bounded scalar diagnostic context values", () => {
  expect(
    isPermissionContext({
      text: "north",
      number: 3,
      enabled: true,
      empty: null,
    })
  ).toBe(true)
  expect(
    evaluateInput.parse({
      actor_type: "user",
      actor_id: "user_1",
      permission: "orders.view",
    }).context
  ).toEqual({})
})

it.each([true, false])(
  "any-permission enforcement requires a real matching grant (%s)",
  async (allowed) => {
    const access = {
      principalForRequest: async () => createPrincipal(),
      permissionContext: async () => ({ region_id: "north" }),
      allows: vi.fn(
        (_principal, permission) => allowed && permission === "orders.view"
      ),
    }
    const req = { scope: { resolve: () => access } } as any
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
      setHeader: vi.fn(),
    } as any
    const next = vi.fn()
    await requireAnyPermission("orders.manage", "orders.view")(req, res, next)
    if (allowed) expect(next).toHaveBeenCalledWith()
    else expect(res.status).toHaveBeenCalledWith(403)
    expect(() => requireAnyPermission()).toThrow("At least one")
  }
)

function harness() {
  const access = {
    roleDetail: vi.fn().mockResolvedValue({
      role: createRole(),
      actors: [],
      actor_count: 0,
      pending_invitation_count: 0,
    }),
    principal: vi.fn().mockResolvedValue(createPrincipal()),
    permissionContext: vi.fn().mockResolvedValue({ region_id: "north" }),
    allows: vi.fn().mockReturnValue(true),
    validateActor: vi.fn().mockResolvedValue(undefined),
    validatePermissions: vi.fn(),
    actorPrincipal: vi
      .fn()
      .mockResolvedValue(
        createPrincipal({ is_superuser: false, permissions: ["orders.view"] })
      ),
    auditPage: vi.fn().mockResolvedValue({
      events: [
        { actor_id: "system:configuration", target_id: "role", detail: null },
      ],
    }),
    listAccessRoles: vi.fn().mockResolvedValue([]),
  }
  const users = {
    listUsers: vi
      .fn()
      .mockResolvedValue([{ id: "user_1", email: "staff@example.test" }]),
  }
  const customers = {
    listCustomers: vi.fn().mockResolvedValue([
      { id: "customer_1", email: "buyer@example.test" },
      { id: "customer_2", email: null },
    ]),
  }
  const req = {
    params: { id: "role" },
    auth_context: { actor_id: "superuser" },
    validatedQuery: { offset: 0, limit: 25 },
    scope: {
      resolve: (token: string) =>
        token === Modules.USER
          ? users
          : token === Modules.CUSTOMER
            ? customers
            : access,
    },
  } as any
  const res = { json: vi.fn(), setHeader: vi.fn() } as any
  return { access, users, customers, req, res }
}

it("returns role membership labels only through the permitted owning modules", async () => {
  const h = harness()
  await roleDetail(h.req, h.res)
  expect(h.users.listUsers).not.toHaveBeenCalled()
  h.access.roleDetail.mockResolvedValue({
    role: createRole(),
    actors: [
      { actor_type: "user", actor_id: "user_1", active: true },
      { actor_type: "customer", actor_id: "customer_1", active: true },
      { actor_type: "customer", actor_id: "customer_2", active: true },
      { actor_type: "vendor", actor_id: "same-id", active: true },
    ],
    actor_count: 4,
    pending_invitation_count: 0,
  } as any)
  await roleDetail(h.req, h.res)
  expect(
    h.res.json.mock.calls.at(-1)?.[0].actors.map((actor: any) => actor.label)
  ).toEqual(["staff@example.test", "buyer@example.test", undefined, undefined])
  h.access.allows.mockReturnValue(false)
  h.users.listUsers.mockClear()
  h.customers.listCustomers.mockClear()
  await roleDetail(h.req, h.res)
  expect(h.users.listUsers).not.toHaveBeenCalled()
  expect(h.customers.listCustomers).not.toHaveBeenCalled()
})

it("keeps member labels private when trusted request context matches a deny", async () => {
  const h = harness()
  h.access.roleDetail.mockResolvedValue({
    role: createRole(),
    actors: [{ actor_type: "user", actor_id: "user_1", active: true }],
    actor_count: 1,
    pending_invitation_count: 0,
  } as any)
  h.access.principal.mockResolvedValue(
    createPrincipal({
      is_superuser: false,
      permissions: ["staff.view"],
      rules: [
        {
          permission: "staff.view",
          effect: "deny",
          priority: 10,
          conditions: { region_id: "north" },
        },
      ],
    })
  )
  h.access.allows.mockImplementation(evaluatePermission)
  await roleDetail(h.req, h.res)
  expect(h.access.permissionContext).toHaveBeenCalledWith(h.req)
  expect(h.users.listUsers).not.toHaveBeenCalled()
})

it("uses the selected native actor and prevents diagnostic identity spoofing", async () => {
  const h = harness()
  h.req.body = {
    actor_type: "customer",
    actor_id: "customer_1",
    permission: "orders.view",
    context: { actor_id: "forged", actor_type: "user", region_id: "north" },
  }
  await evaluate(h.req, h.res)
  expect(h.access.validateActor).toHaveBeenCalledWith(
    { type: "customer", id: "customer_1" },
    h.req
  )
  expect(h.res.json).toHaveBeenCalledWith(
    expect.objectContaining({
      context: {
        actor_id: "customer_1",
        actor_type: "customer",
        region_id: "north",
      },
      decision: expect.objectContaining({ allowed: true, reason: "allow" }),
    })
  )
  expect(h.res.setHeader).toHaveBeenCalledWith("Cache-Control", "no-store")
  delete h.req.body.context
  await evaluate(h.req, h.res)
  expect(h.res.json.mock.calls.at(-1)?.[0].context).toEqual({
    actor_id: "customer_1",
    actor_type: "customer",
  })
  expect(
    createAccessConfig().policyFor("POST", "/admin/access/evaluate")?.superuser
  ).toBe(true)
})

it("labels configuration sync events without impersonating an administrator", async () => {
  const h = harness()
  await audit(h.req, h.res)
  expect(h.res.json.mock.calls[0][0].events[0].actor_label).toBe(
    "Configuration"
  )
})
