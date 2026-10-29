import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import type { IUserModuleService } from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils"
import { ACCESS_CONTROL } from "../../../../modules/access-control"
import type AccessControlService from "../../../../modules/access-control/service"
import type { PageInput } from "../../../../lib/access/validators"

export async function GET(
  req: AuthenticatedMedusaRequest<unknown, PageInput>,
  res: MedusaResponse
) {
  const page = req.validatedQuery
  const access = req.scope.resolve<AccessControlService>(ACCESS_CONTROL)
  const result = await access.auditPage(page.offset, page.limit)
  const ids = [
    ...new Set<string>(
      result.events.flatMap((event) => [event.actor_id, event.target_id])
    ),
  ]
  const users = ids.length
    ? await req.scope
        .resolve<IUserModuleService>(Modules.USER)
        .listUsers(
          { id: ids },
          { select: ["id", "email"], withDeleted: true, take: ids.length }
        )
    : []
  const roles = ids.length
    ? await access.listAccessRoles(
        { id: ids },
        { select: ["id", "name"], withDeleted: true, take: ids.length }
      )
    : []
  const userNames = new Map(users.map((user) => [user.id, user.email]))
  const roleNames = new Map(roles.map((role) => [role.id, role.name]))
  res.json({
    ...result,
    events: result.events.map((event) => {
      const detail = event.detail as {
        before?: { name?: string; email?: string }
        after?: { name?: string; email?: string }
      } | null
      return {
        ...event,
        actor_label: userNames.get(event.actor_id) || "Unknown user",
        target_label:
          userNames.get(event.target_id) ||
          detail?.after?.name ||
          detail?.before?.name ||
          roleNames.get(event.target_id) ||
          detail?.after?.email ||
          detail?.before?.email ||
          "Removed item",
      }
    }),
  })
}
