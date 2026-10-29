import { it, expect, vi } from "vitest"
import * as workflows from "../../src/workflows/access-invitations"
import * as invites from "../../src/api/admin/access/invites/route"
import * as invite from "../../src/api/admin/access/invites/[id]/route"
import * as accept from "../../src/api/access/invites/accept/route"
import { createInvitation } from "../fixtures/access"

function harness() {
  const req: any = {
    scope: {},
    auth_context: { actor_id: "actor", auth_identity_id: "auth" },
    params: { id: "inv_test" },
    query: { token: "token" },
    body: {},
  }
  const res: any = { status: vi.fn().mockReturnThis(), json: vi.fn() }
  return { req, res }
}
it("composes native invitation creation with the selected custom roles", async () => {
  const h = harness()
  const result = createInvitation()
  const run = vi.fn().mockResolvedValue({ result })
  vi.spyOn(workflows, "createAccessInviteWorkflow").mockReturnValue({
    run,
  } as any)
  h.req.body = { email: result.email, role_ids: ["reader"] }
  await invites.POST(h.req, h.res)
  expect(run).toHaveBeenCalledWith({
    input: { ...h.req.body, actor_id: "actor" },
  })
  expect(h.res.json).toHaveBeenCalledWith({ invite: result })
})
it("composes native invitation deletion with pending assignment cleanup", async () => {
  const h = harness()
  const result = { id: "inv_test", deleted: true }
  const run = vi.fn().mockResolvedValue({ result })
  vi.spyOn(workflows, "deleteAccessInviteWorkflow").mockReturnValue({
    run,
  } as any)
  await invite.DELETE(h.req, h.res)
  expect(run).toHaveBeenCalledWith({
    input: { actor_id: "actor", invite_id: "inv_test" },
  })
  expect(h.res.json).toHaveBeenCalledWith(result)
})
it("requires an unregistered authenticated identity for acceptance", async () => {
  const h = harness()
  expect(accept.AUTHENTICATE).toBe(false)
  await expect(accept.POST(h.req, h.res)).rejects.toThrow("Sign out")
})
it("accepts through the workflow and returns the native user", async () => {
  const h = harness()
  delete h.req.auth_context.actor_id
  const run = vi.fn().mockResolvedValue({ result: { id: "new-user" } })
  vi.spyOn(workflows, "acceptAccessInviteWorkflow").mockReturnValue({
    run,
  } as any)
  await accept.POST(h.req, h.res)
  expect(run).toHaveBeenCalledWith({
    input: { token: "token", auth_identity_id: "auth", user: {} },
  })
  expect(h.res.json).toHaveBeenCalledWith({ user: { id: "new-user" } })
})
