import assert from "node:assert/strict"
import { test } from "vitest"
import { createRequire } from "node:module"
import { readFileSync } from "node:fs"
import path from "node:path"
import {
  additionalWritePermissions,
  can,
  isSelfProfileUpdate,
  normalizedPath,
  policyFor,
  validateFieldSelection,
} from "../src/lib/access/policy"
import {
  PERMISSION_IDS,
  validatePermissions,
  type AccessPrincipal,
} from "../src/lib/access/permissions"
import inventory from "../src/lib/access/native-routes.json"
import { createPrincipal } from "./fixtures/access"
import fieldInventory from "../src/lib/access/native-fields.json"

const nativeRequire = createRequire(path.join(process.cwd(), "package.json"))

const principal = createPrincipal({
  actor_id: "user_test",
  is_superuser: false,
  role_ids: ["role_test"],
  permissions: ["products.view", "prices.view"],
})

test("grants are explicit and unknown permission names are rejected", () => {
  assert.deepEqual(validatePermissions(["products.view", "products.view"]), [
    "products.view",
  ])
  for (const value of [["*"], ["superuser"], ["products.*"], "products.view"])
    assert.throws(() => validatePermissions(value))
  assert.equal(new Set(PERMISSION_IDS).size, PERMISSION_IDS.length)
})

test("native and custom access fail closed", () => {
  assert.equal(can(principal, policyFor("GET", "/admin/products")!), true)
  assert.equal(can(principal, policyFor("POST", "/admin/products")!), false)
  assert.equal(can(principal, policyFor("POST", "/admin/access/roles")!), false)
  assert.equal(
    can({ ...principal, active: false }, policyFor("GET", "/admin/products")!),
    false
  )
  for (const route of [
    "/admin/new-plugin",
    "/admin/search",
    "/admin/workflows/run",
    "/admin/api-keys",
    "/admin/rbac/roles",
  ])
    assert.equal(policyFor("GET", route), null)
  assert.equal(policyFor("POST", "/admin/users/user_test"), null)
  assert.equal(policyFor("DELETE", "/admin/users/user_test"), null)
  assert.equal(
    can(
      { ...principal, permissions: ["products.edit"] },
      policyFor("POST", "/admin/products/export")!
    ),
    false
  )
  assert.equal(policyFor("POST", "/admin/inventory-items/export"), null)
  assert.equal(
    policyFor("DELETE", "/admin/access/staff/user_test")?.superuser,
    true
  )
  assert.equal(policyFor("GET", "/admin/access/roles/role_test"), null)
})

test("normalization cannot turn a denied request into an alternate operation", () => {
  assert.equal(normalizedPath("/ADMIN/products/?fields=id"), "/admin/products")
  for (const route of [
    "/admin/products/%2fusers",
    "/admin//products",
    "/admin/products/%252f",
    "/admin/products/..%2fusers",
  ])
    assert.equal(normalizedPath(route), null)
})

test("self-profile exception cannot change another user or access metadata", () => {
  assert.equal(
    isSelfProfileUpdate("POST", "/admin/users/user_test", "user_test", {
      first_name: "Name",
    }),
    true
  )
  assert.equal(
    isSelfProfileUpdate("POST", "/admin/users/user_other", "user_test", {
      first_name: "Name",
    }),
    false
  )
  assert.equal(
    isSelfProfileUpdate("POST", "/admin/users/user_test", "user_test", {
      metadata: { is_superuser: true },
    }),
    false
  )
  assert.equal(
    isSelfProfileUpdate("POST", "/admin/users/user_test", "user_test", {
      email: "new@example.test",
    }),
    false
  )
})

test("cross-domain fields and wildcard selections are bounded", () => {
  assert.equal(
    validateFieldSelection("products", "id,title,*variants.prices"),
    true
  )
  assert.equal(
    validateFieldSelection(
      "products",
      "id,title,handle,status,*collection,*sales_channels,variants.id,thumbnail,-type,-options,-tags,-images,-variants"
    ),
    true
  )
  for (const fields of [
    "*",
    "*customer",
    "+variants.inventory_items.inventory.secret",
    ["id"],
    { name: "id" },
    "+rbac_roles",
  ])
    assert.equal(validateFieldSelection("products", fields), false)
})

