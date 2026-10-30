import { expect, it, vi } from "vitest"
import { Modules } from "@medusajs/framework/utils"
import { GET } from "../../src/api/admin/access/actors/[actor_type]/route"
import {
  createAccessConfig,
  evaluatePermission,
} from "../../src/lib/access/config"
import { actorPageInput } from "../../src/lib/access/validators"
import { enforceAdminAccess } from "../../src/api/middlewares/enforce-admin-access"
import { createPrincipal } from "../fixtures/access"

function harness(type = "user") {
  const users = {
    listAndCountUsers: vi.fn().mockResolvedValue([[], 0]),
    retrieveUser: vi.fn().mockResolvedValue({ id: "admin" }),
  }
  const customers = {
    listAndCountCustomers: vi.fn().mockResolvedValue([[], 0]),
  }
  const access = {
    configuration: createAccessConfig(),
    principal: vi.fn().mockResolvedValue(createPrincipal()),
    policyFor: createAccessConfig().policyFor,
    resolveRequest: createAccessConfig().resolveRequest,
    permissionContext: async () => ({}),
    allows: evaluatePermission,
  }
  const req = {
    params: { actor_type: type },
    validatedQuery: { offset: 0, limit: 25 },
    originalUrl: `/admin/access/actors/${type}`,
    method: "GET",
    query: {},
    auth_context: { actor_type: "user", actor_id: "admin" },
    scope: {
      resolve: (key: string) =>
        key === Modules.USER
          ? users
          : key === Modules.CUSTOMER
            ? customers
            : access,
    },
  } as any
  const res = {
    json: vi.fn().mockReturnThis(),
    status: vi.fn().mockReturnThis(),
    setHeader: vi.fn(),
  } as any
  return { users, customers, access, req, res }
}

it("searches only native staff using bounded module pagination and readable labels", async () => {
  const h = harness()
  h.req.validatedQuery = { q: " Smith ", offset: 25, limit: 2 }
  h.users.listAndCountUsers.mockResolvedValue([
    [
      {
        id: "user_1",
        first_name: "Alice",
        last_name: "Smith",
        email: "alice@example.test",
      },
      {
        id: "user_2",
        first_name: null,
        last_name: null,
        email: "staff@example.test",
      },
    ],
    40,
  ])
  await GET(h.req, h.res)
  expect(h.users.listAndCountUsers).toHaveBeenCalledWith(
    { q: "Smith" },
    {
      skip: 25,
      take: 2,
      select: ["id", "email", "first_name", "last_name"],
      order: { id: "ASC" },
    }
  )
  expect(h.customers.listAndCountCustomers).not.toHaveBeenCalled()
  expect(h.res.json).toHaveBeenCalledWith({
    actors: [
      { id: "user_1", label: "Alice Smith", description: "alice@example.test" },
      { id: "user_2", label: "staff@example.test", description: "user_2" },
    ],
    count: 40,
    offset: 25,
    limit: 2,
  })
  expect(h.res.setHeader).toHaveBeenCalledWith("Cache-Control", "no-store")
})

it("searches customers independently and hydrates a selected ID within its owning module", async () => {
  const h = harness("customer")
  h.req.validatedQuery = { id: "shared-id", q: " ", offset: 0, limit: 25 }
  h.customers.listAndCountCustomers.mockResolvedValue([
    [{ id: "shared-id", first_name: null, last_name: "Buyer", email: null }],
    1,
  ])
  await GET(h.req, h.res)
  expect(h.customers.listAndCountCustomers.mock.calls[0][0]).toEqual({
    id: "shared-id",
  })
  expect(h.users.listAndCountUsers).not.toHaveBeenCalled()
  expect(h.res.json.mock.calls[0][0].actors).toEqual([
    { id: "shared-id", label: "Buyer", description: "shared-id" },
  ])
  h.customers.listAndCountCustomers.mockResolvedValue([[], 0])
  await GET(h.req, h.res)
  expect(h.res.json.mock.calls.at(-1)?.[0].actors).toEqual([])
})

it("provides a safe ID label for unnamed customer records", async () => {
  const h = harness("customer")
  h.customers.listAndCountCustomers.mockResolvedValue([
    [{ id: "anonymous", first_name: " ", email: null }],
    1,
  ])
  await GET(h.req, h.res)
  expect(h.res.json.mock.calls[0][0].actors).toEqual([
    { id: "anonymous", label: "anonymous" },
  ])
})

it("delegates custom actor search to that provider and returns only public option fields", async () => {
  const h = harness("vendor")
  const list = vi.fn().mockResolvedValue({
    actors: [
      {
        id: "vendor_1",
        label: "Vendor One",
        description: "West",
        token: "do-not-return",
        actor_type: "user",
      },
      { id: "vendor_2", label: "Vendor Two" },
    ],
    count: 2,
  })
  h.access.configuration = createAccessConfig({
    actors: [{ type: "vendor", validate: async () => {}, list }],
  })
  h.req.validatedQuery = { q: "West", offset: 0, limit: 2 }
  await GET(h.req, h.res)
  expect(list).toHaveBeenCalledWith(
    { q: "West", id: undefined, offset: 0, limit: 2 },
    h.req
  )
  expect(h.res.json).toHaveBeenCalledWith({
    actors: [
      { id: "vendor_1", label: "Vendor One", description: "West" },
      { id: "vendor_2", label: "Vendor Two" },
    ],
    count: 2,
    offset: 0,
    limit: 2,
  })
  expect(h.users.listAndCountUsers).not.toHaveBeenCalled()
  expect(h.customers.listAndCountCustomers).not.toHaveBeenCalled()
  h.req.validatedQuery = { id: "vendor_1", offset: 0, limit: 2 }
  list.mockResolvedValue({
    actors: [{ id: "vendor_1", label: "Vendor One" }],
    count: 1,
  })
  await GET(h.req, h.res)
  expect(h.res.json.mock.calls.at(-1)?.[0].actors).toEqual([
    { id: "vendor_1", label: "Vendor One" },
  ])
  list.mockResolvedValue({ actors: [], count: 0 })
  await GET(h.req, h.res)
  expect(h.res.json.mock.calls.at(-1)?.[0].actors).toEqual([])
})

