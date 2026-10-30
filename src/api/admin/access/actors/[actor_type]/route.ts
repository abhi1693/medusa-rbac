import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import type {
  IUserModuleService,
  ICustomerModuleService,
} from "@medusajs/framework/types"
import { MedusaError, Modules } from "@medusajs/framework/utils"
import { ACCESS_CONTROL } from "../../../../../modules/access-control"
import type AccessControlService from "../../../../../modules/access-control/service"
import {
  actorPageInput,
  type ActorPageInput,
} from "../../../../../lib/access/validators"
import type {
  ActorListResult,
  ActorOption,
} from "../../../../../lib/access/actors"

function nativeOption(actor: {
  id: string
  email?: string | null
  first_name?: string | null
  last_name?: string | null
}): ActorOption {
  const name = [actor.first_name, actor.last_name]
    .filter(Boolean)
    .join(" ")
    .trim()
  const label = name || actor.email || actor.id
  const description =
    actor.email && actor.email !== label
      ? actor.email
      : label !== actor.id
        ? actor.id
        : undefined
  return { id: actor.id, label, ...(description ? { description } : {}) }
}

function providerResult(
  value: unknown,
  offset: number,
  limit: number,
  id?: string
): ActorListResult {
  const result = value as ActorListResult | null
  const invalid = () => {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "The actor provider returned an invalid search result"
    )
  }
  if (
    !result ||
    !Array.isArray(result.actors) ||
    result.actors.length > limit ||
    !Number.isSafeInteger(result.count) ||
    result.count < result.actors.length ||
    (result.actors.length > 0 &&
      result.count < offset + result.actors.length) ||
    (id && result.count > 1)
  )
    invalid()
  const ids = new Set<string>()
  const actors = result!.actors.map((actor) => {
    if (
      !actor ||
      typeof actor !== "object" ||
      Array.isArray(actor) ||
      typeof actor.id !== "string" ||
      !actor.id.trim() ||
      actor.id.length > 100 ||
      (id && actor.id !== id) ||
      ids.has(actor.id) ||
      typeof actor.label !== "string" ||
      !actor.label.trim() ||
      actor.label.length > 500 ||
      (actor.description !== undefined &&
        (typeof actor.description !== "string" ||
          actor.description.length > 1000))
    )
      invalid()
    ids.add(actor.id)
    return {
      id: actor.id,
      label: actor.label,
      ...(actor.description !== undefined
        ? { description: actor.description }
        : {}),
    }
  })
  return { actors, count: result!.count }
}

export async function GET(
  req: AuthenticatedMedusaRequest<unknown, ActorPageInput>,
  res: MedusaResponse
) {
  const { q, id, offset, limit } = actorPageInput.parse(req.validatedQuery)
  const filters = { ...(q ? { q } : {}), ...(id ? { id } : {}) }
  const config = {
    skip: offset,
    take: limit,
    select: ["id", "email", "first_name", "last_name"] as (
      "id" | "email" | "first_name" | "last_name"
    )[],
    order: { id: "ASC" as const },
  }
  let result: ActorListResult
  if (req.params.actor_type === "user") {
    const [actors, count] = await req.scope
      .resolve<IUserModuleService>(Modules.USER)
      .listAndCountUsers(filters, config)
    result = { actors: actors.map(nativeOption), count }
  } else if (req.params.actor_type === "customer") {
    const [actors, count] = await req.scope
      .resolve<ICustomerModuleService>(Modules.CUSTOMER)
      .listAndCountCustomers(filters, config)
    result = { actors: actors.map(nativeOption), count }
  } else {
    const access = req.scope.resolve<AccessControlService>(ACCESS_CONTROL)
    const provider = access.configuration.actors.find(
      (actor) => actor.type === req.params.actor_type
    )
    if (!provider)
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Unknown actor type"
      )
    if (!provider.list)
      throw new MedusaError(
        MedusaError.Types.NOT_ALLOWED,
        `Account search is not configured for actor type '${provider.type}'`
      )
    result = providerResult(
      await provider.list({ q, id, offset, limit }, req),
      offset,
      limit,
      id
    )
  }
  res.setHeader("Cache-Control", "no-store")
  res.json({ ...result, offset, limit })
}
