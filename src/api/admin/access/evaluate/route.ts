import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { ACCESS_CONTROL } from "../../../../modules/access-control"
import type AccessControlService from "../../../../modules/access-control/service"
import { evaluateInput } from "../../../../lib/access/validators"
import { explainPermission } from "../../../../lib/access/explain"

export async function POST(
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) {
  const data = evaluateInput.parse(req.body)
  const access = req.scope.resolve<AccessControlService>(ACCESS_CONTROL)
  access.validatePermissions([data.permission])
  const actor = { type: data.actor_type, id: data.actor_id }
  await access.validateActor(actor, req)
  const principal = await access.actorPrincipal(actor)
  const context = {
    ...data.context,
    actor_id: actor.id,
    actor_type: actor.type,
  }
  res.setHeader("Cache-Control", "no-store")
  res.json({
    actor,
    permission: data.permission,
    context,
    decision: explainPermission(principal, data.permission, context),
  })
}
