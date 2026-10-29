import { model } from "@medusajs/framework/utils"

export default model.define("rbac_access_role", {
  id: model.id({ prefix: "uar" }).primaryKey(),
  key: model.text().unique(),
  name: model.text(),
  permissions: model.json(),
  rules: model.json().default([] as unknown as Record<string, unknown>),
  is_superuser: model.boolean().default(false),
  version: model.number().default(1),
})
