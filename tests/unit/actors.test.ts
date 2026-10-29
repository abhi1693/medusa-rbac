import { it, expect, vi } from "vitest"
import { Modules } from "@medusajs/framework/utils"
import AccessControlService from "../../src/modules/access-control/service"
import { createAccessConfig } from "../../src/lib/access/config"
import {
  createRole,
  createSuperuserRole,
  createStaffAccess,
} from "../fixtures/access"
import {
  GET,
  POST,
} from "../../src/api/admin/access/actors/[actor_type]/[id]/route"
import { policyFor } from "../../src/lib/access/policy"

function harness(...responses: unknown[]) {
  const service = Object.create(
    AccessControlService.prototype
  ) as AccessControlService
  const execute = vi.fn()
  for (const response of responses) execute.mockResolvedValueOnce(response)
  const context = {
    manager: { execute },
    transactionManager: { execute },
  } as any
  return { service, execute, context }
}

it("isolates identical subject identifiers by actor type and never grants customer Superuser", async () => {
  const role = createRole()
  const customer = harness([createStaffAccess()], [role, createSuperuserRole()])
  const principal = await customer.service.actorPrincipal(
    { id: "same", type: "customer" },
    customer.context
  )
  expect(customer.execute.mock.calls[0][1]).toEqual(["same", "customer"])
  expect(principal).toMatchObject({
    actor_id: "same",
    actor_type: "customer",
    is_superuser: false,
    permissions: ["products.view"],
    role_ids: [role.id],
  })
  const user = harness([])
  expect(
    await user.service.actorPrincipal({ id: "same", type: "user" }, {
      manager: user.context.manager,
    } as any)
  ).toMatchObject({ actor_type: "user", active: false, permissions: [] })
  expect(user.execute.mock.calls[0][1]).toEqual(["same", "user"])
})

it("retrieves actor access versions without mixing user and customer assignments", async () => {
  const saved = {
    id: "access",
    actor_id: "same",
    actor_type: "customer",
    active: true,
    role_ids: ["reader"],
    version: 2,
  }
  const h = harness([saved], [])
  expect(
    await h.service.actorAccess({ type: "customer", id: "same" }, h.context)
  ).toEqual(saved)
  expect(h.execute.mock.calls[0][1]).toEqual(["customer", "same"])
  expect(
    await h.service.actorAccess({ type: "customer", id: "none" }, {
      manager: h.context.manager,
    } as any)
  ).toEqual({
    actor_type: "customer",
    actor_id: "none",
    active: false,
    role_ids: [],
    version: 0,
  })
})

it("validates native users and customers through their owning Medusa modules", async () => {
  const h = harness()
  const users = { retrieveUser: vi.fn() },
    customers = { retrieveCustomer: vi.fn() }
  const request = {
    scope: {
      resolve: (key: string) => (key === Modules.USER ? users : customers),
    },
  } as any
  await h.service.validateActor({ type: "user", id: "user" }, request)
  await h.service.validateActor({ type: "customer", id: "customer" }, request)
  expect(users.retrieveUser).toHaveBeenCalledWith("user", { select: ["id"] })
  expect(customers.retrieveCustomer).toHaveBeenCalledWith("customer", {
    select: ["id"],
  })
  await expect(
    h.service.validateActor({ type: "unknown", id: "id" }, request)
  ).rejects.toThrow("Unknown actor")
  const validate = vi.fn()
  ;(h.service as any).accessConfig_ = createAccessConfig({
    actors: [{ type: "vendor", validate }],
  })
  await h.service.validateActor({ type: "vendor", id: "vendor" }, request)
  expect(validate).toHaveBeenCalledWith("vendor", request)
})

it("resolves native customer authorization from the shared role store after identity validation", async () => {
  const h = harness()
  const retrieveCustomer = vi.fn()
  vi.spyOn(h.service, "actorPrincipal").mockResolvedValue({
    actor_type: "customer",
    actor_id: "customer",
    active: true,
    is_superuser: false,
    role_ids: [],
    permissions: [],
  })
  const req = {
    auth_context: { actor_type: "customer", actor_id: "customer" },
    scope: { resolve: () => ({ retrieveCustomer }) },
  } as any
  expect(await h.service.principalForRequest(req)).toMatchObject({
    actor_type: "customer",
  })
  expect(retrieveCustomer).toHaveBeenCalledWith("customer", { select: ["id"] })
  expect(h.service.actorPrincipal).toHaveBeenCalledWith({
    type: "customer",
    id: "customer",
  })
})

it("provides validated management routes for typed actor assignments", async () => {
  const access = {
    validateActor: vi.fn(),
    actorAccess: vi.fn().mockResolvedValue({ version: 1 }),
    mutate: vi.fn().mockResolvedValue({ result: {} }),
  }
  const req = {
    params: { actor_type: "customer", id: "customer" },
    auth_context: { actor_id: "superuser" },
    body: { role_ids: ["reader"], active: true, version: 1 },
    scope: { resolve: () => access },
  } as any
  const res = { json: vi.fn() } as any
  await GET(req, res)
  expect(res.json).toHaveBeenCalledWith({ access: { version: 1 } })
  await POST(req, res)
  expect(access.mutate).toHaveBeenCalledWith("superuser", {
    kind: "set_actor",
    actor: { type: "customer", id: "customer" },
    role_ids: ["reader"],
    active: true,
    version: 1,
  })
  expect(access.validateActor).toHaveBeenCalledWith(
    { type: "customer", id: "customer" },
    req
  )
  expect(
    policyFor("GET", "/admin/access/actors/customer/customer")?.superuser
  ).toBe(true)
  expect(
    policyFor("POST", "/admin/access/actors/customer/customer")?.superuser
  ).toBe(true)
  expect(
    policyFor("DELETE", "/admin/access/actors/customer/customer")
  ).toBeNull()
})

it("keeps configured custom actor types manageable without imposing native-user naming", () => {
  expect(
    policyFor("POST", "/admin/access/actors/vendor-admin/vendor-id")?.superuser
  ).toBe(true)
})
