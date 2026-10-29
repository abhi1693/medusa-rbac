import { model } from "@medusajs/framework/utils"
import AccessRole from "./access-role"
import StaffAccess from "./staff-access"

export default model
  .define("rbac_role_assignment", {
    id: model.id({ prefix: "rbra" }).primaryKey(),
    staff: model.belongsTo(() => StaffAccess),
    role: model.belongsTo(() => AccessRole),
  })
  .indexes([{ on: ["staff_id", "role_id"], unique: true }])
