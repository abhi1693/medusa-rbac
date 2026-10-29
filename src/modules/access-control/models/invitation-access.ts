import { model } from "@medusajs/framework/utils"

export default model.define("rbac_invitation_access", {
  id: model.id({ prefix: "uia" }).primaryKey(),
  invite_id: model.text().unique(),
  email: model.text(),
  actor_id: model.text(),
  user_id: model.text().nullable(),
  status: model.enum(["pending", "accepted", "cancelled"]).default("pending"),
})
