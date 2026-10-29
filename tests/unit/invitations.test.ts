import { it, expect, vi } from "vitest"
import { Modules } from "@medusajs/framework/utils"
import {
  recordInvitation,
  validateInvitation,
  completeInvitation,
  cancelInvitation,
} from "../../src/workflows/access-invitations/steps"
import { protectManagedInvites } from "../../src/api/middlewares/protect-managed-invites"
import { createInvitation, createInvitationAccess } from "../fixtures/access"

function harness() {
  const invite = createInvitation()
  const access = {
    mutate: vi.fn(),
    invitation: vi.fn().mockResolvedValue(createInvitationAccess()),
  }
  const users = {
    validateInviteToken: vi.fn().mockResolvedValue(invite),
    retrieveInvite: vi.fn().mockResolvedValue(invite),
  }
  const auth = {
    retrieveAuthIdentity: vi.fn().mockResolvedValue({
      provider_identities: [{ provider: "emailpass", entity_id: invite.email }],
    }),
  }
  const container: any = {
    resolve: (key: string) =>
      key === Modules.USER ? users : key === Modules.AUTH ? auth : access,
  }
  const input = { token: "test-token", auth_identity_id: "auth", user: {} }
  return {
    invite,
    access,
    users,
    auth,
    container,
    input,
    execution: { container },
  }
}
it("records selected roles against the native invitation ID", async () => {
  const h = harness()
  const result = await recordInvitation(
    {
      actor_id: "actor",
      email: h.invite.email,
      role_ids: ["reader"],
      invite: h.invite as any,
    },
    h.execution
  )
  expect(result.output).toEqual(h.invite)
  expect(h.access.mutate).toHaveBeenCalledWith("actor", {
    kind: "record_invite",
    invite_id: h.invite.id,
    email: h.invite.email,
    role_ids: ["reader"],
  })
})
it("validates native tokens and binds the signup identity to the invited email", async () => {
  const h = harness()
  expect(
    (
      await validateInvitation(
        { ...h.input, user: { email: h.invite.email.toUpperCase() } },
        h.execution
      )
    ).output
  ).toEqual({ invite: h.invite, actor_id: "user" })
  expect(h.users.validateInviteToken).toHaveBeenCalledWith("test-token")
})
it.each([
  "email",
  "identity",
  "no-identities",
  "provider",
  "missing",
  "cancelled",
  "plan-email",
])("rejects an invalid invitation: %s", async (failure) => {
  const h = harness()
  if (failure === "email") h.input.user = { email: "other@example.test" }
  if (failure === "identity")
    h.auth.retrieveAuthIdentity.mockResolvedValue({
      provider_identities: [
        { provider: "emailpass", entity_id: "other@example.test" },
      ],
    })
  if (failure === "no-identities")
    h.auth.retrieveAuthIdentity.mockResolvedValue({})
  if (failure === "provider")
    h.auth.retrieveAuthIdentity.mockResolvedValue({
      provider_identities: [
        { provider: "different", entity_id: h.invite.email },
      ],
    })
  if (failure === "missing") h.access.invitation.mockResolvedValue(undefined)
  if (failure === "cancelled")
    h.access.invitation.mockResolvedValue(
      createInvitationAccess({ status: "cancelled" })
    )
  if (failure === "plan-email")
    h.access.invitation.mockResolvedValue(
      createInvitationAccess({ email: "other@example.test" })
    )
  await expect(validateInvitation(h.input, h.execution)).rejects.toThrow()
})
it.each([undefined, {}])(
  "preserves legacy invitations without assigning access",
  async (metadata) => {
    const h = harness()
    h.users.validateInviteToken.mockResolvedValue({ ...h.invite, metadata })
    expect(
      (await validateInvitation(h.input, h.execution)).output.actor_id
    ).toBeUndefined()
    expect(h.access.invitation).not.toHaveBeenCalled()
    await completeInvitation(
      { invite_id: h.invite.id, user: { id: "user" } as any },
      h.execution
    )
    expect(h.access.mutate).not.toHaveBeenCalled()
  }
)
it("completes access under the inviting superuser's authority", async () => {
  const h = harness()
  expect(
    (
      await completeInvitation(
        {
          invite_id: h.invite.id,
          user: { id: "new-user" } as any,
          actor_id: "actor",
        },
        h.execution
      )
    ).output
  ).toEqual({ id: "new-user" })
  expect(h.access.mutate).toHaveBeenCalledWith("actor", {
    kind: "accept_invite",
    invite_id: h.invite.id,
    user_id: "new-user",
  })
})
it.each([true, false])(
  "revokes managed and legacy invitations: %s",
  async (managed) => {
    const h = harness()
    if (!managed) h.access.invitation.mockResolvedValue(undefined)
    expect(
      (
        await cancelInvitation(
          { actor_id: "actor", invite_id: h.invite.id },
          h.execution
        )
      ).output
    ).toEqual({ id: h.invite.id, object: "invite", deleted: true })
    expect(h.access.mutate).toHaveBeenCalledTimes(managed ? 1 : 0)
  }
)
it.each(["POST", "DELETE"])(
  "prevents bypassing managed invitation access through native %s",
  async (method) => {
    const h = harness()
    const next = vi.fn()
    await protectManagedInvites(
      {
        method,
        scope: h.container,
        params: { id: h.invite.id },
        query: { token: "token" },
      } as any,
      {} as any,
      next
    )
    expect(next.mock.calls[0][0].message).toContain("role assignment")
  }
)
it.each([null, {}])(
  "allows native legacy invitations: %s",
  async (metadata) => {
    const h = harness()
    const next = vi.fn()
    h.users.validateInviteToken.mockResolvedValue({ ...h.invite, metadata })
    await protectManagedInvites(
      { method: "POST", scope: h.container, query: {} } as any,
      {} as any,
      next
    )
    expect(next).toHaveBeenCalledWith()
  }
)
