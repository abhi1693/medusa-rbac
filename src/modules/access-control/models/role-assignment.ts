import { model } from "@medusajs/framework/utils"
import AccessRole from "./access-role"
import ActorAccess from "./actor-access"

export default model
  .define("rbac_role_assignment", {
    id: model.id({ prefix: "rbra" }).primaryKey(),
    access: model.belongsTo(() => ActorAccess),
    role: model.belongsTo(() => AccessRole),
  })
  .indexes([{ on: ["access_id", "role_id"], unique: true }])
