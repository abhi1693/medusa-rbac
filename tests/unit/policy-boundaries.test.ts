import { it, expect } from "vitest"
import {
  policyFor,
  isBootstrapRead,
  normalizedPath,
  validateFieldSelection,
  additionalWritePermissions,
  isSelfProfileUpdate,
  can,
} from "../../src/lib/access/policy"
import {
  PERMISSION_IDS,
  validatePermissions,
} from "../../src/lib/access/permissions"
import { createPrincipal } from "../fixtures/access"
import {
  roleInput,
  updateRoleInput,
  deleteRoleInput,
  staffInput,
  pageInput,
} from "../../src/lib/access/validators"

it("covers native resource actions and custom read boundaries", () => {
  const cases: [string, string, string[] | null][] = [
    ["HEAD", "/admin/users/me", []],
    ["GET", "/admin/access/roles", ["roles.view"]],
    ["GET", "/admin/access/staff", ["staff.view"]],
    ["GET", "/admin/access/permissions", ["roles.view"]],
    ["GET", "/admin/access/audit", ["audit.view"]],
    ["POST", "/admin/access/roles/id", []],
    ["DELETE", "/admin/access/roles/id", []],
    ["POST", "/admin/access/staff/id", []],
    ["GET", "/admin/users", ["staff.view"]],
    ["GET", "/admin/invites", []],
    ["POST", "/admin/payments/id/refund", ["refunds.issue"]],
    ["POST", "/admin/orders/id/cancel", ["orders.cancel"]],
    ["POST", "/admin/draft-orders/id/cancel", null],
    [
      "POST",
      "/admin/products/import",
      ["products.import", "products.create", "products.edit", "prices.edit"],
    ],
    ["DELETE", "/admin/products/id", ["products.delete"]],
    ["POST", "/admin/products/id", ["products.edit"]],
    ["GET", "/admin/notifications", null],
    ["PATCH", "/admin/products", null],
  ]
  for (const [verb, path, permissions] of cases) {
    expect(
      policyFor(verb, path)?.permissions ?? null,
      `${verb} ${path}`
    ).toEqual(permissions)
  }
  expect(policyFor("POST", "/admin/access/staff/id")?.superuser).toBe(true)
  expect(isBootstrapRead("GET", "/admin/plugins")).toBe(true)
  expect(isBootstrapRead("POST", "/admin/plugins")).toBe(false)
  expect(isBootstrapRead("GET", "/admin/products")).toBe(false)
})
it("validates malformed paths, profiles and bounded field expressions", () => {
  expect(normalizedPath("/admin\\users")).toBeNull()
  for (const value of [null, [], 1, "name"])
    expect(isSelfProfileUpdate("POST", "/admin/users/me", "me", value)).toBe(
      false
    )
  expect(isSelfProfileUpdate("GET", "/admin/users/me", "me", {})).toBe(false)
  expect(validateFieldSelection("unknown", undefined)).toBe(true)
  expect(validateFieldSelection("unknown", "id")).toBe(false)
  expect(validateFieldSelection("products", "x".repeat(4001))).toBe(false)
  expect(validateFieldSelection("users", "+id,-first_name")).toBe(true)
  expect(validateFieldSelection("products", "-nonsense")).toBe(false)
  expect(
    validateFieldSelection(
      "orders",
      "id,status,created_at,email,display_id,custom_display_id,payment_status,fulfillment_status,total,currency_code,*customer,*sales_channel,*payment_collections,*shipping_address"
    )
  ).toBe(true)
})
it("checks sensitive writes at native envelope boundaries only", () => {
  expect(additionalWritePermissions(null)).toEqual([])
  expect(additionalWritePermissions("x")).toEqual([])
  expect(
    additionalWritePermissions(
      {
        variants: [
          {
            status: "published",
            manage_inventory: false,
            allow_backorder: true,
            inventory_quantity: 1,
            inventory_items: [],
            thumbnail: "x",
            images: [],
            collection_id: "id",
            categories: [],
            category_ids: [],
          },
        ],
      },
      true
    )
  ).toEqual(
    expect.arrayContaining([
      "products.publish",
      "inventory.adjust",
      "media.manage",
      "collections.manage",
      "categories.manage",
    ])
  )
  expect(
    additionalWritePermissions({
      manage_inventory: true,
      allow_backorder: false,
    })
  ).toEqual(["inventory.adjust"])
  expect(
    additionalWritePermissions({
      create: [{ variants: [{ status: "draft" }] }],
      update: [{ allow_backorder: true }],
    })
  ).toEqual(["products.create", "inventory.adjust"])
  for (const value of [[1], ["no"], null])
    expect(() => validatePermissions(value)).toThrow()
  expect(
    can(
      {
        actor_id: "u",
        actor_type: "user",
        active: true,
        is_superuser: true,
        role_ids: [],
        permissions: [...PERMISSION_IDS],
      },
      { superuser: true, permissions: ["roles.view"] }
    )
  ).toBe(true)
})
it("validates strict request bodies and pagination bounds", () => {
  expect(roleInput.parse({ name: " Read ", permissions: [] }).name).toBe("Read")
  for (const name of ["", " ", "a".repeat(101)])
    expect(roleInput.safeParse({ name, permissions: [] }).success).toBe(false)
  expect(
    roleInput.safeParse({
      name: "Role",
      permissions: [],
      is_superuser: true,
    }).success
  ).toBe(false)
  expect(
    updateRoleInput.safeParse({ name: "Role", permissions: [], version: 0 })
      .success
  ).toBe(false)
  expect(deleteRoleInput.safeParse({ version: 1, extra: true }).success).toBe(
    false
  )
  expect(
    staffInput.safeParse({ role_ids: [], active: true, version: 0 }).success
  ).toBe(true)
  expect(
    staffInput.safeParse({ role_ids: [], active: true, version: -1 }).success
  ).toBe(false)
  expect(pageInput.parse({})).toEqual({ offset: 0, limit: 25 })
  expect(pageInput.parse({ offset: "25", limit: "100" })).toEqual({
    offset: 25,
    limit: 100,
  })
  for (const page of [
    { offset: -1 },
    { offset: 100001 },
    { limit: 0 },
    { limit: 101 },
    { offset: 1.5 },
  ])
    expect(pageInput.safeParse(page).success).toBe(false)
})

