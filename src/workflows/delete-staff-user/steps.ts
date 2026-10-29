import type {
  IUserModuleService,
  MedusaContainer,
} from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils"
import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"
import { ACCESS_CONTROL } from "../../modules/access-control"
import type AccessControlService from "../../modules/access-control/service"
import type { UserDeletion } from "../../modules/access-control/service"

type Execution = { container: MedusaContainer }
export async function prepareUserDeletion(
  input: { actor_id: string; user_id: string },
  { container }: Execution
) {
  await container
    .resolve<IUserModuleService>(Modules.USER)
    .retrieveUser(input.user_id, { select: ["id"] })
  const deletion = await container
    .resolve<AccessControlService>(ACCESS_CONTROL)
    .prepareUserDeletion(input.actor_id, input.user_id)
  return new StepResponse(deletion)
}
export async function restoreUserAccess(
  deletion: UserDeletion | undefined,
  { container }: Execution
) {
  if (deletion)
    await container
      .resolve<AccessControlService>(ACCESS_CONTROL)
      .settleUserDeletion(deletion, "restore")
}
export const prepareUserDeletionStep = createStep(
  "medusa-rbac-prepare-user-deletion",
  prepareUserDeletion,
  restoreUserAccess
)

export async function finishUserDeletion(
  input: { deletion: UserDeletion; user_id: string },
  { container }: Execution
) {
  await container
    .resolve<AccessControlService>(ACCESS_CONTROL)
    .settleUserDeletion(input.deletion, "deleted")
  return new StepResponse({
    id: input.user_id,
    object: "user" as const,
    deleted: true,
  })
}
export const finishUserDeletionStep = createStep(
  "medusa-rbac-finish-user-deletion",
  finishUserDeletion
)
