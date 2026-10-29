import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { ACCESS_CONTROL } from "../../../../../../modules/access-control"
import type AccessControlService from "../../../../../../modules/access-control/service"
import { staffInput } from "../../../../../../lib/access/validators"
export async function GET(
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) {
  const access = req.scope.resolve<AccessControlService>(ACCESS_CONTROL)
  const actor = { type: req.params.actor_type, id: req.params.id }
  await access.validateActor(actor, req)
  res.json({ access: await access.actorAccess(actor) })
}
export async function POST(
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) {
  const access = req.scope.resolve<AccessControlService>(ACCESS_CONTROL)
  const actor = { type: req.params.actor_type, id: req.params.id }
  const data = staffInput.parse(req.body)
  await access.validateActor(actor, req)
  res.json(
    await access.mutate(req.auth_context.actor_id, {
      kind: "set_actor",
      actor,
      ...data,
    })
  )
}
