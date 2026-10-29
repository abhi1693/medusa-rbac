import { evaluatePermission, type PermissionContext } from "./config"
import nativeRoutes from "./native-routes.json"
import nativeFields from "./native-fields.json"
import type { Permission, AccessPrincipal } from "./permissions"

export type Policy = { permissions: Permission[]; superuser?: boolean }
const read = (...permissions: Permission[]): Policy => ({ permissions })
const resourcePolicies: Record<string, { read: Policy; write: Policy }> = {
  products: {
    read: read("products.view", "prices.view"),
    write: read("products.edit"),
  },
  "product-variants": {
    read: read("products.view", "prices.view"),
    write: read("products.edit"),
  },
  "product-categories": {
    read: read("categories.view"),
    write: read("categories.manage"),
  },
  collections: {
    read: read("collections.view"),
    write: read("collections.manage"),
  },
  "product-types": {
    read: read("products.view"),
    write: read("product_options.manage"),
  },
  "product-tags": {
    read: read("products.view"),
    write: read("product_options.manage"),
  },
  "product-options": {
    read: read("products.view"),
    write: read("product_options.manage"),
  },
  "product-option-values": {
    read: read("products.view"),
    write: read("product_options.manage"),
  },
  "price-lists": { read: read("prices.view"), write: read("prices.edit") },
  "price-preferences": {
    read: read("prices.view"),
    write: read("prices.edit"),
  },
  "inventory-items": {
    read: read(
      "inventory.view",
      "products.view",
      "prices.view",
      "stock_locations.view"
    ),
    write: read("inventory.adjust"),
  },
  "stock-locations": {
    read: read("stock_locations.view"),
    write: read("stock_locations.manage"),
  },
  reservations: {
    read: read("inventory.view", "products.view", "prices.view"),
    write: read("inventory.adjust"),
  },
  orders: {
    read: read("orders.view"),
    write: read("orders.manage"),
  },
  "order-changes": {
    read: read("orders.view"),
    write: read("orders.manage"),
  },
  "draft-orders": {
    read: read("orders.view"),
    write: read("orders.manage"),
  },
  returns: {
    read: read("orders.view"),
    write: read("orders.manage"),
  },
  exchanges: {
    read: read("orders.view"),
    write: read("orders.manage"),
  },
  claims: {
    read: read("orders.view"),
    write: read("orders.manage"),
  },
  fulfillments: { read: read("orders.view"), write: read("orders.manage") },
  customers: { read: read("customers.view"), write: read("customers.manage") },
  "customer-groups": {
    read: read("customers.view"),
    write: read("customers.manage"),
  },
  payments: { read: read("payments.view"), write: read("payments.capture") },
  "payment-collections": {
    read: read("payments.view"),
    write: read("payments.capture"),
  },
  promotions: {
    read: read("promotions.view"),
    write: read("promotions.manage"),
  },
  campaigns: {
    read: read("promotions.view"),
    write: read("promotions.manage"),
  },
  uploads: { read: read("media.manage"), write: read("media.manage") },
}
const settings = [
  "stores",
  "regions",
  "currencies",
  "countries",
  "sales-channels",
  "shipping-profiles",
  "shipping-options",
  "shipping-option-types",
  "fulfillment-providers",
  "fulfillment-sets",
  "tax-regions",
  "tax-rates",
  "tax-providers",
  "return-reasons",
  "refund-reasons",
  "locales",
  "translations",
]
for (const resource of settings)
  resourcePolicies[resource] = {
    read: read("settings.view"),
    write: read("settings.manage"),
  }

const patterns = nativeRoutes.map((route) => ({
  ...route,
  pattern: new RegExp(
    "^" +
      route.path
        .split("/")
        .map((segment) =>
          segment.startsWith(":")
            ? "[^/]+"
            : segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
        )
        .join("/") +
      "$",
    "i"
  ),
}))
const bootstrapReads = new Set([
  "/admin/stores",
  "/admin/users/me",
  "/admin/feature-flags",
  "/admin/plugins",
  "/admin/access/me",
])

export function normalizedPath(url: string): string | null {
  const raw = url.split("?")[0]
  // Express decodes parameter values. Reject encoded separators and ambiguous canonical forms.
  if (/%(?:2f|5c|2e|25)/i.test(raw) || raw.includes("\\") || raw.includes("//"))
    return null
  return raw.replace(/\/+$/, "").toLowerCase()
}

