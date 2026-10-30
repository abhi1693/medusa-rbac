import type { MedusaRequest } from "@medusajs/framework/http"

export type ActorOption = {
  id: string
  label: string
  description?: string
}

export type ActorListQuery = {
  q?: string
  id?: string
  offset: number
  limit: number
}

export type ActorListResult = {
  actors: ActorOption[]
  count: number
}

export type ActorProvider = {
  type: string
  validate: (id: string, request: MedusaRequest) => Promise<void>
  /** Search only this provider's actors, including exact-id selection hydration. */
  list?: (
    query: ActorListQuery,
    request: MedusaRequest
  ) => Promise<ActorListResult>
}
