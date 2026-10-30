import { evaluatePermission, type PermissionContext } from "./config"
import nativeFields from "./native-fields.json"
import type { Permission, AccessPrincipal } from "./permissions"
import { canonicalPath } from "./route-facts"
import { describeNative } from "./native-resources"
export { additionalWritePermissions } from "./write-permissions"

export type Policy = { permissions: Permission[]; superuser?: boolean }

export function normalizedPath(url: string): string | null {
  return canonicalPath(url)?.toLowerCase() ?? null
}

/** Structural inspection; request body, scope and payload grants require resolveRequest. */
export function policyFor(method: string, path: string): Policy | null {
  return describeNative(method, path, {})?.policy || null
}

export function isBootstrapRead(method: string, path: string) {
  return (
    ["GET", "HEAD"].includes(method) &&
    ["authenticated", "public"].includes(
      describeNative(method, path)?.access || ""
    )
  )
}

export function isSelfProfileUpdate(
  method: string,
  path: string,
  userId: string,
  body: unknown
): boolean {
  const descriptor = describeNative(method, path, body, userId)
  return Boolean(descriptor?.self)
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
  fields: unknown,
  override?: readonly string[]
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
      // Dashboard's native product detail also expands this linked profile.
      "*shipping_profile",
      "variants.id",
      "variants.inventory_quantity",
      "variants.inventory_items.inventory.location_levels",
      "variants.inventory_items.required_quantity",
    ],
    "product-variants": [
      "inventory_quantity",
      // Reviewed native Variant table/detail expansions. Inventory grants are
      // checked separately by the Admin middleware.
      "*inventory_items",
      "*inventory_items.inventory",
      "*inventory_items.inventory.location_levels",
      "*options.option",
      "*prices.price_rules",
      "images.id",
      "images.url",
      "images.variants.id",
      "product.id",
      "product.title",
      "product.handle",
      "product.status",
      "product.thumbnail",
      "product.metadata",
    ],
    users: ["id", "email", "first_name", "last_name", "avatar_url"],
    // Layout list query configuration lives below configurations/query-config.
    layouts: [
      "id",
      "zone",
      "user_id",
      "is_system_default",
      "configuration",
      "created_at",
      "updated_at",
    ],
  }
  const allowed = new Set(override || [...safe, ...(extra[resource] || [])])
  return fields.split(",").every((value) => {
    const field = value.trim()
    const name = field.replace(/^[+-]/, "")
    // Native Admin also selects reviewed relations without the '*' prefix.
    return allowed.has(name) || allowed.has(`*${name}`)
  })
}
