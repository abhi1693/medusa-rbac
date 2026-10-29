import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { ACCESS_CONTROL } from "../../../../modules/access-control"
import type AccessControlService from "../../../../modules/access-control/service"
import { roleInput } from "../../../../lib/access/validators"

export async function GET(
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) {
  const access = req.scope.resolve<AccessControlService>(ACCESS_CONTROL)
  const { roles } = await access.snapshot()
  res.json({ roles })
}

export async function POST(
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) {
  const data = roleInput.parse(req.body)
  const access = req.scope.resolve<AccessControlService>(ACCESS_CONTROL)
  res.status(201).json(
    await access.mutate(req.auth_context.actor_id, {
      kind: "create_role",
      name: data.name,
      permissions: access.validatePermissions(data.permissions),
      rules: data.rules as any,
    })
  )
}
