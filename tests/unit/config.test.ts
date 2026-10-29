import { it, expect, vi } from "vitest"
import {
  createAccessConfig,
  evaluatePermission,
  validateRules,
  type PermissionRule,
} from "../../src/lib/access/config"
import { PERMISSION_IDS } from "../../src/lib/access/permissions"
import AccessControlService from "../../src/modules/access-control/service"
import validateOptions from "../../src/modules/access-control/loaders/validate-options"
import { requirePermission } from "../../src/lib/access/middleware"
import {
  createPrincipal,
  createRole,
  createStaffAccess,
} from "../fixtures/access"

const permission = ["documents.read", "Read documents", "Documents"] as const
const route = {
  method: "GET",
  path: "/admin/documents/:id",
  permissions: [permission[0]],
}
const ordinary = createPrincipal({ is_superuser: false, permissions: [] })

it("registers custom permissions and explicit route operations without reopening native APIs", async () => {
  const config = createAccessConfig({
    permissions: [permission],
    routes: [
      route,
      {
        method: "POST",
        path: "/admin/reports",
        permissions: [],
        superuser: true,
      },
    ],
  })
  expect(config.ids).toContain(permission[0])
  expect(
    config.policyFor("HEAD", "/admin/documents/doc_1")?.permissions
  ).toEqual([permission[0]])
  expect(config.policyFor("GET", "/admin/documents/doc_1/extra")).toBeNull()
  expect(config.policyFor("DELETE", "/admin/documents/doc_1")).toBeNull()
  expect(config.policyFor("POST", "/admin/reports")?.superuser).toBe(true)
  expect(config.policyFor("GET", "/admin/products")?.permissions).toContain(
    "products.view"
  )
  for (const path of [
    "/admin/access/unknown",
    "/admin/products/one/unknown",
    "/admin/rbac",
    "/admin/api-keys",
  ])
    expect(
      createAccessConfig({
        permissions: [permission],
        routes: [{ ...route, path }],
      }).policyFor("GET", path)
    ).toBeNull()
  await validateOptions({ options: {} } as any)
})

it.each([
  ["bad", "Label", "Group"],
  ["orders.view", "Duplicate", "Orders"],
  ["custom.read", "", "Group"],
  ["custom.read", "Label", ""],
  ["custom.read", undefined, "Group"],
  ["custom.read", "Label", undefined],
])(
  "rejects malformed/duplicate permission definitions %j",
  (id, label, group) => {
    expect(() =>
      createAccessConfig({ permissions: [[id, label, group] as any] })
    ).toThrow("permission")
  }
)

it.each([
  { ...route, method: "TRACE" },
  { ...route, path: "/admin/[anything]" },
  { ...route, permissions: ["missing.read"] },
  { ...route, permissions: [] },
])("rejects unsafe route policies %j", (bad) => {
  expect(() =>
    createAccessConfig({ permissions: [permission], routes: [bad] })
  ).toThrow("route policy")
})

it("rejects duplicate routes and actor resolvers", () => {
  expect(() =>
    createAccessConfig({ permissions: [permission], routes: [route, route] })
  ).toThrow("duplicate")
  const validate = async () => {}
  for (const actors of [
    [{ type: "user", validate }],
    [{ type: "", validate }],
    [
      { type: "vendor", validate },
      { type: "vendor", validate },
    ],
  ])
    expect(() => createAccessConfig({ actors })).toThrow("Actor resolvers")
})

it("validates exact, wildcard and context-scoped rules without inventing permission identifiers", () => {
  expect(validateRules(undefined, PERMISSION_IDS)).toEqual([])
  const rules: PermissionRule[] = [
    { permission: "orders.view", effect: "allow" },
    {
      permission: "orders.*",
      effect: "deny",
      priority: 10,
      conditions: {
        region_id: ["north", "south"],
        enabled: true,
        nullable: null,
        amount: 1,
      },
    },
    { permission: "*", effect: "deny", conditions: {} },
  ]
  expect(validateRules(rules, PERMISSION_IDS)).toEqual(rules)
})

