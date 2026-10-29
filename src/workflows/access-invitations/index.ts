import {
  createWorkflow,
  WorkflowResponse,
  parallelize,
} from "@medusajs/framework/workflows-sdk"
import { InviteWorkflowEvents } from "@medusajs/framework/utils"
import {
  createInvitesWorkflow,
  createUsersWorkflow,
  deleteInvitesStep,
  emitEventStep,
  deleteInvitesWorkflow,
} from "@medusajs/medusa/core-flows"
import {
  MANAGED_INVITE,
  recordInvitationStep,
  validateInvitationStep,
  bindInvitationIdentityStep,
  completeInvitationStep,
  cancelInvitationStep,
  type CreateAccessInvite,
  type AcceptAccessInvite,
} from "./steps"

export const createAccessInviteWorkflow = createWorkflow(
  "medusa-rbac-create-access-invite",
  (input: CreateAccessInvite) => {
    const invites = createInvitesWorkflow.runAsStep({
      input: {
        invites: [{ email: input.email, metadata: { [MANAGED_INVITE]: true } }],
      },
    })
    const invite = recordInvitationStep({
      actor_id: input.actor_id,
      email: input.email,
      role_ids: input.role_ids,
      invite: invites[0],
    })
    return new WorkflowResponse(invite)
  }
)

export const acceptAccessInviteWorkflow = createWorkflow(
  "medusa-rbac-accept-access-invite",
  (input: AcceptAccessInvite) => {
    const validated = validateInvitationStep(input)
    const users = createUsersWorkflow.runAsStep({
      input: {
        users: [
          {
            email: validated.invite.email,
            first_name: input.user.first_name,
            last_name: input.user.last_name,
          },
        ],
      },
    })
    const [user, deleted, event] = parallelize(
      bindInvitationIdentityStep({
        auth_identity_id: input.auth_identity_id,
        user: users[0],
      }),
      deleteInvitesStep([validated.invite.id]),
      emitEventStep({
        eventName: InviteWorkflowEvents.ACCEPTED,
        data: { id: validated.invite.id },
      })
    )
    const completed = completeInvitationStep({
      invite_id: validated.invite.id,
      actor_id: validated.actor_id,
      user,
      preparation: { deleted, event },
    })
    return new WorkflowResponse(completed)
  }
)

export const deleteAccessInviteWorkflow = createWorkflow(
  "medusa-rbac-delete-access-invite",
  (input: { actor_id: string; invite_id: string }) => {
    const deleted = deleteInvitesWorkflow.runAsStep({
      input: { ids: [input.invite_id] },
    })
    const result = cancelInvitationStep({
      actor_id: input.actor_id,
      invite_id: input.invite_id,
      deleted,
    })
    return new WorkflowResponse(result)
  }
)
