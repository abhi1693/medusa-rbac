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
    deleteInvites: vi.fn(),
    updateInvites: vi.fn(),
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
it.each([
  ["POST", "/access/invites/accept?token=token"],
  ["DELETE", "/admin/access/invites/inv_test"],
])(
  "redirects native managed invitation %s to its guarded workflow",
  async (method, destination) => {
    const h = harness()
    const next = vi.fn()
    const res = { setHeader: vi.fn(), redirect: vi.fn() }
    const body = { email: h.invite.email, first_name: "Invited" }
    await protectManagedInvites(
      {
        method,
        scope: h.container,
        params: { id: h.invite.id },
        query: { token: "token" },
        body,
      } as any,
      res as any,
      next
    )
    expect(res.redirect).toHaveBeenCalledExactlyOnceWith(307, destination)
    expect(res.setHeader).toHaveBeenCalledExactlyOnceWith(
      "Cache-Control",
      "no-store"
    )
    expect(next).not.toHaveBeenCalled()
    expect(h.users.validateInviteToken).toHaveBeenCalledTimes(
      method === "POST" ? 1 : 0
    )
    expect(h.users.retrieveInvite).toHaveBeenCalledTimes(
      method === "DELETE" ? 1 : 0
    )
    expect(h.users.deleteInvites).not.toHaveBeenCalled()
    expect(h.users.updateInvites).not.toHaveBeenCalled()
    expect(h.access.mutate).not.toHaveBeenCalled()
    expect(h.auth.retrieveAuthIdentity).not.toHaveBeenCalled()
    expect(body).toEqual({ email: h.invite.email, first_name: "Invited" })
  }
)
it.each([
  ["POST", null],
  ["POST", {}],
  ["DELETE", null],
  ["DELETE", {}],
])("preserves unmanaged native invitation %s: %s", async (method, metadata) => {
  const h = harness()
  const next = vi.fn()
  const res = { setHeader: vi.fn(), redirect: vi.fn() }
  h.users.validateInviteToken.mockResolvedValue({ ...h.invite, metadata })
  h.users.retrieveInvite.mockResolvedValue({ ...h.invite, metadata })
  await protectManagedInvites(
    {
      method,
      scope: h.container,
      params: { id: h.invite.id },
      query: { token: "token" },
    } as any,
    res as any,
    next
  )
  expect(next).toHaveBeenCalledExactlyOnceWith()
  expect(res.redirect).not.toHaveBeenCalled()
  expect(res.setHeader).not.toHaveBeenCalled()
})
it.each(["POST", "DELETE"])(
  "passes native invitation %s lookup errors to the error handler",
  async (method) => {
    const h = harness()
    const next = vi.fn()
    const res = { setHeader: vi.fn(), redirect: vi.fn() }
    const error = new Error("Invitation is unavailable")
    h.users.validateInviteToken.mockRejectedValue(error)
    h.users.retrieveInvite.mockRejectedValue(error)
    await protectManagedInvites(
      {
        method,
        scope: h.container,
        params: { id: h.invite.id },
        query: { token: "token" },
      } as any,
      res as any,
      next
    )
    expect(next).toHaveBeenCalledExactlyOnceWith(error)
    expect(res.redirect).not.toHaveBeenCalled()
    expect(h.access.mutate).not.toHaveBeenCalled()
  }
)
it.each([undefined, "", [], ["token"], { token: "token" }])(
  "rejects malformed native invitation tokens before resolving an invitation: %s",
  async (token) => {
    const h = harness()
    const next = vi.fn()
    const res = { setHeader: vi.fn(), redirect: vi.fn() }
    await protectManagedInvites(
      { method: "POST", scope: h.container, query: { token } } as any,
      res as any,
      next
    )
    expect(next).toHaveBeenCalledExactlyOnceWith(expect.any(Error))
    expect(h.users.validateInviteToken).not.toHaveBeenCalled()
    expect(res.redirect).not.toHaveBeenCalled()
  }
)
it("encodes the validated invitation token and canonical invitation ID in same-origin redirects", async () => {
  const h = harness()
  const next = vi.fn()
  const res = { setHeader: vi.fn(), redirect: vi.fn() }
  const token = "signed+/token=?&other=value#part"
  await protectManagedInvites(
    {
      method: "POST",
      scope: h.container,
      query: { token, fields: "id,email" },
    } as any,
    res as any,
    next
  )
  expect(h.users.validateInviteToken).toHaveBeenCalledExactlyOnceWith(token)
  expect(res.redirect).toHaveBeenLastCalledWith(
    307,
    "/access/invites/accept?token=signed%2B%2Ftoken%3D%3F%26other%3Dvalue%23part"
  )
  h.users.retrieveInvite.mockResolvedValue({
    ...h.invite,
    id: "inv/canonical?with=query#fragment",
  })
  await protectManagedInvites(
    {
      method: "DELETE",
      scope: h.container,
      params: { id: "requested-id" },
    } as any,
    res as any,
    next
  )
  expect(h.users.retrieveInvite).toHaveBeenCalledExactlyOnceWith("requested-id")
  expect(res.redirect).toHaveBeenLastCalledWith(
    307,
    "/admin/access/invites/inv%2Fcanonical%3Fwith%3Dquery%23fragment"
  )
  expect(next).not.toHaveBeenCalled()
})
