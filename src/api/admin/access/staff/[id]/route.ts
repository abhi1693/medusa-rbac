import { deleteStaffUserWorkflow } from "../../../../../workflows/delete-staff-user"
import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import type { IUserModuleService } from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils"
import { ACCESS_CONTROL } from "../../../../../modules/access-control"
import type AccessControlService from "../../../../../modules/access-control/service"
import { staffInput } from "../../../../../lib/access/validators"

export async function POST(
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) {
  const data = staffInput.parse(req.body)
  const users = req.scope.resolve<IUserModuleService>(Modules.USER)
  // User existence belongs to the core User module, not the access module's database.
  await users.retrieveUser(req.params.id)
  const access = req.scope.resolve<AccessControlService>(ACCESS_CONTROL)
  res.json(
    await access.mutate(req.auth_context.actor_id, {
      kind: "set_staff",
      user_id: req.params.id,
      ...data,
    })
  )
}

export async function GET(
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) {
  const users = req.scope.resolve<IUserModuleService>(Modules.USER)
  const user = await users.retrieveUser(req.params.id, {
    select: ["id", "email", "first_name", "last_name"],
  })
  const access = req.scope.resolve<AccessControlService>(ACCESS_CONTROL)
  const snapshot = await access.snapshot([user.id])
  res.json({
    staff: {
      ...user,
      access: snapshot.staff[0] || { active: false, role_ids: [], version: 0 },
    },
  })
}

export async function DELETE(
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) {
  const { result } = await deleteStaffUserWorkflow(req.scope).run({
    input: { actor_id: req.auth_context.actor_id, user_id: req.params.id },
  })
  res.json(result)
}
