import type { Permission } from "./permissions"

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
