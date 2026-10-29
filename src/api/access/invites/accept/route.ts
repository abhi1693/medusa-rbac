import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import {
  acceptInviteInput,
  acceptInviteQuery,
} from "../../../../lib/access/validators"
import { acceptAccessInviteWorkflow } from "../../../../workflows/access-invitations"

export const AUTHENTICATE = false
export async function POST(
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) {
  if (req.auth_context.actor_id)
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Sign out before accepting an invitation"
    )
  const { token } = acceptInviteQuery.parse(req.query)
  const { result } = await acceptAccessInviteWorkflow(req.scope).run({
    input: {
      token,
      auth_identity_id: req.auth_context.auth_identity_id,
      user: acceptInviteInput.parse(req.body),
    },
  })
  res.json({ user: result })
}