it.each([
  null,
  {},
  Array(201).fill({}),
  [null],
  [false],
  [[]],
  [{ permission: 1, effect: "allow" }],
  [{ permission: "orders.view", effect: "allow", extra: true }],
  [{ permission: "orders.view", effect: "oops" }],
  [{ permission: "orders.view", effect: "allow", priority: 1.5 }],
  [{ permission: "orders.view", effect: "allow", priority: 1000001 }],
  [{ permission: "missing.read", effect: "allow" }],
  [{ permission: "missing.*", effect: "allow" }],
])("rejects malformed rules %j", (rules) =>
  expect(() => validateRules(rules, PERMISSION_IDS)).toThrow()
)

it.each([
  null,
  "value",
  [],
  Object.fromEntries(
    Array.from({ length: 31 }, (_, index) => ["field_" + index, true])
  ),
  { "bad.key": true },
  { ids: [] },
  { ids: Array(101).fill("id") },
  { value: {} },
  { value: undefined },
  { value: NaN },
  { values: [{}] },
])("rejects unsafe conditions %j", (conditions) => {
  expect(() =>
    validateRules(
      [{ permission: "orders.view", effect: "allow", conditions }],
      PERMISSION_IDS
    )
  ).toThrow("conditions")
})

it("evaluates role unions, wildcard specificity, priority, scoped rules and deny ties", () => {
  const decide = (
    rules: PermissionRule[],
    context = {},
    grants: string[] = []
  ) =>
    evaluatePermission(
      { ...ordinary, rules, permissions: grants },
      "orders.view",
      context
    )
  expect(
    evaluatePermission({ ...ordinary, active: false }, "orders.view")
  ).toBe(false)
  expect(evaluatePermission(createPrincipal(), "orders.view")).toBe(true)
  expect(evaluatePermission(ordinary, "orders.view")).toBe(false)
  expect(decide([{ permission: "*", effect: "allow" }])).toBe(true)
  expect(
    decide([
      { permission: "orders.*", effect: "allow" },
      { permission: "orders.view", effect: "deny" },
    ])
  ).toBe(false)
  expect(
    decide([
      { permission: "orders.*", effect: "deny" },
      { permission: "orders.view", effect: "allow" },
    ])
  ).toBe(true)
  expect(
    decide([{ permission: "orders.view", effect: "deny", priority: 1 }], {}, [
      "orders.view",
    ])
  ).toBe(false)
  expect(
    decide([
      { permission: "orders.view", effect: "allow" },
      { permission: "orders.view", effect: "deny" },
    ])
  ).toBe(false)
  expect(
    decide([
      { permission: "orders.view", effect: "deny" },
      { permission: "orders.view", effect: "allow" },
    ])
  ).toBe(false)
  expect(
    decide([
      { permission: "orders.view", effect: "allow" },
      { permission: "orders.view", effect: "allow" },
    ])
  ).toBe(true)
  const scoped: PermissionRule = {
    permission: "orders.view",
    effect: "allow",
    conditions: { region_id: ["north", "south"], sales_channel_id: "retail" },
  }
  expect(
    decide([scoped], { region_id: "north", sales_channel_id: "retail" })
  ).toBe(true)
  expect(
    decide([scoped], { region_id: "west", sales_channel_id: "retail" })
  ).toBe(false)
  expect(
    decide([scoped], { region_id: "north", sales_channel_id: "other" })
  ).toBe(false)
  expect(decide([scoped], {})).toBe(false)
  expect(decide([{ permission: "products.view", effect: "allow" }])).toBe(false)
  expect(
    decide(
      [
        { permission: "orders.view", effect: "deny" },
        { ...scoped, effect: "allow" },
      ],
      { region_id: "north", sales_channel_id: "retail" }
    )
  ).toBe(true)
})