it("reports unsupported actor search without falling back to another account type", async () => {
  const unknown = harness("unknown")
  const otherProvider = vi.fn()
  unknown.access.configuration = createAccessConfig({
    actors: [{ type: "vendor", validate: async () => {}, list: otherProvider }],
  })
  await expect(GET(unknown.req, unknown.res)).rejects.toThrow(
    "Unknown actor type"
  )
  expect(otherProvider).not.toHaveBeenCalled()
  const unsupported = harness("vendor")
  unsupported.access.configuration = createAccessConfig({
    actors: [{ type: "vendor", validate: async () => {} }],
  })
  await expect(GET(unsupported.req, unsupported.res)).rejects.toThrow(
    "Account search is not configured"
  )
  expect(unsupported.users.listAndCountUsers).not.toHaveBeenCalled()
  expect(unsupported.customers.listAndCountCustomers).not.toHaveBeenCalled()
  expect(() =>
    createAccessConfig({
      actors: [{ type: "vendor", validate: async () => {}, list: true as any }],
    })
  ).toThrow("Actor resolvers")
})

it.each([
  null,
  {},
  { actors: null, count: 0 },
  { actors: [], count: -1 },
  { actors: [], count: 1.5 },
  {
    actors: [
      { id: "one", label: "One" },
      { id: "two", label: "Two" },
      { id: "three", label: "Three" },
    ],
    count: 3,
  },
  { actors: [{ id: "one", label: "One" }], count: 0 },
  {
    actors: [
      { id: "one", label: "One" },
      { id: "one", label: "One again" },
    ],
    count: 2,
  },
  { actors: [null], count: 1 },
  { actors: [true], count: 1 },
  { actors: [[]], count: 1 },
  { actors: [{ id: 1, label: "One" }], count: 1 },
  { actors: [{ id: " ", label: "One" }], count: 1 },
  { actors: [{ id: "x".repeat(101), label: "One" }], count: 1 },
  { actors: [{ id: "one", label: 1 }], count: 1 },
  { actors: [{ id: "one", label: " " }], count: 1 },
  { actors: [{ id: "one", label: "x".repeat(501) }], count: 1 },
  { actors: [{ id: "one", label: "One", description: 1 }], count: 1 },
  {
    actors: [{ id: "one", label: "One", description: "x".repeat(1001) }],
    count: 1,
  },
])("rejects malformed or oversized custom actor results %j", async (result) => {
  const h = harness("vendor")
  h.req.validatedQuery = { offset: 0, limit: 2 }
  h.access.configuration = createAccessConfig({
    actors: [
      {
        type: "vendor",
        validate: async () => {},
        list: async () => result as any,
      },
    ],
  })
  await expect(GET(h.req, h.res)).rejects.toThrow("invalid search result")
  expect(h.res.json).not.toHaveBeenCalled()
})

it.each([
  [
    { actors: [{ id: "other", label: "Other" }], count: 1 },
    { id: "selected", offset: 0, limit: 2 },
  ],
  [
    { actors: [{ id: "selected", label: "Selected" }], count: 2 },
    { id: "selected", offset: 0, limit: 2 },
  ],
  [
    { actors: [{ id: "one", label: "One" }], count: 1 },
    { offset: 25, limit: 2 },
  ],
])(
  "rejects provider responses that ignore selected identity or pagination",
  async (result, query) => {
    const h = harness("vendor")
    h.req.validatedQuery = query
    h.access.configuration = createAccessConfig({
      actors: [
        {
          type: "vendor",
          validate: async () => {},
          list: async () => result as any,
        },
      ],
    })
    await expect(GET(h.req, h.res)).rejects.toThrow("invalid search result")
  }
)

it.each([
  { limit: 0 },
  { limit: 101 },
  { offset: -1 },
  { offset: 100001 },
  { q: "x".repeat(101) },
  { id: " " },
  { id: "x".repeat(101) },
])("bounds actor search input %j", (query) => {
  expect(() => actorPageInput.parse(query)).toThrow()
})

it("requires an active Superuser before any actor search", async () => {
  const h = harness()
  expect(
    createAccessConfig().policyFor("HEAD", "/admin/access/actors/customer")
      ?.superuser
  ).toBe(true)
  expect(
    createAccessConfig().policyFor("POST", "/admin/access/actors/customer")
  ).toBeNull()
  expect(
    createAccessConfig().policyFor(
      "POST",
      "/admin/access/actors/customer/selected"
    )?.superuser
  ).toBe(true)
  const next = vi.fn()
  h.access.principal.mockResolvedValue(
    createPrincipal({
      is_superuser: false,
      permissions: ["staff.view", "roles.view", "customers.view"],
    })
  )
  await enforceAdminAccess(h.req, h.res, next)
  expect(h.res.status).toHaveBeenCalledWith(403)
  expect(next).not.toHaveBeenCalled()
  h.req.auth_context.actor_type = "customer"
  await enforceAdminAccess(h.req, h.res, next)
  expect(h.res.status).toHaveBeenCalledWith(401)
})
