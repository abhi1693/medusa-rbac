import { it, expect, vi } from "vitest"
import {
  bindInvitationIdentity,
  restoreInvitationIdentity,
} from "../../src/workflows/access-invitations/steps"

function harness(metadata?: Record<string, unknown>) {
  const auth = {
    retrieveAuthIdentity: vi
      .fn()
      .mockResolvedValue({ id: "identity", app_metadata: metadata }),
    updateAuthIdentities: vi.fn(),
  }
  const execution = { container: { resolve: () => auth } } as any
  return { auth, execution }
}
it.each([undefined, { user_id: null, customer_id: "customer" }])(
  "binds an unregistered identity through the Auth module: %j",
  async (metadata) => {
    const h = harness(metadata)
    const result = await bindInvitationIdentity(
      { auth_identity_id: "identity", user: { id: "user" } as any },
      h.execution
    )
    expect(result.output.id).toBe("user")
    expect(h.auth.updateAuthIdentities).toHaveBeenCalledWith({
      id: "identity",
      app_metadata: { ...metadata, user_id: "user" },
    })
  }
)
it("refuses to overwrite an existing native actor binding", async () => {
  const h = harness({ user_id: "existing" })
  await expect(
    bindInvitationIdentity(
      { auth_identity_id: "identity", user: { id: "new" } as any },
      h.execution
    )
  ).rejects.toThrow("already belongs")
  expect(h.auth.updateAuthIdentities).not.toHaveBeenCalled()
})
it("compensates only this workflow's binding and preserves other actor metadata", async () => {
  const h = harness({ user_id: "user", customer_id: "customer" })
  await restoreInvitationIdentity(
    { auth_identity_id: "identity", user_id: "user" },
    h.execution
  )
  expect(h.auth.updateAuthIdentities).toHaveBeenCalledWith({
    id: "identity",
    app_metadata: { user_id: null, customer_id: "customer" },
  })
})
it.each([undefined, { user_id: "different" }])(
  "does not clear an absent or changed binding: %j",
  async (metadata) => {
    const h = harness(metadata)
    await restoreInvitationIdentity(undefined, h.execution)
    expect(h.auth.retrieveAuthIdentity).not.toHaveBeenCalled()
    await restoreInvitationIdentity(
      { auth_identity_id: "identity", user_id: "user" },
      h.execution
    )
    expect(h.auth.updateAuthIdentities).not.toHaveBeenCalled()
  }
)