function service() {
  return Object.create(AccessControlService.prototype) as AccessControlService
}
it("resolves actors and trusted request context through configured module options", async () => {
  const access = service()
  ;(access as any).accessConfig_ = createAccessConfig({
    permissions: [permission],
    routes: [route],
    contextResolvers: [
      async () => ({ sales_channel_id: "retail", actor_id: "forged" }),
    ],
    actors: [{ type: "vendor", validate: async () => {} }],
  })
  expect(access.permissionDefinitions()).toContainEqual(permission)
  expect(access.validatePermissions([permission[0], permission[0]])).toEqual([
    permission[0],
  ])
  expect(() => access.validatePermissions(["unknown.read"])).toThrow(
    "supported permission"
  )
  expect(() => access.validateRules([{}])).toThrow("Invalid permission rule")
  expect(access.validateRules([])).toEqual([])
  expect(access.policyFor("GET", "/admin/documents/one")?.permissions).toEqual([
    permission[0],
  ])
  const req = {
    scope: {
      resolve: () => ({ retrieveUser: async () => ({ id: "user_1" }) }),
    },
    originalUrl: "/documents/one?secret=omitted",
    method: "GET",
    auth_context: { actor_type: "vendor", actor_id: "vendor_1" },
  } as any
  expect(await access.permissionContext(req)).toEqual({
    sales_channel_id: "retail",
    actor_id: "vendor_1",
    actor_type: "vendor",
    route: "/documents/one",
    method: "GET",
  })
  vi.spyOn(access, "actorPrincipal").mockResolvedValue(ordinary)
  expect(await access.principalForRequest(req)).toEqual(ordinary)
  expect(
    await access.principalForRequest({
      ...req,
      auth_context: { actor_type: "unsupported", actor_id: "id" },
    })
  ).toBeNull()
  expect(
    await access.principalForRequest({ ...req, auth_context: undefined })
  ).toBeNull()
  expect(
    await access.permissionContext({ ...req, auth_context: undefined })
  ).toMatchObject({ actor_id: null, actor_type: null })
  vi.spyOn(access, "actorPrincipal").mockResolvedValue(ordinary)
  expect(
    await access.principalForRequest({
      ...req,
      auth_context: { actor_type: "user", actor_id: "user_1" },
    })
  ).toEqual(ordinary)
  expect(access.actorPrincipal).toHaveBeenCalledWith({
    type: "user",
    id: "user_1",
  })
  expect(access.allows(createPrincipal(), "unknown.read")).toBe(false)
  expect(access.allows(createPrincipal(), permission[0])).toBe(true)
})

it("loads persisted scoped rules and gives Superuser new configured permissions", async () => {
  const access = service()
  ;(access as any).accessConfig_ = createAccessConfig({
    permissions: [permission],
  })
  const rule: PermissionRule = {
    permission: permission[0],
    effect: "allow",
    conditions: { sales_channel_id: "retail" },
  }
  const execute = vi
    .fn()
    .mockResolvedValueOnce([createStaffAccess()])
    .mockResolvedValueOnce([createRole({ rules: [rule] })])
  const principal = await access.principal("user", {
    manager: { execute },
  } as any)
  expect(principal.rules).toEqual([rule])
  expect(
    access.allows(principal, permission[0], { sales_channel_id: "retail" })
  ).toBe(true)
  expect(
    access.allows(principal, permission[0], { sales_channel_id: "other" })
  ).toBe(false)
})

it.each(["allow", "deny", "anonymous", "failure"])(
  "enforces custom API permissions: %s",
  async (result) => {
    const access = service()
    vi.spyOn(access, "principalForRequest").mockResolvedValue(
      result === "anonymous" ? null : ordinary
    )
    vi.spyOn(access, "permissionContext").mockResolvedValue({})
    vi.spyOn(access, "allows").mockImplementation(() => {
      if (result === "failure") throw new Error("resolver failed")
      return result === "allow"
    })
    const req = { scope: { resolve: () => access } } as any
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
      setHeader: vi.fn(),
    } as any
    const next = vi.fn()
    await requirePermission("orders.view")(req, res, next)
    if (result === "anonymous") expect(res.status).toHaveBeenCalledWith(401)
    if (result === "deny") expect(res.status).toHaveBeenCalledWith(403)
    if (result === "failure")
      expect(next).toHaveBeenCalledWith(expect.any(Error))
    if (result === "allow") {
      expect(next).toHaveBeenCalledWith()
      expect(res.setHeader).toHaveBeenCalledWith("Cache-Control", "no-store")
    }
    expect(() => requirePermission()).toThrow("At least one")
  }
)

it("constructs a standalone service with default module options", () => {
  expect(new AccessControlService({}).permissionDefinitions()).toHaveLength(
    PERMISSION_IDS.length
  )
})
