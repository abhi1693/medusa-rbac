import { model } from "@medusajs/framework/utils"
export default model
  .define("rbac_actor_access", {
    id: model.id({ prefix: "rbas" }).primaryKey(),
    actor_type: model.text(),
    actor_id: model.text(),
    active: model.boolean().default(true),
    version: model.number().default(1),
  })
  .indexes([{ on: ["actor_type", "actor_id"], unique: true }])