it("orders.view authorizes order reads without granting customer or payment directory access", () => {
  const principal = {
    actor_id: "user",
    actor_type: "user",
    active: true,
    is_superuser: false,
    role_ids: ["orders_reader"],
    permissions: ["orders.view"] as const,
  }
  for (const path of [
    "/admin/orders",
    "/admin/draft-orders",
    "/admin/orders/id/changes",
    "/admin/returns",
    "/admin/claims",
    "/admin/exchanges",
  ])
    expect(
      can(
        { ...principal, permissions: [...principal.permissions] },
        policyFor("GET", path)!
      )
    ).toBe(true)
  for (const path of ["/admin/customers", "/admin/payments"])
    expect(
      can(
        { ...principal, permissions: [...principal.permissions] },
        policyFor("GET", path)!
      )
    ).toBe(false)
})

it("allows reviewed native variant summaries while denying unrelated product expansions", () => {
  expect(
    validateFieldSelection(
      "product-variants",
      "id,title,sku,thumbnail,metadata,manage_inventory,inventory_quantity,*prices,product.id,product.title,product.handle,product.status,product.thumbnail,product.metadata"
    )
  ).toBe(true)
  expect(validateFieldSelection("product-variants", "product.orders")).toBe(
    false
  )
})

it("applies contextual deny rules through the public policy helper", () => {
  const principal = createPrincipal({
    is_superuser: false,
    permissions: ["orders.view"],
    rules: [
      {
        permission: "orders.view",
        effect: "deny",
        priority: 1,
        conditions: { region_id: "blocked" },
      },
    ],
  })
  const policy = policyFor("GET", "/admin/orders")!
  expect(can(principal, policy, { region_id: "blocked" })).toBe(false)
  expect(can(principal, policy, { region_id: "allowed" })).toBe(true)
})
