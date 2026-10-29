import { it, expect, vi } from "vitest"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { authenticateActor } from "../../src/api/middlewares/authenticate-actor"
import {
  GET,
  AUTHENTICATE,
} from "../../src/api/access/actors/[actor_type]/me/route"
import {
  hasPermissionCandidate,
  permissionKeyMatches,
} from "../../src/lib/access/permission-key"
import { policyFor } from "../../src/lib/access/policy"
import { createAccessClient } from "../../src/client"
import AccessControlService from "../../src/modules/access-control/service"
import { createPrincipal } from "../fixtures/access"

it("advertises possible access without claiming contextual authorization", () => {
  const access = createPrincipal({
    is_superuser: false,
    permissions: [],
    rules: [
      {
        permission: "orders.*",
        effect: "allow",
        conditions: { region: "north" },
      },
      { permission: "products.*", effect: "deny" },
    ],
  })
  expect(hasPermissionCandidate(access, "orders.view")).toBe(true)
  expect(hasPermissionCandidate(access, "products.view")).toBe(false)
  expect(
    hasPermissionCandidate({ ...access, rules: undefined }, "orders.view")
  ).toBe(false)
  expect(
    hasPermissionCandidate(
      { ...access, permissions: ["products.view"] },
      "products.view"
    )
  ).toBe(true)
  expect(
    hasPermissionCandidate({ ...access, is_superuser: true }, "products.view")
  ).toBe(true)
  expect(
    hasPermissionCandidate({ ...access, active: false }, "orders.view")
  ).toBe(false)
  expect(permissionKeyMatches("*", "orders.view")).toBe(true)
  expect(permissionKeyMatches("orders.view", "orders.view")).toBe(true)
  expect(permissionKeyMatches("orders.*", "ordersExtra.view")).toBe(false)
  const service = Object.create(
    AccessControlService.prototype
  ) as AccessControlService
  expect(service.permissionCandidates(access)).toContain("orders.view")
  expect(service.permissionCandidates(access)).not.toContain("products.view")
})

it("authenticates only registered actor types through native middleware", async () => {
  const config = { configuration: { actors: [{ type: "vendor" }] } }
  const req = {
    headers: {},
    session: { auth_context: {} },
    params: { actor_type: "customer" },
    scope: {
      resolve: (key: string) =>
        key === ContainerRegistrationKeys.CONFIG_MODULE
          ? { projectConfig: { http: { jwtSecret: "test" } } }
          : config,
    },
  } as any
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as any
  const next = vi.fn()
  for (const type of ["customer", "vendor", "user"]) {
    req.params.actor_type = type
    req.session.auth_context = { actor_type: type, actor_id: "actor" }
    await authenticateActor(req, res, next)
    expect(req.auth_context).toEqual(req.session.auth_context)
    expect(next).toHaveBeenCalledWith()
  }
  req.params.actor_type = "customer"
  req.session.auth_context = { actor_type: "user", actor_id: "admin" }
  await authenticateActor(req, res, next)
  expect(res.status).toHaveBeenCalledWith(401)
  req.params.actor_type = "unknown"
  await authenticateActor(req, res, next)
  expect(res.status).toHaveBeenCalledWith(401)
  req.scope.resolve = () => {
    throw new Error("Unavailable")
  }
  await authenticateActor(req, res, next)
  expect(next).toHaveBeenCalledWith(
    expect.objectContaining({ message: "Unavailable" })
  )
})

it("returns only the current actor's summary and keeps private policy conditions on the server", async () => {
  const access = {
    principalForRequest: vi.fn().mockResolvedValue(null),
    listAccessRoles: vi
      .fn()
      .mockResolvedValue([
        { id: "role", name: "Buyer", rules: [{ secret: true }] },
      ]),
    permissionCandidates: vi.fn().mockReturnValue(["documents.read"]),
  }
  const req = { scope: { resolve: () => access } } as any
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn(),
    setHeader: vi.fn(),
  } as any
  expect(AUTHENTICATE).toBe(false)
  await GET(req, res)
  expect(res.status).toHaveBeenCalledWith(401)
  const principal = createPrincipal({
    actor_type: "customer",
    actor_id: "buyer",
    role_ids: ["role"],
  })
  access.principalForRequest.mockResolvedValue(principal as any)
  await GET(req, res)
  expect(res.json).toHaveBeenLastCalledWith({
    actor: { id: "buyer", type: "customer", active: true },
    roles: [{ id: "role", name: "Buyer" }],
    permission_candidates: ["documents.read"],
  })
  expect(res.setHeader).toHaveBeenCalledWith("Cache-Control", "no-store")
  access.principalForRequest.mockResolvedValue({
    ...principal,
    role_ids: [],
  } as any)
  await GET(req, res)
  expect(res.json.mock.calls.at(-1)![0].roles).toEqual([])
})

it("shares the host SDK's authentication and safely encodes custom actor types", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValue({ actor: { type: "customer", id: "buyer" } })
  const client = createAccessClient({ client: { fetch } } as any)
  expect(await client.me("customer")).toMatchObject({ actor: { id: "buyer" } })
  await client.me("vendor/type", { Authorization: "Bearer jwt" })
  expect(fetch).toHaveBeenLastCalledWith("/access/actors/vendor%2Ftype/me", {
    headers: { Authorization: "Bearer jwt" },
  })
})

it("reserves invitation listings for Superuser", () =>
  expect(policyFor("GET", "/admin/access/invites")?.superuser).toBe(true))
