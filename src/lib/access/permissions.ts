import type { PermissionRule } from "./config"
export const PERMISSIONS = [
  ["staff.view", "View staff", "Access"],
  ["roles.view", "View roles", "Access"],
  ["audit.view", "View access audit history", "Access"],
  ["products.view", "View products and variants", "Catalog"],
  ["products.create", "Create draft products", "Catalog"],
  ["products.edit", "Edit products", "Catalog"],
  ["products.publish", "Publish products", "Catalog"],
  ["products.delete", "Delete products", "Catalog"],
  ["products.import", "Import products", "Catalog"],
  ["products.export", "Export products", "Catalog"],
  ["prices.view", "View prices", "Catalog"],
  ["prices.edit", "Manage prices", "Catalog"],
  ["categories.view", "View categories", "Catalog"],
  ["categories.manage", "Manage categories", "Catalog"],
  ["collections.view", "View collections", "Catalog"],
  ["collections.manage", "Manage collections", "Catalog"],
  ["product_options.manage", "Manage options, types and tags", "Catalog"],
  ["media.manage", "Manage uploads", "Catalog"],
  ["inventory.view", "View stock and reservations", "Inventory"],
  ["inventory.adjust", "Adjust stock and reservations", "Inventory"],
  ["stock_locations.view", "View stock locations", "Inventory"],
  ["stock_locations.manage", "Manage stock locations", "Inventory"],
  ["orders.view", "View orders", "Orders"],
  ["orders.manage", "Process orders, returns and exchanges", "Orders"],
  ["orders.cancel", "Cancel orders", "Orders"],
  ["customers.view", "View customers and addresses", "Customers"],
  ["customers.manage", "Manage customers", "Customers"],
  ["payments.view", "View payments", "Finance"],
  ["payments.capture", "Capture payments", "Finance"],
  ["refunds.issue", "Issue refunds", "Finance"],
  ["promotions.view", "View promotions", "Marketing"],
  ["promotions.manage", "Manage promotions", "Marketing"],
  ["settings.view", "View commerce settings", "Settings"],
  ["settings.manage", "Manage commerce settings", "Settings"],
] as const

export type Permission = string
export const PERMISSION_IDS: readonly Permission[] = PERMISSIONS.map(
  ([id]) => id
)

export function validatePermissions(
  values: unknown,
  ids: readonly string[] = PERMISSION_IDS
): Permission[] {
  const known = new Set(ids)
  if (
    !Array.isArray(values) ||
    values.some((p) => typeof p !== "string" || !known.has(p))
  ) {
    throw new Error(
      "Permissions must contain only supported permission identifiers"
    )
  }
  return [...new Set(values)] as Permission[]
}

export type AccessPrincipal = {
  actor_id: string
  actor_type: string
  active: boolean
  is_superuser: boolean
  role_ids: string[]
  permissions: Permission[]
  rules?: PermissionRule[]
}
