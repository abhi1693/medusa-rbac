import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
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
  const [page, count] = await users.listAndCountUsers(q ? { q } : {}, {
    skip: offset,
    take: limit,
    select: ["id", "email", "first_name", "last_name"],
  })
  const access = req.scope.resolve<AccessControlService>(ACCESS_CONTROL)
  const { staff, roles } = await access.snapshot(page.map((user) => user.id))
  res.json({
    staff: page.map((user) => {
      const assigned = staff.find((entry) => entry.user_id === user.id)
      return {
        ...user,
        roles: roles
          .filter((role) => assigned?.role_ids.includes(role.id))
          .map(({ id, name }) => ({ id, name })),
        access: assigned || { active: false, role_ids: [], version: 0 },
      }
    }),
    count,
    offset,
    limit,
  })
}
