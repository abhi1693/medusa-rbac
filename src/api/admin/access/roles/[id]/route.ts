import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import type {
  IUserModuleService,
  ICustomerModuleService,
} from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils"
import { ACCESS_CONTROL } from "../../../../../modules/access-control"
import type AccessControlService from "../../../../../modules/access-control/service"
import {
  deleteRoleInput,
  updateRoleInput,
  type PageInput,
} from "../../../../../lib/access/validators"

export async function GET(
  req: AuthenticatedMedusaRequest<unknown, PageInput>,
  res: MedusaResponse
) {
  const access = req.scope.resolve<AccessControlService>(ACCESS_CONTROL)
  const detail = await access.roleDetail(req.params.id, req.validatedQuery)
  const principal = await access.principal(req.auth_context.actor_id)
  const context = await access.permissionContext(req)
  const labels = new Map<string, string>()
  const userIds = detail.actors
    .filter((actor) => actor.actor_type === "user")
    .map((actor) => actor.actor_id)
  if (userIds.length && access.allows(principal, "staff.view", context)) {
    const users = await req.scope
      .resolve<IUserModuleService>(Modules.USER)
      .listUsers(
        { id: userIds },
        { select: ["id", "email"], take: userIds.length }
      )
    users.forEach((user) => labels.set(`user:${user.id}`, user.email))
  }
  const customerIds = detail.actors
    .filter((actor) => actor.actor_type === "customer")
    .map((actor) => actor.actor_id)
  if (
    customerIds.length &&
    access.allows(principal, "customers.view", context)
  ) {
    const customers = await req.scope
      .resolve<ICustomerModuleService>(Modules.CUSTOMER)
      .listCustomers(
        { id: customerIds },
        { select: ["id", "email"], take: customerIds.length }
      )
    customers.forEach((customer) => {
      if (customer.email) labels.set(`customer:${customer.id}`, customer.email)
    })
  }
  res.json({
    ...detail,
    actors: detail.actors.map((actor) => ({
      ...actor,
      label: labels.get(`${actor.actor_type}:${actor.actor_id}`),
    })),
  })
}

export async function POST(
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) {
  const data = updateRoleInput.parse(req.body)
  const access = req.scope.resolve<AccessControlService>(ACCESS_CONTROL)
  res.json(
    await access.mutate(req.auth_context.actor_id, {
      kind: "update_role",
      id: req.params.id,
      name: data.name,
      permissions: access.validatePermissions(data.permissions),
      rules: data.rules as any,
      version: data.version,
    })
  )
}

export async function DELETE(
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) {
  const data = deleteRoleInput.parse(req.body)
  const access = req.scope.resolve<AccessControlService>(ACCESS_CONTROL)
  res.json(
    await access.mutate(req.auth_context.actor_id, {
      kind: "delete_role",
      id: req.params.id,
      version: data.version,
    })
  )
}
