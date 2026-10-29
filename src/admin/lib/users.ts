import type { HttpTypes } from "@medusajs/framework/types"
import { sdk } from "./access"

export function deleteStaffUser(id: string) {
  return sdk.client.fetch<HttpTypes.AdminUserDeleteResponse>(
    `/admin/access/staff/${id}`,
    { method: "DELETE" }
  )
}
