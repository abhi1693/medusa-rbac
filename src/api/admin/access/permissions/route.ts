import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ACCESS_CONTROL } from "../../../../modules/access-control"
import type AccessControlService from "../../../../modules/access-control/service"
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const access = req.scope.resolve<AccessControlService>(ACCESS_CONTROL)
  res.json({
    permissions: access
      .permissionDefinitions()
      .map(([id, label, group]) => ({ id, label, group })),
  })
}
