import {
  createWorkflow,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import { removeUserAccountWorkflow } from "@medusajs/medusa/core-flows"
import { prepareUserDeletionStep, finishUserDeletionStep } from "./steps"

export const deleteStaffUserWorkflow = createWorkflow(
  "medusa-rbac-delete-staff-user",
  (input: { actor_id: string; user_id: string }) => {
    const deletion = prepareUserDeletionStep(input)
    const userId = removeUserAccountWorkflow.runAsStep({
      input: { userId: deletion.user_id },
    })
    const result = finishUserDeletionStep({ deletion, user_id: userId })
    return new WorkflowResponse(result)
  }
)
