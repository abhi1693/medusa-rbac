import type {
  MedusaContainer,
  IUserModuleService,
  IAuthModuleService,
  InviteDTO,
  UserDTO,
} from "@medusajs/framework/types"
import { Modules, MedusaError } from "@medusajs/framework/utils"
import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"
import { ACCESS_CONTROL } from "../../modules/access-control"
import type AccessControlService from "../../modules/access-control/service"

type Execution = { container: MedusaContainer }
export const MANAGED_INVITE = "rbac_access_managed"
export type CreateAccessInvite = {
  actor_id: string
  email: string
  role_ids: string[]
}
export type AcceptAccessInvite = {
  token: string
  auth_identity_id: string
  user: { email?: string; first_name?: string; last_name?: string }
}

export async function recordInvitation(
  input: CreateAccessInvite & { invite: InviteDTO },
  { container }: Execution
) {
  await container
    .resolve<AccessControlService>(ACCESS_CONTROL)
    .mutate(input.actor_id, {
      kind: "record_invite",
      invite_id: input.invite.id,
      email: input.invite.email,
      role_ids: input.role_ids,
    })
  return new StepResponse(input.invite)
}
export const recordInvitationStep = createStep(
  "medusa-rbac-record-invitation",
  recordInvitation
)

export async function validateInvitation(
  input: AcceptAccessInvite,
  { container }: Execution
) {
  const invite = await container
    .resolve<IUserModuleService>(Modules.USER)
    .validateInviteToken(input.token)
  if (
    input.user.email &&
    input.user.email.toLowerCase() !== invite.email.toLowerCase()
  )
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Use the invited email address"
    )
  const identity = await container
    .resolve<IAuthModuleService>(Modules.AUTH)
    .retrieveAuthIdentity(input.auth_identity_id, {
      relations: ["provider_identities"],
    })
  if (
    !identity.provider_identities?.some(
      (provider) =>
        provider.provider === "emailpass" &&
        provider.entity_id.toLowerCase() === invite.email.toLowerCase()
    )
  )
    throw new MedusaError(
      MedusaError.Types.FORBIDDEN,
      "Sign up with the invited email address"
    )
  const access = container.resolve<AccessControlService>(ACCESS_CONTROL)
  const invitation = invite.metadata?.[MANAGED_INVITE]
    ? await access.invitation(invite.id)
    : undefined
  if (
    invite.metadata?.[MANAGED_INVITE] &&
    (!invitation ||
      invitation.status !== "pending" ||
      invitation.email !== invite.email)
  )
    throw new MedusaError(
      MedusaError.Types.CONFLICT,
      "Invitation access is no longer pending"
    )
  return new StepResponse({ invite, actor_id: invitation?.actor_id })
}
export const validateInvitationStep = createStep(
  "medusa-rbac-validate-invitation",
  validateInvitation
)

export async function completeInvitation(
  input: { invite_id: string; actor_id?: string; user: UserDTO },
  { container }: Execution
) {
  if (input.actor_id)
    await container
      .resolve<AccessControlService>(ACCESS_CONTROL)
      .mutate(input.actor_id, {
        kind: "accept_invite",
        invite_id: input.invite_id,
        user_id: input.user.id,
      })
  return new StepResponse(input.user)
}
export const completeInvitationStep = createStep(
  "medusa-rbac-complete-invitation",
  completeInvitation
)

export async function cancelInvitation(
  input: { actor_id: string; invite_id: string; deleted?: unknown },
  { container }: Execution
) {
  const access = container.resolve<AccessControlService>(ACCESS_CONTROL)
  if (await access.invitation(input.invite_id))
    await access.mutate(input.actor_id, {
      kind: "cancel_invite",
      invite_id: input.invite_id,
    })
  return new StepResponse({
    id: input.invite_id,
    object: "invite" as const,
    deleted: true,
  })
}
export const cancelInvitationStep = createStep(
  "medusa-rbac-cancel-invitation",
  cancelInvitation
)
