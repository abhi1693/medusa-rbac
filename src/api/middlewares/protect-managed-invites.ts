import type {
  MedusaRequest,
  MedusaResponse,
  MedusaNextFunction,
} from "@medusajs/framework/http"
import type { InviteDTO, IUserModuleService } from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils"
import { MANAGED_INVITE } from "../../workflows/access-invitations/steps"
import { acceptInviteQuery } from "../../lib/access/validators"

export async function protectManagedInvites(
  req: MedusaRequest,
  res: MedusaResponse,
  next: MedusaNextFunction
) {
  try {
    const users = req.scope.resolve<IUserModuleService>(Modules.USER)
    let invite: InviteDTO
    let destination: string
    if (req.method === "DELETE") {
      invite = await users.retrieveInvite(req.params.id)
      destination = `/admin/access/invites/${encodeURIComponent(invite.id)}`
    } else {
      const { token } = acceptInviteQuery.parse({ token: req.query.token })
      invite = await users.validateInviteToken(token)
      destination = `/access/invites/accept?token=${encodeURIComponent(token)}`
    }
    if (invite.metadata?.[MANAGED_INVITE]) {
      res.setHeader("Cache-Control", "no-store")
      return res.redirect(307, destination)
    }
    next()
  } catch (error) {
    next(error)
  }
}
