import type {
  MedusaRequest,
  MedusaResponse,
  MedusaNextFunction,
} from "@medusajs/framework/http"
import type { IUserModuleService } from "@medusajs/framework/types"
import { Modules, MedusaError } from "@medusajs/framework/utils"
import { MANAGED_INVITE } from "../../workflows/access-invitations/steps"

export async function protectManagedInvites(
  req: MedusaRequest,
  _res: MedusaResponse,
  next: MedusaNextFunction
) {
  try {
    const users = req.scope.resolve<IUserModuleService>(Modules.USER)
    const invite =
      req.method === "DELETE"
        ? await users.retrieveInvite(req.params.id)
        : await users.validateInviteToken(String(req.query.token))
    if (invite.metadata?.[MANAGED_INVITE])
      throw new MedusaError(
        MedusaError.Types.CONFLICT,
        "Use the invitation flow with role assignment"
      )
    next()
  } catch (error) {
    next(error)
  }
}
