import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { IUserModuleService } from "@medusajs/framework/types"
import { MedusaError, Modules } from "@medusajs/framework/utils"
import { ACCESS_CONTROL } from "../../../../modules/access-control"
import type AccessControlService from "../../../../modules/access-control/service"
import { acceptInviteQuery } from "../../../../lib/access/validators"
import { MANAGED_INVITE } from "../../../../workflows/access-invitations/steps"

export const AUTHENTICATE = false
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const { token } = acceptInviteQuery.parse(req.query)
  const invite = await req.scope
    .resolve<IUserModuleService>(Modules.USER)
    .validateInviteToken(token)
  const access = req.scope.resolve<AccessControlService>(ACCESS_CONTROL)
  let roles: { id: string; name: string }[] = []
  if (invite.metadata?.[MANAGED_INVITE]) {
    const [plan] = await access.invitationSummaries([invite.id])
    if (!plan || plan.status !== "pending" || plan.email !== invite.email)
      throw new MedusaError(
        MedusaError.Types.CONFLICT,
        "This invitation is no longer available"
      )
    const inviter = await access.principal(plan.actor_id)
    if (!inviter.active || !inviter.is_superuser)
      throw new MedusaError(
        MedusaError.Types.FORBIDDEN,
        "Ask a Superuser to reissue this invitation"
      )
    roles = plan.roles
  }
  res.setHeader("Cache-Control", "no-store")
  res.json({
    invite: { email: invite.email, expires_at: invite.expires_at, roles },
  })
}
