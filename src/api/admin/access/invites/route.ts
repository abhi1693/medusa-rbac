import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { inviteInput } from "../../../../lib/access/validators"
import { createAccessInviteWorkflow } from "../../../../workflows/access-invitations"
import type { IUserModuleService } from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils"
import { ACCESS_CONTROL } from "../../../../modules/access-control"
import type AccessControlService from "../../../../modules/access-control/service"
import type { StaffPageInput } from "../../../../lib/access/validators"

export async function GET(
  req: AuthenticatedMedusaRequest<unknown, StaffPageInput>,
  res: MedusaResponse
) {
  const { offset, limit, q } = req.validatedQuery
  const users = req.scope.resolve<IUserModuleService>(Modules.USER)
  const [invites, count] = await users.listAndCountInvites(q ? { q } : {}, {
    skip: offset,
    take: limit,
    order: { created_at: "DESC" },
    select: ["id", "email", "token", "expires_at", "created_at", "metadata"],
  })
  const access = req.scope.resolve<AccessControlService>(ACCESS_CONTROL)
  const plans = await access.invitationSummaries(
    invites.map((invite) => invite.id)
  )
  res.json({
    invitations: invites.map(({ metadata: _metadata, ...invite }) => {
      const plan = plans.find((plan) => plan.invite_id === invite.id)
      return {
        ...invite,
        roles: plan?.roles || [],
        role_ids: plan?.role_ids || [],
      }
    }),
    count,
    offset,
    limit,
  })
}

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
