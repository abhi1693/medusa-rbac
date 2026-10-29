import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { ACCESS_CONTROL } from "../../../../../modules/access-control"
import type AccessControlService from "../../../../../modules/access-control/service"
import {
  deleteRoleInput,
  updateRoleInput,
} from "../../../../../lib/access/validators"

export async function POST(
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) {
  const data = updateRoleInput.parse(req.body)
  const access = req.scope.resolve<AccessControlService>(ACCESS_CONTROL)
  res.json(
    await access.mutate(req.auth_context.actor_id, {
      kind: "update_role",
      id: req.params.id,
      name: data.name,
      permissions: access.validatePermissions(data.permissions),
      rules: data.rules as any,
      version: data.version,
    })
  )
}

export async function DELETE(
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) {
  const data = deleteRoleInput.parse(req.body)
  const access = req.scope.resolve<AccessControlService>(ACCESS_CONTROL)
  res.json(
    await access.mutate(req.auth_context.actor_id, {
      kind: "delete_role",
      id: req.params.id,
      version: data.version,
    })
  )
}
