import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ACCESS_CONTROL } from "../../../../../modules/access-control"
import type AccessControlService from "../../../../../modules/access-control/service"
import type { ActorAccessSummary } from "../../../../../lib/access/summary"

export const AUTHENTICATE = false
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const access = req.scope.resolve<AccessControlService>(ACCESS_CONTROL)
  const principal = await access.principalForRequest(req)
  if (!principal)
    return res
      .status(401)
      .json({ message: "An authenticated actor is required" })
  const roles = principal.role_ids.length
    ? await access.listAccessRoles(
        { id: principal.role_ids },
        { select: ["id", "name"], take: principal.role_ids.length }
      )
    : []
  const summary: ActorAccessSummary = {
    actor: {
      id: principal.actor_id,
      type: principal.actor_type,
      active: principal.active,
    },
    roles: roles.map(({ id, name }) => ({ id, name })),
    permission_candidates: access.permissionCandidates(principal),
  }
  res.setHeader("Cache-Control", "no-store")
  res.json(summary)
}
