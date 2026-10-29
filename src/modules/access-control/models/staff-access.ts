import { model } from "@medusajs/framework/utils"

export default model.define("rbac_staff_access", {
  id: model.id({ prefix: "rbas" }).primaryKey(),
  user_id: model.text().unique(),
  active: model.boolean().default(true),
  version: model.number().default(1),
})
