import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { inviteInput } from "../../../../lib/access/validators"
import { createAccessInviteWorkflow } from "../../../../workflows/access-invitations"

export async function POST(
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) {
  const { result } = await createAccessInviteWorkflow(req.scope).run({
    input: {
      ...inviteInput.parse(req.body),
      actor_id: req.auth_context.actor_id,
    },
  })
  res.status(200).json({ invite: result })
}
