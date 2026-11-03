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
    // Dashboard 2.22.2 customer detail loads the native addresses relation.
    customers: ["*addresses"],
    // Native settings and taxonomy detail components select these named links.
    regions: ["*payment_providers"],
    "product-categories": ["products.id"],
    "product-options": ["values.id", "values.value", "values.rank"],
    "stock-locations": [
      "*sales_channels",
      "*address",
      "*fulfillment_sets",
      "*fulfillment_sets.service_zones",
      "*fulfillment_sets.service_zones.shipping_options",
      "*fulfillment_sets.service_zones.shipping_options.shipping_profile",
      "fulfillment_sets.type",
      "fulfillment_sets.name",
      "*fulfillment_sets.service_zones.geo_zones",
      "*fulfillment_sets.service_zones.shipping_options.rules",
      "*fulfillment_providers",
    ],
    // Native Admin requests these computed order summaries explicitly.
    orders: [
      "payment_status",
      "fulfillment_status",
      // The customer detail order table displays the shipping country.
      "shipping_address.country_code",
      "item_discount_total",
      "discount_subtotal",
      "shipping_discount_total",
      "refundable_total",
      "order_change",
      "*items.variant.options",
      "items.variant.manage_inventory",
      "*items.variant.inventory_items.inventory",
      "items.variant.inventory_items.required_quantity",
      "*promotions",
      "fulfillments.shipping_option.service_zone.fulfillment_set.type",
      "*fulfillments.items",
      "*fulfillments.labels",
      "*payment_collections.payment_sessions",
      "*payment_collections.payments.refunds.refund_reason",
      "region.automatic_taxes",
    ],
    products: [
      "*categories",
      // Dashboard's native product detail also expands this linked profile.
      "*shipping_profile",
      "variants.id",
      "variants.inventory_quantity",
      "variants.inventory_items.inventory.location_levels",
      "variants.inventory_items.required_quantity",
    ],
    // Dashboard 2.22.2 inventory-detail/constants.ts requests these linked data.
    // Inventory reads already require product, price and stock-location access.
    "inventory-items": [
      "*variants",
      "*variants.product",
      "*variants.options",
      // The location-level table selects only these related location fields.
      "stock_locations.id",
      "stock_locations.name",
    ],
    "product-variants": [
      "inventory_quantity",
      "inventory_items.*",
      "inventory_items.inventory.id",
      "inventory_items.inventory.title",
      "inventory_items.inventory.sku",
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
    // The option detail excludes the products relation; adding it remains denied.
    if (!override && resource === "product-options" && field === "-products")
      return true
    const name = field.replace(/^[+-]/, "")
    // Native Admin also selects reviewed relations without the '*' prefix.
    return allowed.has(name) || allowed.has(`*${name}`)
  })
}
