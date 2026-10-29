import { model } from "@medusajs/framework/utils"

export default model.define("rbac_access_audit", {
  id: model.id({ prefix: "uaa" }).primaryKey(),
  actor_id: model.text(),
  action: model.text(),
  target_id: model.text(),
  detail: model.json(),
})
