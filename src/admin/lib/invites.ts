import type { HttpTypes } from "@medusajs/framework/types"
import { sdk } from "./access"

export function createAccessInvite(payload: HttpTypes.AdminCreateInvite) {
  return sdk.client.fetch<HttpTypes.AdminInviteResponse>(
    "/admin/access/invites",
    {
      method: "POST",
      body: { email: payload.email, role_ids: payload.roles || [] },
    }
  )
}
export function deleteAccessInvite(id: string) {
  return sdk.client.fetch<HttpTypes.AdminInviteDeleteResponse>(
    `/admin/access/invites/${id}`,
    { method: "DELETE" }
  )
}
export function acceptAccessInvite(
  token: string,
  payload: HttpTypes.AdminAcceptInvite & { auth_token: string }
) {
  const { auth_token, ...body } = payload
  return sdk.client.fetch<HttpTypes.AdminAcceptInviteResponse>(
    "/access/invites/accept",
    {
      method: "POST",
      query: { token },
      body,
      headers: { Authorization: `Bearer ${auth_token}` },
    }
  )
}
