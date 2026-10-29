import { model } from "@medusajs/framework/utils"
import InvitationAccess from "./invitation-access"
import AccessRole from "./access-role"

export default model
  .define("rbac_invitation_role", {
    id: model.id({ prefix: "rbir" }).primaryKey(),
    invitation: model.belongsTo(() => InvitationAccess),
    role: model.belongsTo(() => AccessRole),
  })
  .indexes([{ on: ["invitation_id", "role_id"], unique: true }])
