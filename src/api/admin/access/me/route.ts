import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { ACCESS_CONTROL } from "../../../../modules/access-control"
import type AccessControlService from "../../../../modules/access-control/service"

export async function GET(
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) {
  const access = req.scope.resolve<AccessControlService>(ACCESS_CONTROL)
  res.setHeader("Cache-Control", "no-store")
  const principal = await access.principal(req.auth_context.actor_id)
  const roles = principal.role_ids.length
    ? await access.listAccessRoles(
        { id: principal.role_ids },
        { select: ["id", "name"], take: principal.role_ids.length }
      )
    : []
  res.json({
    access: principal,
    permission_catalog: access
      .permissionDefinitions()
      .map(([id, label, group]) => ({ id, label, group })),
    roles: roles.map(({ id, name }) => ({ id, name })),
  })
}
