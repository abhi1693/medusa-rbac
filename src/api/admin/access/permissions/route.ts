import { SUPERUSER_AUTHORITY } from "../../../../lib/access/permissions"
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ACCESS_CONTROL } from "../../../../modules/access-control"
import type AccessControlService from "../../../../modules/access-control/service"
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const access = req.scope.resolve<AccessControlService>(ACCESS_CONTROL)
  res.setHeader("Cache-Control", "no-store")
  res.json({
    superuser_authority: SUPERUSER_AUTHORITY,
    actor_types: [
      "user",
      "customer",
      ...access.configuration.actors.map((actor) => actor.type),
    ],
    permissions: access
      .permissionDefinitions()
      .map(([id, label, group]) => ({ id, label, group })),
  })
}
