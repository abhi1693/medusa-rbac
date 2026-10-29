import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { deleteAccessInviteWorkflow } from "../../../../../workflows/access-invitations"

export async function DELETE(
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) {
  const { result } = await deleteAccessInviteWorkflow(req.scope).run({
    input: { actor_id: req.auth_context.actor_id, invite_id: req.params.id },
  })
  res.json(result)
}
