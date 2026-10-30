import type { ExecArgs } from "@medusajs/framework/types"
import { ACCESS_CONTROL } from "../modules/access-control"
import type AccessControlService from "../modules/access-control/service"

/** Run after native schema migrations; no users or assignments are created. */
export default async function syncConfiguredRoles({ container }: ExecArgs) {
  const access = container.resolve<AccessControlService>(ACCESS_CONTROL)
  const result = await access.syncConfiguredRoles()
  console.info(
    `Configured roles synchronized: ${result.created} created, ${result.updated} updated, ${result.revoked} revoked`
  )
}