test("nested and batch writes require their sensitive action grants", () => {
  assert.deepEqual(
    additionalWritePermissions(
      {
        status: "draft",
        variants: [{ manage_inventory: true, allow_backorder: false }],
      },
      true
    ),
    []
  )
  assert.ok(
    additionalWritePermissions({ status: "published" }, true).includes(
      "products.publish"
    )
  )
  const needed = additionalWritePermissions({
    update: [{ variants: [{ prices: [{ amount: 1 }] }], status: "draft" }],
    delete: ["prod_test"],
    create: [{ title: "Test" }],
  })
  for (const permission of [
    "prices.edit",
    "products.publish",
    "products.delete",
    "products.create",
  ])
    assert.ok(needed.includes(permission as never))
  assert.deepEqual(
    additionalWritePermissions({
      metadata: {
        specifications: { status: "active", amount: 8, delete: false },
      },
    }),
    []
  )
})

test("native route snapshot matches installed Medusa route methods", () => {
  assert.equal(
    nativeRequire("@medusajs/medusa/package.json").version,
    "2.22.1",
    "Review native RBAC policies and regenerate the snapshot before upgrading Medusa"
  )
  const base = path.dirname(
    nativeRequire.resolve("@medusajs/medusa/package.json")
  )
  for (const route of inventory) {
    const file = path.join(
      base,
      "dist/api",
      route.path.replace(/^\//, "").replace(/:([^/]+)/g, "[$1]"),
      "route.js"
    )
    const source = readFileSync(file, "utf8")
    const methods = [
      ...new Set(
        [
          ...source.matchAll(/exports\.(GET|POST|PUT|PATCH|DELETE|HEAD)\s*=/g),
        ].map((match) => match[1])
      ),
    ].sort()
    assert.deepEqual(route.methods, methods, route.path)
  }
})

test("field snapshot includes evaluated native exports with different names and spreads", () => {
  assert.equal(
    nativeRequire("@medusajs/dashboard/package.json").version,
    "2.22.1",
    "Review the native 403 compatibility patch before upgrading Dashboard"
  )
  const base = path.join(
    path.dirname(nativeRequire.resolve("@medusajs/medusa/package.json")),
    "dist/api/admin"
  )
  for (const [resource, fields] of Object.entries(fieldInventory)) {
    const config = nativeRequire(path.join(base, resource, "query-config.js"))
    const expected = [
      ...new Set(
        Object.entries(config).flatMap(([name, value]) =>
          !/Role|Rbac|Policy/.test(name) &&
          Array.isArray(value) &&
          value.every((field) => typeof field === "string")
            ? value
            : []
        )
      ),
    ].sort()
    assert.deepEqual(fields, expected, resource)
  }
  for (const resource of [
    "product-categories",
    "price-lists",
    "price-preferences",
    "tax-regions",
    "tax-rates",
    "tax-providers",
  ])
    assert.ok(
      resource in fieldInventory,
      `${resource} must not disappear from the field catalog`
    )
})

test("native Admin list queries remain within reviewed field bounds", () => {
  const selections = {
    collections: "+products.id",
    "customer-groups": "id,name,created_at,updated_at,customers.id",
    "product-categories":
      "id,name,category_children,handle,is_internal,is_active",
    "price-lists": "id,title,type,status,starts_at,ends_at",
    stores: "+supported_currencies",
    "tax-regions": "id,country_code,province_code,*children",
  }
  for (const [resource, fields] of Object.entries(selections))
    assert.equal(
      validateFieldSelection(resource, fields),
      true,
      `${resource}: ${fields}`
    )
  for (const [resource, fields] of [
    ["collections", "*products"],
    ["customer-groups", "*customers"],
    ["product-categories", "category_children.products.*"],
    ["orders", "customer.auth_identity"],
  ])
    assert.equal(validateFieldSelection(resource, fields), false)
})