export function policyFor(method: string, path: string): Policy | null {
  const verb = method === "HEAD" ? "GET" : method
  if (verb === "GET" && bootstrapReads.has(path)) return read()
  if (verb === "GET" && path === "/admin/access/roles")
    return read("roles.view")
  if (verb === "GET" && /^\/admin\/access\/staff(?:\/[^/]+)?$/.test(path))
    return read("staff.view")
  if (
    (verb === "POST" && path === "/admin/access/invites") ||
    (verb === "DELETE" && /^\/admin\/access\/invites\/[^/]+$/.test(path)) ||
    (verb === "POST" && path === "/admin/access/roles") ||
    (["POST", "DELETE"].includes(verb) &&
      /^\/admin\/access\/roles\/[^/]+$/.test(path)) ||
    (["POST", "DELETE"].includes(verb) &&
      /^\/admin\/access\/staff\/[^/]+$/.test(path))
  ) {
    return { permissions: [], superuser: true }
  }
  if (path === "/admin/access/permissions" && verb === "GET")
    return read("roles.view")
  if (path === "/admin/access/audit" && verb === "GET")
    return read("audit.view")
  // No access to Enterprise APIs, arbitrary workflows, keys, generic search or exports by accident.
  if (
    /^\/admin\/(rbac|workflows|workflow-executions|api-keys|search|search-indexes)(\/|$)/.test(
      path
    )
  )
    return null
  const route = patterns.find(
    (r) => r.pattern.test(path) && r.methods.includes(verb)
  )
  if (!route) return null
  const resource = path.split("/")[2]
  if (resource === "users")
    return verb === "GET"
      ? { permissions: ["staff.view"], superuser: true }
      : null
  if (resource === "invites") return { permissions: [], superuser: true }
  const policies = resourcePolicies[resource]
  if (!policies) return null
  if (path.includes("/export"))
    return resource === "products"
      ? read("products.view", "prices.view", "products.export")
      : null
  if (verb === "GET") {
    return policies.read
  }
  if (/\/refund(?:\/|$)/.test(path)) return read("refunds.issue")
  if (path.includes("/cancel") && ["orders", "draft-orders"].includes(resource))
    return read("orders.cancel")
  if (resource === "products" || resource === "product-variants") {
    if (path.includes("/import"))
      return read(
        "products.import",
        "products.create",
        "products.edit",
        "prices.edit"
      )
    if (verb === "DELETE") return read("products.delete")
    if (path === "/admin/products") return read("products.create")
  }
  return policies.write
}

export function isBootstrapRead(method: string, path: string) {
  return ["GET", "HEAD"].includes(method) && bootstrapReads.has(path)
}

export function isSelfProfileUpdate(
  method: string,
  path: string,
  userId: string,
  body: unknown
): boolean {
  return (
    method === "POST" &&
    path === `/admin/users/${userId.toLowerCase()}` &&
    Boolean(body) &&
    typeof body === "object" &&
    !Array.isArray(body) &&
    Object.keys(body!).every((key) =>
      ["first_name", "last_name", "avatar_url"].includes(key)
    )
  )
}

export function can(
  principal: AccessPrincipal,
  policy: Policy,
  context: PermissionContext = {}
): boolean {
  return (
    principal.active &&
    (!policy.superuser || principal.is_superuser) &&
    policy.permissions.every((p) => evaluatePermission(principal, p, context))
  )
}

export function validateFieldSelection(
  resource: string,
  fields: unknown
): boolean {
  if (fields === undefined) return true
  if (typeof fields !== "string" || fields.length > 4000) return false
  const safe = (nativeFields as Record<string, string[]>)[resource] || []
  const extra: Record<string, string[]> = {
    // Narrow relation IDs requested by native Admin list/count screens.
    collections: ["products.id"],
    "customer-groups": ["customers.id"],
    // Native Admin requests these computed order summaries explicitly.
    orders: ["payment_status", "fulfillment_status"],
    products: [
      "*categories",
      "variants.id",
      "variants.inventory_quantity",
      "variants.inventory_items.inventory.location_levels",
      "variants.inventory_items.required_quantity",
    ],
    "product-variants": [
      "inventory_quantity",
      "product.id",
      "product.title",
      "product.handle",
      "product.status",
      "product.thumbnail",
      "product.metadata",
    ],
    users: ["id", "email", "first_name", "last_name", "avatar_url"],
  }
  const allowed = new Set([...safe, ...(extra[resource] || [])])
  return fields.split(",").every((value) => {
    const field = value.trim()
    const name = field.replace(/^[+-]/, "")
    // Native Admin also selects reviewed relations without the '*' prefix.
    return allowed.has(name) || allowed.has(`*${name}`)
  })
}

export function additionalWritePermissions(
  value: unknown,
  creating = false
): Permission[] {
  const needed = new Set<Permission>()
  const visit = (data: unknown, isCreate: boolean) => {
    if (!data || typeof data !== "object") return
    if (Array.isArray(data)) {
      data.forEach((item) => visit(item, isCreate))
      return
    }
    for (const [key, child] of Object.entries(data)) {
      if (key === "status" && (!isCreate || child !== "draft"))
        needed.add("products.publish")
      if (key === "delete") needed.add("products.delete")
      if (key === "create") needed.add("products.create")
      if (
        ["price", "prices", "price_set", "price_sets", "amount"].includes(key)
      )
        needed.add("prices.edit")
      if (key === "collection_id") needed.add("collections.manage")
      if (key === "categories" || key === "category_ids")
        needed.add("categories.manage")
      if (
        ["inventory_items", "inventory_quantity"].includes(key) ||
        (key === "manage_inventory" && (!isCreate || child !== true)) ||
        (key === "allow_backorder" && (!isCreate || child !== false))
      )
        needed.add("inventory.adjust")
      if (["images", "thumbnail"].includes(key)) needed.add("media.manage")
      // Traverse only native batch/variant envelopes, not arbitrary metadata.
      if (["variants", "create", "update"].includes(key))
        visit(child, key === "create" || (key === "variants" && isCreate))
    }
  }
  visit(value, creating)
  return [...needed]
}
